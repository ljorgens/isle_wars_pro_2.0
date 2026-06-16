// AI captains. Difficulty (0-3) raises required attack advantage discipline,
// strategic weighting, and bomb usage.
import type { Game } from './engine';
import { pickRandom } from './engine';
import { HAND_LIMIT, type Player } from './types';

/** Capability gates by difficulty — each tier adds a behavior, not just a knob. */
const caps = (d: number) => ({
  spearhead: d >= 1, // reinforce to fund attacks instead of reacting to pressure
  smartCards: d >= 1, // hold Rally for a big turn; aim bombs at reachable stacks
  lookahead: d >= 2, // value conquests that open up further targets (one ply)
  focusFire: d >= 2, // pile onto the weakest opponent
  consolidate: d >= 2, // plug holes in your border; don't strip a needed defender
  twoPly: d >= 3, // Admiral looks a second ring deeper for advancing fronts
});

const tick = (g: Game) => (g.st.fastPlayout ? 12 : 300);

export async function aiTurn(g: Game, p: Player) {
  const d = p.aiDifficulty ?? g.settings.difficulty;
  g.requestStopCheck();
  g.ui.prompt(`${p.name} commands the ${p.colorName} fleet…`);
  await g.ui.wait(tick(g));

  // Trade any set immediately.
  let tradeArmies = 0;
  const set = g.findSet(p.cards);
  if (set) {
    tradeArmies = g.setValue(set);
    g.removeCards(p, set);
    g.ui.toast(`${p.name} trades a set for ${tradeArmies} armies.`);
  }

  // Bombard (Commodore+): prefer the strongest enemy stack we actually border
  // — softening it sets up an attack — and fall back to the global biggest.
  if (d >= 2 && p.cards.includes('bomb')) {
    const byArmies = (a: number, b: number) => g.st.armies[b] - g.st.armies[a];
    const reachable = new Set<number>();
    for (const c of g.countriesOf(p.id))
      for (const n of g.world.countries[c].neighbors)
        if (g.st.owner[n] !== p.id) reachable.add(n);
    const near = [...reachable].filter((cid) => g.st.armies[cid] >= 8).sort(byArmies);
    const far = g.world.countries
      .map((c) => c.id)
      .filter((cid) => g.st.owner[cid] !== p.id && g.st.armies[cid] >= 12)
      .sort(byArmies);
    const target = near[0] ?? far[0];
    if (target !== undefined) await g.playBomb(p, target);
  }

  // Reinforcements.
  const r = g.reinforcementsFor(p);
  let total = r.base + r.bonus + tradeArmies;
  const rally = p.cards.indexOf('double');
  if (rally >= 0) {
    // Doubling a thin turn wastes the card; hold it unless the turn is already
    // big or the hand is full enough that we'd be forced to discard.
    const worthIt = !caps(d).smartCards || total >= 10 || p.cards.length >= HAND_LIMIT;
    if (worthIt) {
      p.cards.splice(rally, 1);
      total *= 2;
      g.ui.toast(`${p.name} sounds the rally — reinforcements doubled.`);
    }
  }

  placeArmies(g, p, total, d);
  g.ui.refresh();
  await g.ui.wait(tick(g));

  // Attack phase.
  let battles = 0;
  const maxBattles = 3 + d * 2;
  while (battles < maxBattles) {
    g.requestStopCheck();
    const plan = bestAttack(g, p, d);
    if (!plan) break;
    battles++;
    const { from, to } = plan;
    g.ui.infoLeft(`${p.name}: country ${from + 1} attacks ${to + 1}`);
    const result = await fightOut(g, p, from, to);
    if (result === 'forfeit') return;
    g.ui.refresh();
    await g.ui.wait(tick(g));
  }

  fortify(g, p);
  g.ui.infoLeft('');
  g.ui.refresh();
  await g.ui.wait(tick(g));
}

function frontierScore(g: Game, p: Player, cid: number): number {
  let pressure = 0;
  for (const n of g.world.countries[cid].neighbors) {
    if (g.st.owner[n] !== p.id) pressure += g.st.armies[n];
  }
  if (pressure === 0) return 0;
  let score = pressure / Math.max(1, g.st.armies[cid]);
  // Prefer building where an island is nearly ours.
  const isl = g.world.islands[g.world.countries[cid].island];
  const oursOnIsland = isl.countries.filter((c) => g.st.owner[c] === p.id).length;
  if (oursOnIsland >= isl.countries.length - 1) score *= 1.8;
  if (g.st.prodCenters.includes(cid)) score *= 1.3;
  return score;
}

/** Strategic worth of capturing `to` (island/prod/elimination), excluding the
 *  raw odds. Shared by attack scoring and offensive reinforcement. */
function targetValue(g: Game, p: Player, to: number): number {
  const isl = g.world.islands[g.world.countries[to].island];
  const defOwner = g.st.owner[to];
  let v = 0;
  if (isl.countries.every((c) => g.st.owner[c] === p.id || c === to)) v += 3; // completes ours
  if (isl.countries.every((c) => g.st.owner[c] === defOwner)) v += 2; // breaks theirs
  if (g.st.prodCenters.includes(to)) v += 1.5;
  if (g.countriesOf(defOwner).length === 1) v += 4; // elimination blow
  return v;
}

/** Offensive reinforcement: rank an owned country by the best conquest it could
 *  fund this turn (cheap, high-value wins rank highest), with a defensive floor
 *  so a country about to be overrun still draws troops. Builds a spearhead. */
