// Bootstrap: title screen → game loop → back to port.
import { buildWorld } from './geometry';
import { Game, GameEnd, loadScores, recordScore } from './engine';
import { Renderer } from './render';
import { Ui } from './ui';
import { AI_NAMES, CARD_HINT, CARD_LABEL, COLORS, DIFFICULTIES, Player, Settings } from './types';
import { isMuted, setMuted } from './sfx';
import './style.css';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const world = buildWorld();
const renderer = new Renderer(world);
renderer.init($('#map') as unknown as SVGSVGElement);
const ui = new Ui(renderer);

let game: Game | null = null;

// ----- segmented controls -----
document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  });
});

const segValue = (name: string): number =>
  Number(document.querySelector<HTMLElement>(`.seg[data-name="${name}"] button.on`)!.dataset.v);

function renderScores(target: HTMLElement) {
  const s = loadScores();
  const rows = DIFFICULTIES.map((d) => {
    const r = s[d] ?? { w: 0, l: 0 };
    return `<tr><td>${d}</td><td>${r.w}</td><td>${r.l}</td></tr>`;
  }).join('');
  target.innerHTML = `<table class="scores"><thead><tr><th>Rank</th><th>Won</th><th>Lost</th></tr></thead><tbody>${rows}</tbody></table>`;
}

renderScores($('#t-scores'));

// ----- start game -----
$('#setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings: Settings = {
    difficulty: segValue('difficulty') as Settings['difficulty'],
    playerColor: segValue('color'),
    startingArmies: segValue('armies'),
    disasterChance: segValue('disaster'),
    speed: segValue('speed'),
    reviveExiles: segValue('revive') === 1,
  };

  const humanCount = segValue('humans');
  const colorOrder = [settings.playerColor, ...[0, 1, 2, 3].filter((i) => i !== settings.playerColor)];
  const players: Player[] = colorOrder.map((ci, i) => {
    const human = i < humanCount;
    return {
      id: i,
      name: human
        ? humanCount === 1
          ? 'You'
          : `Player ${i + 1}`
        : AI_NAMES[i - humanCount] ?? 'Capt. Reyes',
      color: COLORS[ci].color,
      colorName: COLORS[ci].name,
      human,
      alive: true,
      cards: [],
    };
  });

  renderer.setPlayerColors(players.map((p) => p.color));
  ui.speed = settings.speed;

  $('#title-screen').hidden = true;
  $('#game-screen').hidden = false;

  game = new Game(world, settings, players, ui);
  ui.bind(game.st);

  const end: GameEnd = await game.run();
  const diffName = DIFFICULTIES[settings.difficulty];
  if (end.winner) {
    recordScore(diffName, end.winner.human);
    await ui.victory(end.winner);
  } else if (end.conceded) {
    recordScore(diffName, false);
  }
  backToPort();
});

function backToPort() {
  game = null;
  ui.setPlayoutMode(false, () => {});
  $('#game-screen').hidden = true;
  $('#title-screen').hidden = false;
  renderScores($('#t-scores'));
}

// ----- menu bar -----
$('#m-new').addEventListener('click', () => {
  if (!game) return location.reload();
  const human = game.players.find((p) => p.human)!;
  const owned = game.countriesOf(human.id).length;
  const warn =
    owned < 10
      ? 'You hold fewer than 10 countries — abandoning now will be logged as a LOSS. Start a new game anyway?'
      : 'Abandon this war and start a new game?';
  if (confirm(warn)) {
    if (owned < 10) recordScore(DIFFICULTIES[game.settings.difficulty], false);
    location.reload();
  }
});
$('#m-quit').addEventListener('click', () => {
  if (!game) return location.reload();
  const human = game.players.find((p) => p.human)!;
  const owned = game.countriesOf(human.id).length;
  const warn =
    owned < 10
      ? 'You hold fewer than 10 countries — quitting now will be logged as a LOSS. Quit anyway?'
      : 'Quit this game?';
  if (confirm(warn)) {
    if (owned < 10) recordScore(DIFFICULTIES[game.settings.difficulty], false);
    location.reload();
  }
});
const soundBtn = $('#m-sound');
const syncSoundLabel = () => (soundBtn.textContent = isMuted() ? 'Sound: Off' : 'Sound: On');
syncSoundLabel();
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  syncSoundLabel();
});

