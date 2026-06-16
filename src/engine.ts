// Core game engine: turn loop, combat, cards, disasters, production centers.
// Rules follow RULES_SPEC.md (derived from the original Isle Wars Pro manual).
import type { WorldMap } from './geometry';
import { AmountResult, CardFace, GameState, HAND_LIMIT, Player, Settings } from './types';
import { aiTurn } from './ai';

export interface GameUI {
  refresh(): void;
  prompt(text: string): void;
  infoLeft(text: string): void;
  infoRight(text: string): void;
  buttons(opts: { label: string; id: string; kind?: 'primary' | 'danger' | 'ghost' }[]): Promise<string>;
  pickCountry(ids: number[], promptText: string, cancelable: boolean): Promise<number | null>;
  pickAmount(opts: { min: number; max: number; title: string; cancelable?: boolean }): Promise<number | null>;
  pickAmountOrSwitch(opts: {
    min: number;
    max: number;
    title: string;
    cancelable?: boolean;
    switchIds?: number[];
  }): Promise<AmountResult>;
  banner(title: string, sub?: string, tone?: 'storm' | 'war' | 'gold'): Promise<void>;
  toast(text: string): void;
  shake(ids: number[]): void;
  flash(ids: number[], color?: string): void;
  floatText(id: number, text: string, color?: string): void;
  arrow(id: number | null): void;
  tradeModal(p: Player): Promise<CardFace[] | null>;
  handModal(p: Player, canBomb: boolean): Promise<'bomb' | null>;
  discardModal(p: Player): Promise<number>;
  eliminatedModal(): Promise<'concede' | 'watch'>;
  victory(winner: Player): Promise<void>;
  wait(ms: number): Promise<void>;
  setPlayoutMode(on: boolean, onStop: () => void): void;
}

export class GameEnd {
  constructor(public winner: Player | null, public conceded: boolean) {}
}

const DRAW_POOL: (CardFace | 'loseall')[] = [
  '5', '5', '5', '8', '8', '8', '15', '15',
  'double', 'double', 'bomb', 'bomb', 'antibomb', 'antibomb', 'wild', 'loseall',
];

export const rnd = (n: number) => Math.floor(Math.random() * n);
export const pickRandom = <T>(arr: T[]): T => arr[rnd(arr.length)];

export class Game {
  st: GameState;
  capturedThisTurn = false;
  stopRequested = false;

  constructor(
    public world: WorldMap,
    public settings: Settings,
    public players: Player[],
    public ui: GameUI,
  ) {
    this.st = {
      owner: new Array(world.countries.length).fill(0),
      armies: new Array(world.countries.length).fill(1),
      prodCenters: [],
      players,
      current: 0,
      turn: 1,
      fastPlayout: false,
    };
  }

  // ---------- setup ----------

  deal() {
    const ids = this.world.countries.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    ids.forEach((cid, i) => (this.st.owner[cid] = i % this.players.length));
    // Distribute starting armies randomly across each player's countries.
    for (const p of this.players) {
      const mine = ids.filter((cid) => this.st.owner[cid] === p.id);
      for (let i = 0; i < this.settings.startingArmies; i++) {
        this.st.armies[pickRandom(mine)]++;
      }
    }
    // Production centers: 5 scattered countries.
    this.st.prodCenters = this.shuffledCountries().slice(0, 5);
    this.st.current = rnd(this.players.length);
  }