function deployScore(g: Game, p: Player, cid: number): number {
  const a = g.st.armies[cid];
  let offense = 0;
  let pressure = 0;
  for (const to of g.world.countries[cid].neighbors) {
    if (g.st.owner[to] === p.id) continue;
    pressure += g.st.armies[to];
    const need = Math.max(0, Math.ceil(g.st.armies[to] * 1.4) - a); // armies to a safe ratio
    offense = Math.max(offense, (1 + targetValue(g, p, to)) / (1 + need));
  }
  const defense = pressure > a * 1.3 ? (pressure / a) * 0.5 : 0;
  return offense + defense;
}

function placeArmies(g: Game, p: Player, total: number, d: number) {
  const mine = g.countriesOf(p.id);
  const score = caps(d).spearhead
    ? (cid: number) => deployScore(g, p, cid)
    : (cid: number) => frontierScore(g, p, cid);
  for (let i = 0; i < total; i++) {
    let target: number;
    if (d === 0 && Math.random() < 0.5) {
      target = pickRandom(mine);
    } else {
      target = mine.reduce((best, cid) => (score(cid) > score(best) ? cid : best));
      if (score(target) === 0) target = pickRandom(mine);
    }
    g.st.armies[target]++;
  }
}

interface Plan {
  from: number;
  to: number;
  score: number;
}

function opponentStrength(g: Game, pid: number): number {
  let s = g.countriesOf(pid).length;
  for (let i = 0; i < g.st.owner.length; i++) if (g.st.owner[i] === pid) s += g.st.armies[i];
  return Math.max(1, s);
}

function bestAttack(g: Game, p: Player, d: number): Plan | null {
  const minRatio = [1.0, 1.15, 1.25, 1.35][d]; // monotonic: higher rank = more disciplined
  const c = caps(d);
  const plans: Plan[] = [];
  for (const from of g.countriesOf(p.id)) {
    if (g.st.armies[from] < 4) continue; // never risk the forfeit spiral
    for (const to of g.world.countries[from].neighbors) {
      if (!g.canAttack(from, to)) continue;
      const ratio = g.st.armies[from] / Math.max(1, g.st.armies[to]);
      if (ratio < minRatio) continue;
      let score = ratio + targetValue(g, p, to);
      if (c.focusFire) score += 2 / opponentStrength(g, g.st.owner[to]); // pile on the weak
      if (c.consolidate) {
        // Reward captures that plug a hole in our perimeter (most of the
        // target's neighbors are already ours), and penalize attacks that
        // would pull troops forward off a country still facing other enemies.
        const tn = g.world.countries[to].neighbors;
        const mineAround = tn.filter((n) => g.st.owner[n] === p.id).length;
        score += 0.6 * (mineAround / Math.max(1, tn.length));
        let residual = 0;
        for (const n of g.world.countries[from].neighbors)
          if (n !== to && g.st.owner[n] !== p.id) residual += g.st.armies[n];
        score -= Math.min(1.5, (0.4 * residual) / Math.max(1, g.st.armies[from]));
      }
      if (c.lookahead) {
        // Bias toward conquests that put us next to further valuable targets.
        // Admiral (twoPly) also peers one ring beyond at a steeper discount,
        // favoring fronts that advance into rich territory.
        let look = 0;
        for (const next of g.world.countries[to].neighbors) {
          if (g.st.owner[next] === p.id || next === from) continue;
          look = Math.max(look, 0.3 * targetValue(g, p, next));
          if (c.twoPly) {
            for (const after of g.world.countries[next].neighbors)
              if (g.st.owner[after] !== p.id && after !== to && after !== from)
                look = Math.max(look, 0.12 * targetValue(g, p, after));
          }
        }
        score += look;
      }
      plans.push({ from, to, score });
    }
  }
  if (!plans.length) return null;
  if (d === 0) return Math.random() < 0.75 ? pickRandom(plans) : null;
  plans.sort((a, b) => b.score - a.score);
  return plans[0];
}

async function fightOut(g: Game, p: Player, from: number, to: number) {
  while (true) {
    g.requestStopCheck();
    const outcome = g.rollBatch(from, to);
    g.ui.refresh();
    g.ui.infoRight(`${g.st.armies[from]} against ${g.st.armies[to]}`);
    await g.ui.wait(g.st.fastPlayout ? 8 : 130);
    if (outcome === 'forfeit') {
      await g.applyForfeit(from, to);
      return 'forfeit';
    }
    if (outcome === 'conquered') {
      g.ui.toast(`${p.name} seizes country ${to + 1}.`);
      await g.conquer(g.players[p.id], from, to);
      return 'conquered';
    }
    // Break off before the forfeit rule can bite.
    if (g.st.armies[from] <= 3 || !g.canAttack(from, to)) return 'withdrew';
  }
}

function fortify(g: Game, p: Player) {
  // Move idle interior stacks toward the hottest adjacent frontier.
  let best: { from: number; to: number; gain: number } | null = null;
  for (const from of g.countriesOf(p.id)) {
    if (g.st.armies[from] < 3) continue;
    const safe = g.world.countries[from].neighbors.every((n) => g.st.owner[n] === p.id);
    if (!safe) continue;
    for (const to of g.world.countries[from].neighbors) {
      if (g.st.owner[to] !== p.id) continue;
      const gain = frontierScore(g, p, to);
      if (gain > 0 && (!best || gain > best.gain)) best = { from, to, gain };
    }
  }
  if (best) {
    const amt = g.st.armies[best.from] - 1;
    g.st.armies[best.from] -= amt;
    g.st.armies[best.to] += amt;
  }
}