$('#m-scores').addEventListener('click', () => {
  const m = $('#modal');
  $('#modal-scrim').hidden = false;
  m.innerHTML = `<h2>Ship's Log</h2><div id="modal-scores"></div>
    <div class="m-actions"><button class="btn ghost" id="m-close">Close</button></div>`;
  renderScores($('#modal-scores'));
  m.querySelector('#m-close')!.addEventListener('click', () => ($('#modal-scrim').hidden = true));
});
$('#m-help').addEventListener('click', () => {
  const m = $('#modal');
  $('#modal-scrim').hidden = false;
  m.innerHTML = `<h2>How to Play</h2>
    <div class="help-body">
      <p><strong>Object.</strong> Conquer all nine islands.</p>
      <p><strong>Reinforcements.</strong> Each turn you receive your countries ÷ 3 in armies (minimum 2),
      plus a bonus for every island you wholly control.</p>
      <p><strong>Attacking.</strong> You may attack an adjacent country (or across a sea lane) only if your
      stack is <em>equal or greater</em> than the defender's. Each clash costs the loser one army — ties favor
      the defender. <em>Beware:</em> if your attacking force is ever worn down to a single army, you forfeit
      your turn <em>and the country itself</em> to the defender. Use <strong>Auto</strong> to roll
      repeatedly without clicking — it stops the moment the battle resolves or reaches the brink
      (your force down to 2, or the defender down to 1), handing each remaining clash back to you.</p>
      <p><strong>Conquest.</strong> Reduce a defender to zero and march at least one army in. Capture any
      country during your turn and you draw a card.</p>
      <p><strong>Cards.</strong> Trade three matching cards (wilds count) at the start of a turn for armies.
      Bombard cards shell any enemy country; Wards block enemy bombardments; Rally doubles your next
      reinforcement; Mutiny costs you your whole hand. You may hold five cards.</p>
      <p><strong>The Isles are restless.</strong> Earthquakes, floods and rebellions strike without warning.
      Production centers (⚓, light-blue counts) drift between countries and sometimes double the armies
      stationed on them.</p>
      <p><strong>Moving.</strong> End your turn by moving troops once between two adjacent countries, or pass.</p>
    </div>
    <div class="m-actions"><button class="btn ghost" id="m-close">Close</button></div>`;
  m.querySelector('#m-close')!.addEventListener('click', () => ($('#modal-scrim').hidden = true));
});

// ----- card reference -----
// Glossary of every card a player may hold or draw. Army sets share one entry;
// Mutiny is drawn-only (not a held CardFace) so it is listed by hand.
const CARD_REF: { label: string; desc: string; detail?: string }[] = [
  {
    label: CARD_LABEL['5'],
    desc: 'Levy / Muster / Host — the three army cards.',
    detail: 'Trade a set of three matching cards (wilds count) at the top of your turn for bonus armies — 3× the face value (e.g. three Hosts → 45).',
  },
  { label: CARD_LABEL.double, desc: CARD_HINT.double },
  { label: CARD_LABEL.bomb, desc: CARD_HINT.bomb, detail: 'Cuts the target to a third of its armies (a Ward blocks it).' },
  { label: CARD_LABEL.antibomb, desc: CARD_HINT.antibomb },
  { label: CARD_LABEL.wild, desc: CARD_HINT.wild },
  { label: '☠ Mutiny', desc: 'Drawn, never held: the instant it comes up, your entire hand is lost.' },
];

$('#m-cards').addEventListener('click', () => {
  const m = $('#modal');
  $('#modal-scrim').hidden = false;
  const rows = CARD_REF.map(
    (c) => `<div class="card-ref-row">
      <span class="card-chip" aria-hidden="true">${c.label}</span>
      <span class="ref-desc">${c.desc}${c.detail ? `<span class="ref-detail">${c.detail}</span>` : ''}</span>
    </div>`,
  ).join('');
  m.innerHTML = `<h2>Card Reference</h2>
    <p class="m-note">Capture at least one country on your turn to draw a card (hand limit five).</p>
    <div class="card-ref">${rows}</div>
    <div class="m-actions"><button class="btn ghost" id="m-close">Close</button></div>`;
  m.querySelector('#m-close')!.addEventListener('click', () => ($('#modal-scrim').hidden = true));
});
