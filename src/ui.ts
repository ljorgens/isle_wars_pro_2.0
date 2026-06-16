// DOM interaction layer implementing the GameUI contract used by the engine.
import type { GameUI } from './engine';
import type { Renderer } from './render';
import { AmountResult, CARD_HINT, CARD_LABEL, CardFace, GameState, Player } from './types';
import { sfx } from './sfx';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Ui implements GameUI {
  st!: GameState;
  speed = 1;
  private clickResolver: ((id: number) => void) | null = null;
  private stopHandler: (() => void) | null = null;

  constructor(public renderer: Renderer) {
    renderer.onCountryClick = (id) => this.clickResolver?.(id);
    $('#btn-stop').addEventListener('click', () => this.stopHandler?.());
  }

  bind(st: GameState) {
    this.st = st;
  }

  // ---------- core surfaces ----------

  refresh() {
    this.renderer.refresh(this.st);
    const top = $('#players');
    top.innerHTML = '';
    const soloHuman = this.st.players.filter((pl) => pl.human).length === 1;
    for (const p of this.st.players) {
      const owned = this.st.owner.filter((o) => o === p.id).length;
      const troops = this.st.armies.reduce((s, a, i) => (this.st.owner[i] === p.id ? s + a : s), 0);
      const div = document.createElement('div');
      // Viewable only for your own hand: always in solo (so you can peek during
      // AI turns too), but in hotseat only the player currently to command —
      // so one human can't read another's hand off the shared screen.
      const viewable = p.human && p.alive && (soloHuman || p.id === this.st.current);
      div.className =
        'plaque' +
        (p.id === this.st.current ? ' active' : '') +
        (p.alive ? '' : ' dead') +
        (viewable ? ' viewable' : '');
      div.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span class="p-name">${p.name}</span>
        <span class="p-stats">${p.alive ? `${owned} ctys · ${troops} men · ${p.cards.length} cards` : 'lost at sea'}</span>`;
      if (viewable) {
        div.title = 'View your hand';
        div.addEventListener('click', () => this.showHand(p));
      }
      top.appendChild(div);
    }
  }

  prompt(text: string) {
    $('#prompt').textContent = text;
  }
  infoLeft(text: string) {
    $('#info-left').textContent = text;
  }
  infoRight(text: string) {
    $('#info-right').textContent = text;
  }
  toast(text: string) {
    const log = $('#ticker');
    log.textContent = text;
    log.classList.remove('tick-in');
    void log.offsetWidth;
    log.classList.add('tick-in');
  }

  wait(ms: number) {
    return new Promise<void>((res) => setTimeout(res, ms * this.speed * (this.st?.fastPlayout ? 0.12 : 1)));
  }

  // ---------- buttons ----------

  buttons(opts: { label: string; id: string; kind?: 'primary' | 'danger' | 'ghost' }[]): Promise<string> {
    const bar = $('#controls');
    bar.innerHTML = '';
    return new Promise((resolve) => {
      for (const o of opts) {
        const b = document.createElement('button');
        b.className = `btn ${o.kind ?? ''}`;
        b.textContent = o.label;
        b.addEventListener('click', () => {
          sfx.tick();
          bar.innerHTML = '';
          resolve(o.id);
        });
        bar.appendChild(b);
      }
    });
  }

  clearControls() {
    $('#controls').innerHTML = '';
  }

  // ---------- country picking ----------

  pickCountry(ids: number[], promptText: string, cancelable: boolean): Promise<number | null> {
    this.prompt(promptText);
    this.renderer.setPickable(ids);
    const bar = $('#controls');
    bar.innerHTML = '';
    return new Promise((resolve) => {
      const done = (val: number | null) => {
        this.clickResolver = null;
        this.renderer.setPickable([]);
        bar.innerHTML = '';
        resolve(val);
      };
      this.clickResolver = (id) => {
        if (ids.includes(id)) done(id);
      };
      if (cancelable) {
        const b = document.createElement('button');
        b.className = 'btn ghost';
        b.textContent = 'Cancel';
        b.addEventListener('click', () => done(null));
        bar.appendChild(b);
      }
    });
  }

  // ---------- amount stepper ----------

  /**
   * Amount stepper. If switchIds is given, those countries stay clickable
   * while the stepper is open — clicking one re-targets the selection.
   */
  pickAmountOrSwitch(opts: {
    min: number;
    max: number;
    title: string;
    cancelable?: boolean;
    switchIds?: number[];
  }): Promise<AmountResult> {
    const bar = $('#controls');
    bar.innerHTML = '';
    this.prompt(opts.title);
    let value = opts.max;
    const switchIds = opts.switchIds ?? [];
    return new Promise((resolve) => {
      const done = (r: AmountResult) => {
        this.clickResolver = null;
        this.renderer.setPickable([]);
        bar.innerHTML = '';
        resolve(r);
      };
      if (switchIds.length) {
        this.renderer.setPickable(switchIds);
        this.clickResolver = (id) => {
          if (switchIds.includes(id)) done({ kind: 'switch', id });
        };
      }
      const readout = document.createElement('span');
      readout.className = 'amt-readout';
      const update = () => (readout.textContent = `${value} / ${opts.max}`);
      const mk = (label: string, fn: () => void, cls = 'btn step') => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.addEventListener('click', fn);
        bar.appendChild(b);
        return b;
      };
      mk('−10', () => { value = Math.max(opts.min, value - 10); update(); });
      mk('−1', () => { value = Math.max(opts.min, value - 1); update(); });
      bar.appendChild(readout);
      mk('+1', () => { value = Math.min(opts.max, value + 1); update(); });
      mk('+10', () => { value = Math.min(opts.max, value + 10); update(); });
      mk('All', () => { value = opts.max; update(); });
      mk('✓ Confirm', () => done({ kind: 'amount', value }), 'btn primary');
      if (opts.cancelable) mk('Cancel', () => done({ kind: 'cancel' }), 'btn ghost');
      update();
    });
  }

  async pickAmount(opts: { min: number; max: number; title: string; cancelable?: boolean }): Promise<number | null> {
    const r = await this.pickAmountOrSwitch(opts);
    return r.kind === 'amount' ? r.value : null;
  }

  // ---------- banners ----------

  banner(title: string, sub = '', tone: 'storm' | 'war' | 'gold' = 'gold'): Promise<void> {
    if (tone === 'storm') sfx.rumble();
    else if (tone === 'war') sfx.rout();
    else sfx.chime();
    const b = $('#banner');
    b.className = `show ${tone}`;
    b.innerHTML = `<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    const hold = this.st?.fastPlayout ? 260 : 1500 * this.speed;
    return new Promise((res) =>
      setTimeout(() => {
        b.className = '';
        setTimeout(res, 180);
      }, hold),
    );
  }

  // ---------- map effects (delegate) ----------

  shake(ids: number[]) {
    sfx.clash();
    this.renderer.shake(ids);
  }
  flash(ids: number[], color?: string) {
    this.renderer.flash(ids, color);
  }
  floatText(id: number, text: string, color?: string) {
    this.renderer.floatText(id, text, color);
  }
  arrow(id: number | null) {
    this.renderer.arrow(id);
  }

  // ---------- modals ----------

  private modal(html: string): HTMLElement {
    const scrim = $('#modal-scrim');
    const modal = $('#modal');
    modal.innerHTML = html;
    scrim.hidden = false;
    return modal;
  }

  closeModal() {
    $('#modal-scrim').hidden = true;
  }

  private cardChip(c: CardFace, idx: number, selectable: boolean): string {
    return `<button class="card-chip" data-idx="${idx}" ${selectable ? '' : 'disabled'} title="${CARD_HINT[c]}">
      ${CARD_LABEL[c]}</button>`;
  }

  tradeModal(p: Player): Promise<CardFace[] | null> {
    const chips = p.cards.map((c, i) => this.cardChip(c, i, true)).join('');
    const m = this.modal(`
      <h2>${p.name === 'You' ? 'Trade In Cards' : `${p.name} — Trade In Cards`}</h2>
      <p class="m-note">Select three matching cards (wilds stand in for any). Sets may only be traded now, at the top of your turn.</p>
      <div class="card-row">${chips}</div>
      <div class="m-actions">
        <button class="btn primary" id="m-trade" disabled>Trade In Cards</button>
        <button class="btn ghost" id="m-keep">Keep Hand</button>
      </div>`);
    return new Promise((resolve) => {
      const selected = new Set<number>();
      const tradeBtn = m.querySelector('#m-trade') as HTMLButtonElement;
      const validSet = () => {
        if (selected.size !== 3) return false;
        const faces = [...selected].map((i) => p.cards[i]);
        const wilds = faces.filter((f) => f === 'wild').length;
        const armies = faces.filter((f) => f === '5' || f === '8' || f === '15');
        return wilds < 3 && new Set(armies).size === 1 && armies.length + wilds === 3;
      };
      m.querySelectorAll<HTMLButtonElement>('.card-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const idx = Number(chip.dataset.idx);
          if (selected.has(idx)) selected.delete(idx);
          else if (selected.size < 3) selected.add(idx);
          chip.classList.toggle('sel', selected.has(idx));
          tradeBtn.disabled = !validSet();
        });
      });
      tradeBtn.addEventListener('click', () => {
        this.closeModal();
        resolve([...selected].map((i) => p.cards[i]));
      });
      m.querySelector('#m-keep')!.addEventListener('click', () => {
        this.closeModal();
        resolve(null);
      });
    });
  }

  /** Read-only peek at a hand, openable any time from the player's plaque. */
  showHand(p: Player) {
    if (!$('#modal-scrim').hidden) return; // don't clobber a modal that's mid-prompt
    const chips = p.cards.length
      ? p.cards.map((c, i) => this.cardChip(c, i, false)).join('')
      : '<p class="m-note">Your hand is empty. Capture a country on your turn to earn a card.</p>';
    const m = this.modal(`
      <h2>${p.name === 'You' ? 'Your Hand' : `${p.name}'s Hand`}</h2>
      <p class="m-note">You hold ${p.cards.length} of 5 cards. Play Bombard from the Cards button during your action phase.</p>
      <div class="card-row">${chips}</div>
      <div class="m-actions"><button class="btn ghost" id="m-close">Close</button></div>`);
    m.querySelector('#m-close')!.addEventListener('click', () => this.closeModal());
  }

  handModal(p: Player, canBomb: boolean): Promise<'bomb' | null> {
    const chips = p.cards.length
      ? p.cards.map((c, i) => this.cardChip(c, i, false)).join('')
      : '<p class="m-note">Your hand is empty. Capture a country this turn to earn a card.</p>';
    const m = this.modal(`
      <h2>${p.name === 'You' ? 'Your Hand' : `${p.name}'s Hand`}</h2>
      <div class="card-row">${chips}</div>
      <div class="m-actions">
        ${canBomb ? '<button class="btn danger" id="m-bomb">✸ Play Bombard</button>' : ''}
        <button class="btn ghost" id="m-close">Close</button>
      </div>`);
    return new Promise((resolve) => {
      m.querySelector('#m-bomb')?.addEventListener('click', () => {
        this.closeModal();
        resolve('bomb');
      });
      m.querySelector('#m-close')!.addEventListener('click', () => {
        this.closeModal();
        resolve(null);
      });
    });
  }

  discardModal(p: Player): Promise<number> {
    const chips = p.cards.map((c, i) => this.cardChip(c, i, true)).join('');
    const m = this.modal(`
      <h2>Hand Overfull</h2>
      <p class="m-note">You may hold only five cards. Choose one to cast overboard.</p>
      <div class="card-row">${chips}</div>`);
    return new Promise((resolve) => {
      m.querySelectorAll<HTMLButtonElement>('.card-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          this.closeModal();
          resolve(Number(chip.dataset.idx));
        });
      });
    });
  }

  eliminatedModal(): Promise<'concede' | 'watch'> {
    const m = this.modal(`
      <h2>Swept From the Isles</h2>
      <p class="m-note">Your last country has fallen. The loss is entered in the ship's log.</p>
      <div class="m-actions">
        <button class="btn primary" id="m-watch">Watch the War Play Out</button>
        <button class="btn ghost" id="m-concede">Concede &amp; Return to Port</button>
      </div>`);
    return new Promise((resolve) => {
      m.querySelector('#m-watch')!.addEventListener('click', () => {
        this.closeModal();
        resolve('watch');
      });
      m.querySelector('#m-concede')!.addEventListener('click', () => {
        this.closeModal();
        resolve('concede');
      });
    });
  }

  victory(winner: Player): Promise<void> {
    if (winner.human) sfx.fanfare();
    else sfx.rout();
    const human = winner.human;
    const m = this.modal(`
      <h2>${human ? '⚜ VICTORY ⚜' : 'THE ISLES ARE LOST'}</h2>
      <p class="m-note">${
        human
          ? 'All nine islands fly your colors. The Tempest Isles are yours.'
          : `${winner.name} now rules all nine islands.`
      }</p>
      <div class="m-actions"><button class="btn primary" id="m-again">Return to Port</button></div>`);
    return new Promise((resolve) => {
      m.querySelector('#m-again')!.addEventListener('click', () => {
        this.closeModal();
        resolve();
      });
    });
  }

  setPlayoutMode(on: boolean, onStop: () => void) {
    this.stopHandler = onStop;
    $('#btn-stop').hidden = !on;
  }
}