  shuffledCountries(): number[] {
    const ids = this.world.countries.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  // ---------- queries ----------

  countriesOf(pid: number): number[] {
    return this.st.owner.flatMap((o, cid) => (o === pid ? [cid] : []));
  }

  reinforcementsFor(p: Player): { base: number; bonus: number; islands: string[] } {
    const owned = this.countriesOf(p.id);
    const base = Math.max(2, Math.floor(owned.length / 3));
    let bonus = 0;
    const names: string[] = [];
    for (const isl of this.world.islands) {
      if (isl.countries.every((cid) => this.st.owner[cid] === p.id)) {
        bonus += isl.bonus;
        names.push(`${isl.name} +${isl.bonus}`);
      }
    }
    return { base, bonus, islands: names };
  }

  /** Eligible attack: enemy neighbor, my stack >= theirs, and I have >= 2. */
  canAttack(from: number, to: number): boolean {
    const { owner, armies } = this.st;
    return (
      owner[from] !== owner[to] &&
      this.world.countries[from].neighbors.includes(to) &&
      armies[from] >= 2 &&
      armies[from] >= armies[to]
    );
  }

  attackableTargets(pid: number): number[] {
    const targets = new Set<number>();
    for (const from of this.countriesOf(pid)) {
      for (const to of this.world.countries[from].neighbors) {
        if (this.canAttack(from, to)) targets.add(to);
      }
    }
    return [...targets];
  }

  // ---------- cards ----------

  drawCard(p: Player) {
    const card = pickRandom(DRAW_POOL);
    if (card === 'loseall') {
      p.cards = [];
      this.ui.toast(`${p.name} draws MUTINY — their whole hand is lost!`);
      return;
    }
    p.cards.push(card);
    this.ui.toast(`${p.name} draws a card.`);
  }

  /** Best tradeable set, or null. Sets: three army cards of one face, wilds wild. */
  findSet(cards: CardFace[]): CardFace[] | null {
    const wilds = cards.filter((c) => c === 'wild').length;
    let best: { face: '5' | '8' | '15'; value: number } | null = null;
    for (const face of ['15', '8', '5'] as const) {
      const n = cards.filter((c) => c === face).length;
      if (n >= 1 && n + wilds >= 3) {
        const value = Number(face) * 3;
        if (!best || value > best.value) best = { face, value };
      }
    }
    if (!best) return null;
    const set: CardFace[] = [];
    for (const c of cards) if (c === best.face && set.length < 3) set.push(c);
    for (const c of cards) if (c === 'wild' && set.length < 3) set.push(c);
    return set.length === 3 ? set : null;
  }

  setValue(set: CardFace[]): number {
    const face = set.find((c) => c !== 'wild') as '5' | '8' | '15';
    return Number(face) * 3;
  }

  removeCards(p: Player, set: CardFace[]) {
    for (const c of set) {
      const i = p.cards.indexOf(c);
      if (i >= 0) p.cards.splice(i, 1);
    }
  }

  async playBomb(attacker: Player, target: number) {
    const victim = this.players[this.st.owner[target]];
    this.removeCards(attacker, ['bomb']);
    const wardIdx = victim.cards.indexOf('antibomb');
    if (wardIdx >= 0) {
      victim.cards.splice(wardIdx, 1);
      await this.ui.banner('BOMBARDMENT WARDED', `${victim.name}'s ward absorbs the blast over country ${target + 1}.`, 'gold');
      this.ui.refresh();
      return;
    }
    const before = this.st.armies[target];
    this.st.armies[target] = Math.max(1, Math.floor(before / 3));
    this.ui.shake([target]);
    this.ui.floatText(target, `−${before - this.st.armies[target]}`, '#ff9c5b');
    await this.ui.banner('BOMBARDMENT', `${attacker.name} shells country ${target + 1}!`, 'war');
    this.ui.refresh();
  }

  async enforceHandLimit(p: Player) {
    while (p.cards.length > HAND_LIMIT) {
      if (p.human) {
        const idx = await this.ui.discardModal(p);
        p.cards.splice(idx, 1);
      } else {
        // AI discards the least useful card.
        const order: CardFace[] = ['5', '8', 'double', '15', 'wild', 'antibomb', 'bomb'];
        const idx = order
          .map((f) => p.cards.indexOf(f))
          .find((i) => i >= 0);
        p.cards.splice(idx ?? 0, 1);
      }
    }
  }

  // ---------- combat ----------

  /**
   * Fight one batch of rolls. Hidden d6 vs d6; ties favor the defender.
   * Returns 'fighting' | 'conquered' | 'forfeit'.
   */
  rollBatch(from: number, to: number): 'fighting' | 'conquered' | 'forfeit' {
    const { armies } = this.st;
    const batch = Math.min(armies[from], armies[to]) >= 10 ? 5 : 1;
    for (let i = 0; i < batch; i++) {
      const a = rnd(6) + 1;
      const d = rnd(6) + 1;
      if (a > d) armies[to]--;
      else armies[from]--;
      if (armies[from] <= 1) return 'forfeit';
      if (armies[to] <= 0) return 'conquered';
    }
    return 'fighting';
  }

  /** The brutal signature rule: attacker worn down to 1 loses the country. */
  async applyForfeit(from: number, to: number) {
    const attackerOwner = this.st.owner[from];
    const defenderOwner = this.st.owner[to];
    this.st.owner[from] = defenderOwner;
    this.ui.shake([from]);
    await this.ui.banner(
      'ROUT!',
      `The attack collapses — country ${from + 1} falls to ${this.players[defenderOwner].name}.`,
      'war',
    );
    this.ui.refresh();
    this.checkElimination(attackerOwner);
  }

  async conquer(p: Player, from: number, to: number) {
    const prevOwner = this.st.owner[to];
    this.st.owner[to] = p.id;
    this.capturedThisTurn = true;
    const movable = this.st.armies[from] - 1;
    let moveIn = 1;
    if (movable > 1) {
      if (p.human) {
        moveIn =
          (await this.ui.pickAmount({
            min: 1,
            max: movable,
            title: `March troops into country ${to + 1}`,
          })) ?? 1;
      } else {
        // AI: leave a garrison if the source still borders enemies.
        const exposed = this.world.countries[from].neighbors.some(
          (n) => this.st.owner[n] !== p.id,
        );
        moveIn = exposed ? Math.max(1, movable - Math.min(3, movable - 1)) : movable;
      }
    }
    this.st.armies[to] = moveIn;
    this.st.armies[from] -= moveIn;
    this.ui.refresh();
    this.checkElimination(prevOwner);
  }

  checkElimination(pid: number) {
    const p = this.players[pid];
    if (p.alive && this.countriesOf(pid).length === 0) {
      p.alive = false;
      p.bankedCards = p.cards; // kept in case the Exiles Return event brings them back
      p.cards = [];
      this.ui.toast(`☠ ${p.name} has been swept from the isles!`);
    }
  }

  /** Opt-in comeback: defect a random country to a once-eliminated captain and
   *  return them to the war with the hand they held when they fell. Returns
   *  false (so a normal event fires instead) when no revival is possible. */
  async maybeRevive(): Promise<boolean> {
    // A human who has chosen to spectate the playout is left to spectate.
    const exiles = this.players.filter(
      (p) => !p.alive && !p.revived && !(p.human && this.st.fastPlayout),
    );
    if (!exiles.length) return false;
    // Seize a country from a living player who can spare one (never their last),
    // so the comeback can't itself eliminate someone.
    const donors = this.world.countries
      .map((c) => c.id)
      .filter((cid) => {
        const o = this.st.owner[cid];
        return this.players[o].alive && this.countriesOf(o).length > 1;
      });
    if (!donors.length) return false;

    const exile = pickRandom(exiles);
    const cid = pickRandom(donors);
    const formerOwner = this.players[this.st.owner[cid]];

    exile.alive = true;
    exile.revived = true;
    exile.cards = exile.bankedCards ?? []; // the hand they held when they fell
    exile.bankedCards = undefined;
    this.st.owner[cid] = exile.id;
    this.st.armies[cid] = Math.max(this.st.armies[cid], 3); // a fighting foothold

    await this.ui.banner(
      '✦ THE EXILES RETURN ✦',
      `${exile.name} sails back from exile to seize country ${cid + 1}!`,
      'gold',
    );
    this.ui.arrow(cid);
    this.ui.flash([cid], exile.color);
    this.ui.shake([cid]);
    this.ui.refresh();
    this.ui.floatText(cid, '⚑', exile.color);
    await this.ui.wait(850);
    this.ui.arrow(null);
    this.ui.toast(`${exile.name} returns to the war — country ${cid + 1} torn from ${formerOwner.name}.`);
    return true;
  }

  aliveCount(): number {
    return this.players.filter((p) => p.alive).length;
  }

  winner(): Player | null {
    const alive = this.players.filter((p) => p.alive);
    if (alive.length === 1) return alive[0];
    const first = this.st.owner[0];
    return this.st.owner.every((o) => o === first) ? this.players[first] : null;
  }

  // ---------- disasters & production centers ----------

  async maybeEvent() {
    if (Math.random() >= this.settings.disasterChance) return;
    // Rare comeback (opt-in). Hard-gated to keep games terminating: only while
    // 3+ captains still live, and once per captain — so it can never un-end a
    // game that's down to its final two.
    if (
      this.settings.reviveExiles &&
      this.aliveCount() > 2 &&
      Math.random() < 0.12 &&
      (await this.maybeRevive())
    ) {
      return;
    }
    const type = rnd(6);
    const land = this.world.countries.map((c) => c.id);
    // Disasters are meant to feel like an act of fate sweeping the map, so each
    // one is choreographed: the banner sets the scene, then the effects land one
    // beat at a time with a flash, a shake and a damage number, so the player
    // can actually see what happened and where. `ui.wait` already scales with
    // the speed setting and compresses heavily during fast-playout.
    const beat = (ms: number) => this.ui.wait(ms);

    if (type === 0 || type === 1) {
      const quake = type === 0;
      const name = quake ? 'EARTHQUAKE' : 'THE GREAT FLOOD';
      const hue = quake ? '#e0913f' : '#6fb6ff';
      const hits = this.shuffledCountries().slice(0, 3 + rnd(2));
      await this.ui.banner(
        `✦ ${name} ✦`,
        quake
          ? 'The earth heaves — garrisons are swallowed whole…'
          : 'The sea rises and pours across the shores…',
        'storm',
      );
      let toll = 0;
      for (const cid of hits) {
        const before = this.st.armies[cid];
        this.st.armies[cid] = Math.max(1, Math.floor(before * (0.4 + Math.random() * 0.2)));
        const lost = before - this.st.armies[cid];
        toll += lost;
        this.ui.flash([cid], hue);
        this.ui.shake([cid]);
        this.ui.refresh();
        if (lost > 0) this.ui.floatText(cid, `−${lost}`, hue);
        await beat(440); // one country at a time — let the eye follow the sweep
      }
      this.ui.toast(`${name} guts ${toll} ${toll === 1 ? 'army' : 'armies'} across ${hits.length} countries.`);
      await beat(550);
    } else if (type === 2) {
      const cid = pickRandom(land);
      await this.ui.banner('✦ REBELLION ✦', `The people of country ${cid + 1} rise up…`, 'storm');
      this.ui.arrow(cid);
      this.ui.flash([cid], '#e0913f');
      await beat(550);
      const before = this.st.armies[cid];
      this.st.armies[cid] = Math.max(1, Math.floor(before / 2));
      const lost = before - this.st.armies[cid];
      this.ui.flash([cid], '#e0913f');
      this.ui.shake([cid]);
      this.ui.refresh();
      if (lost > 0) this.ui.floatText(cid, `−${lost}`, '#ffb27a');
      await beat(750);
      this.ui.arrow(null);
    } else if (type === 3) {
      const cid = pickRandom(land);
      const oldOwner = this.st.owner[cid];
      const others = this.players.filter((p) => p.alive && p.id !== oldOwner);
      if (others.length) {
        const newOwner = pickRandom(others);
        await this.ui.banner('✦ REBEL TAKEOVER ✦', `Country ${cid + 1} raises a new flag…`, 'storm');
        this.ui.arrow(cid);
        this.ui.flash([cid], '#ffe9a8');
        await beat(650);
        this.st.owner[cid] = newOwner.id;
        this.ui.flash([cid], newOwner.color);
        this.ui.shake([cid]);
        this.ui.refresh(); // recolors the country to its new owner
        this.ui.floatText(cid, '⚑', newOwner.color);
        await beat(800);
        this.ui.arrow(null);
        this.ui.toast(`Country ${cid + 1} throws off ${this.players[oldOwner].name} and joins ${newOwner.name}!`);
        this.checkElimination(oldOwner);
      }
    } else if (type === 4) {
      const oldCenters = this.st.prodCenters.slice();
      await this.ui.banner('✦ TRADE WINDS SHIFT ✦', 'The production centers drift to new shores…', 'gold');
      this.ui.flash(oldCenters, '#7c93ab'); // old anchors fade out
      await beat(600);
      this.st.prodCenters = this.shuffledCountries().slice(0, 5);
      this.ui.refresh();
      this.ui.flash(this.st.prodCenters, '#7fd4ff'); // new anchors light up
      for (const cid of this.st.prodCenters) this.ui.floatText(cid, '⚓', '#7fd4ff');
      await beat(750);
    } else {
      await this.ui.banner('✦ PRODUCTION SURGE ✦', 'The forges roar — every production center doubles!', 'gold');
      for (const cid of this.st.prodCenters) {
        const gain = this.st.armies[cid];
        this.st.armies[cid] = Math.min(999, this.st.armies[cid] * 2);
        this.ui.flash([cid], '#7fd4ff');
        this.ui.shake([cid]);
        this.ui.refresh();
        this.ui.floatText(cid, `+${gain}`, '#7fd4ff');
        await beat(400); // each forge fires in turn
      }
      await beat(500);
    }
    this.ui.refresh();
  }

  // ---------- turn loop ----------

  async run(): Promise<GameEnd> {
    this.deal();
    this.ui.refresh();
    try {
      while (true) {
        if (this.settings.turnLimit && this.st.turn > this.settings.turnLimit) {
          return new GameEnd(null, false);
        }
        const p = this.players[this.st.current];
        if (p.alive) {
          this.capturedThisTurn = false;
          if (p.human && !this.st.fastPlayout) await this.humanTurn(p);
          else await aiTurn(this, p);
          if (this.capturedThisTurn) {
            this.drawCard(p);
            await this.enforceHandLimit(p);
          }
          const w = this.winner();
          if (w) return new GameEnd(w, false);
          await this.maybeEvent();
          const w2 = this.winner();
          if (w2) return new GameEnd(w2, false);
          await this.checkHumanFate();
        }
        this.st.current = (this.st.current + 1) % this.players.length;
        this.st.turn++;
        this.ui.refresh();
      }
    } catch (e) {
      if (e instanceof GameEnd) return e;
      throw e;
    }
  }

  /** Once every human is eliminated, offer concede / watch the playout. */
  async checkHumanFate() {
    const humans = this.players.filter((p) => p.human);
    if (!humans.length || humans.some((h) => h.alive) || this.st.fastPlayout) return;
    const choice = await this.ui.eliminatedModal();
    if (choice === 'concede') throw new GameEnd(null, true);
    this.st.fastPlayout = true;
    this.ui.setPlayoutMode(true, () => (this.stopRequested = true));
  }

  requestStopCheck() {
    if (this.stopRequested) throw new GameEnd(null, true);
  }

  // ---------- human turn ----------

  async humanTurn(p: Player) {
    this.ui.infoLeft('');
    this.ui.infoRight('');
    const multiHuman = this.players.filter((pl) => pl.human).length > 1;
    await this.ui.banner(
      multiHuman ? `${p.name.toUpperCase()} TO COMMAND` : 'YOUR TURN',
      `Turn ${Math.ceil(this.st.turn / this.players.length)} — the ${p.colorName} fleet awaits orders.`,
      'gold',
    );

    // 1. Trade cards.
    let tradeArmies = 0;
    if (this.findSet(p.cards)) {
      const set = await this.ui.tradeModal(p);
      if (set) {
        tradeArmies = this.setValue(set);
        this.removeCards(p, set);
        this.ui.toast(`Set traded for ${tradeArmies} armies.`);
      }
    }

    // 2. Reinforcements.
    const r = this.reinforcementsFor(p);
    let total = r.base + r.bonus + tradeArmies;
    const rally = p.cards.indexOf('double');
    if (rally >= 0) {
      p.cards.splice(rally, 1);
      total *= 2;
      this.ui.toast('Rally! Your reinforcements are doubled.');
    }
    const islandNote = r.islands.length ? ` (${r.islands.join(', ')})` : '';
    this.ui.infoRight(`Reinforcements: ${total}${islandNote}`);

    // 3. Place armies. Clicking another of your countries while the stepper
    // is open re-targets the deployment; Cancel returns to country picking.
    let remaining = total;
    let cid: number | null = null;
    while (remaining > 0) {
      const mine = this.countriesOf(p.id);
      if (cid === null) {
        cid = await this.ui.pickCountry(mine, `Place armies — ${remaining} remaining`, false);
        if (cid === null) continue;
      }
      this.ui.arrow(cid);
      const res = await this.ui.pickAmountOrSwitch({
        min: 1,
        max: remaining,
        title: `Deploy to country ${cid + 1}`,
        cancelable: true,
        switchIds: mine.filter((id) => id !== cid),
      });
      if (res.kind === 'switch') {
        cid = res.id;
        continue;
      }
      this.ui.arrow(null);
      if (res.kind === 'cancel') {
        cid = null;
        continue;
      }
      this.st.armies[cid] += res.value;
      remaining -= res.value;
      cid = null;
      this.ui.refresh();
    }

    // 4. Action phase.
    while (true) {
      this.ui.infoLeft('');
      this.ui.infoRight('');
      const canAttack = this.attackableTargets(p.id).length > 0;
      const hasBomb = p.cards.includes('bomb');
      this.ui.prompt('Issue your orders.');
      const choice = await this.ui.buttons([
        ...(canAttack ? [{ label: 'Attack', id: 'attack', kind: 'primary' as const }] : []),
        { label: 'Move', id: 'move' },
        { label: 'Pass', id: 'pass' },
        { label: `Cards (${p.cards.length})`, id: 'cards', kind: 'ghost' as const },
      ]);

      if (choice === 'attack') {
        const result = await this.humanAttack(p);
        if (result === 'forfeit') return; // turn lost
      } else if (choice === 'move') {
        const moved = await this.humanMove(p);
        if (moved) return;
      } else if (choice === 'cards') {
        const action = await this.ui.handModal(p, hasBomb);
        if (action === 'bomb') {
          const enemies = this.world.countries
            .map((c) => c.id)
            .filter((cid) => this.st.owner[cid] !== p.id);
          const target = await this.ui.pickCountry(enemies, 'Bombard which country?', true);
          if (target !== null) await this.playBomb(p, target);
        }
      } else {
        return; // pass
      }
    }
  }

  async humanAttack(p: Player): Promise<'done' | 'forfeit'> {
    // Manual's order: pick the target first, then the country to attack from.
    const targets = this.attackableTargets(p.id);
    const to = await this.ui.pickCountry(targets, 'Select the country to attack', true);
    if (to === null) return 'done';
    this.ui.arrow(to);
    const sources = this.world.countries[to].neighbors.filter(
      (n) => this.st.owner[n] === p.id && this.canAttack(n, to),
    );
    const from = await this.ui.pickCountry(sources, `Attack country ${to + 1} from where?`, true);
    this.ui.arrow(null);
    if (from === null) return 'done';

    // Auto-attack rolls without pausing until the battle resolves or reaches
    // the brink — attacker down to 2 (next loss triggers the forfeit rule) or
    // defender down to 1 — where pressing on is a real gamble and the player
    // should decide each remaining clash by hand.
    let auto = false;
    const atBrink = () => this.st.armies[from] <= 2 || this.st.armies[to] <= 1;
    while (true) {
      this.ui.infoLeft(`Country ${from + 1} attacks ${to + 1}`);
      this.ui.infoRight(`${this.st.armies[from]} against ${this.st.armies[to]}`);
      this.ui.prompt(auto ? 'Auto-attacking…' : 'The dice are cast…');
      const outcome = this.rollBatch(from, to);
      this.ui.refresh();
      this.ui.shake([to]);
      await this.ui.wait(auto ? 120 : 240);
      this.ui.infoRight(`${this.st.armies[from]} against ${this.st.armies[to]}`);

      if (outcome === 'forfeit') {
        await this.applyForfeit(from, to);
        return 'forfeit';
      }
      if (outcome === 'conquered') {
        await this.ui.banner('CONQUEST', `Country ${to + 1} is yours!`, 'gold');
        await this.conquer(p, from, to);
        return 'done';
      }
      if (!this.canAttack(from, to)) {
        this.ui.toast('Your force is too thin to press the attack.');
        return 'done';
      }
      // Keep rolling under auto until we reach the brink, then hand back control.
      if (auto && !atBrink()) continue;
      auto = false;
      const again = await this.ui.buttons([
        { label: 'Attack', id: 'attack', kind: 'primary' },
        ...(atBrink() ? [] : [{ label: 'Auto', id: 'auto' as const }]),
        { label: 'Quit Attack', id: 'quit' },
      ]);
      if (again === 'quit') return 'done';
      if (again === 'auto') auto = true;
    }
  }

  /** End-of-turn fortify: one move between adjacent countries. */
  async humanMove(p: Player): Promise<boolean> {
    const sources = this.countriesOf(p.id).filter((cid) => this.st.armies[cid] > 1);
    const from = await this.ui.pickCountry(sources, 'Move troops from which country?', true);
    if (from === null) return false;
    this.ui.arrow(from);
    const dests = this.world.countries[from].neighbors.filter((n) => this.st.owner[n] === p.id);
    const to = await this.ui.pickCountry(dests, 'Move them where?', true);
    this.ui.arrow(null);
    if (to === null) return false;
    const amt = await this.ui.pickAmount({
      min: 1,
      max: this.st.armies[from] - 1,
      title: `March from ${from + 1} to ${to + 1}`,
      cancelable: true,
    });
    if (amt === null) return false;
    this.st.armies[from] -= amt;
    this.st.armies[to] += amt;
    this.ui.refresh();
    return true;
  }
}

// ---------- scoreboard ----------

const SCORE_KEY = 'tempest-isles-scores';

export interface Scores {
  [difficulty: string]: { w: number; l: number };
}

export function loadScores(): Scores {
  try {
    return JSON.parse(localStorage.getItem(SCORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function recordScore(difficulty: string, won: boolean) {
  const s = loadScores();
  s[difficulty] = s[difficulty] ?? { w: 0, l: 0 };
  if (won) s[difficulty].w++;
  else s[difficulty].l++;
  localStorage.setItem(SCORE_KEY, JSON.stringify(s));
}
