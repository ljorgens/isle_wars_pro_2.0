// Headless balance & stability simulator: runs all-AI games through the real
// engine with a stub UI.
//
// Usage:
//   npx tsx scripts/sim.ts [gamesPerRank]   self-play balance per difficulty
//   npx tsx scripts/sim.ts ladder [games]   mixed-difficulty head-to-head
//
// Ladder mode seats one AI of each difficulty (Ensign/Captain/Commodore/Admiral)
// and rotates which seat each difficulty occupies across games, so seat bias
// cancels out and the win-rate-by-difficulty column measures relative strength.
import { buildWorld } from '../src/geometry';
import { Game, GameUI } from '../src/engine';
import { COLORS, DIFFICULTIES, Player, Settings } from '../src/types';

const never = (what: string) => () => {
  throw new Error(`sim: engine requested human input (${what})`);
};

const stub: GameUI = {
  refresh() {},
  prompt() {},
  infoLeft() {},
  infoRight() {},
  toast() {},
  shake() {},
  flash() {},
  floatText() {},
  arrow() {},
  wait: () => Promise.resolve(),
  banner: () => Promise.resolve(),
  victory: () => Promise.resolve(),
  setPlayoutMode() {},
  buttons: never('buttons'),
  pickCountry: never('pickCountry'),
  pickAmount: never('pickAmount'),
  pickAmountOrSwitch: never('pickAmountOrSwitch'),
  tradeModal: never('tradeModal'),
  handModal: never('handModal'),
  discardModal: never('discardModal'),
  eliminatedModal: never('eliminatedModal'),
};

const world = buildWorld();
const TURN_LIMIT = 4000;
const fmt = (n: number) => n.toFixed(1);

function makePlayers(): Player[] {
  return [0, 1, 2, 3].map((id) => ({
    id,
    name: `Seat${id}`,
    color: COLORS[id].color,
    colorName: COLORS[id].name,
    human: false,
    alive: true,
    cards: [],
  }));
}

function baseSettings(difficulty: Settings['difficulty']): Settings {
  return {
    difficulty,
    playerColor: 0,
    startingArmies: 35,
    disasterChance: 0.16,
    speed: 0,
    reviveExiles: false,
    turnLimit: TURN_LIMIT,
  };
}

function checkInvariants(game: Game) {
  if (game.st.armies.some((a) => a < 1)) throw new Error('invariant: armies < 1');
  if (game.st.owner.some((o) => o < 0 || o > 3)) throw new Error('invariant: bad owner');
}

async function runRanks(games: number) {
  for (const difficulty of [0, 1, 2, 3] as const) {
    const turns: number[] = [];
    const seatWins = [0, 0, 0, 0];
    let capped = 0;
    const t0 = Date.now();

    for (let i = 0; i < games; i++) {
      const game = new Game(world, baseSettings(difficulty), makePlayers(), stub);
      const end = await game.run();
      checkInvariants(game);
      if (!end.winner) {
        capped++;
        continue;
      }
      seatWins[end.winner.id]++;
      turns.push(Math.ceil(game.st.turn / 4));
    }

    const avg = turns.reduce((s, t) => s + t, 0) / Math.max(1, turns.length);
    const sorted = [...turns].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    console.log(
      `rank ${difficulty}: ${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
        `rounds avg ${fmt(avg)} / med ${med} / max ${max} · ` +
        `seat wins ${seatWins.join('/')}` +
        (capped ? ` · ${capped} HIT TURN CAP` : ''),
    );
  }
  console.log('sim complete — no hangs, no invariant violations.');
}

async function runLadder(games: number) {
  // One AI of each difficulty; rotate difficulty→seat assignment per game.
  const winsByDiff = [0, 0, 0, 0];
  const gamesByDiff = [0, 0, 0, 0]; // each difficulty plays every game; for clarity
  let capped = 0;
  const t0 = Date.now();

  for (let i = 0; i < games; i++) {
    const players = makePlayers();
    const offset = i % 4;
    for (const p of players) {
      const diff = (p.id + offset) % 4;
      p.aiDifficulty = diff;
      p.name = `${DIFFICULTIES[diff]}`;
      gamesByDiff[diff]++;
    }
    // settings.difficulty is ignored once every player has aiDifficulty set.
    const game = new Game(world, baseSettings(0), players, stub);
    const end = await game.run();
    checkInvariants(game);
    if (!end.winner) {
      capped++;
      continue;
    }
    winsByDiff[end.winner.aiDifficulty!]++;
  }

  const decided = games - capped;
  console.log(
    `ladder: ${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
      (capped ? ` · ${capped} HIT TURN CAP` : ''),
  );
  console.log('  difficulty        wins    win%   (expected 25% if no skill edge)');
  for (let d = 0; d < 4; d++) {
    const pct = decided ? (100 * winsByDiff[d]) / decided : 0;
    console.log(
      `  ${DIFFICULTIES[d].padEnd(12)}  ${String(winsByDiff[d]).padStart(6)}  ${fmt(pct).padStart(6)}%`,
    );
  }
  console.log('sim complete — no hangs, no invariant violations.');
}

const mode = process.argv[2];
if (mode === 'ladder') {
  await runLadder(Number(process.argv[3] ?? 200));
} else {
  await runRanks(Number(process.argv[2] ?? 100));
}
