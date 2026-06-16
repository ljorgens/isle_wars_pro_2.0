export type CardFace = '5' | '8' | '15' | 'double' | 'bomb' | 'antibomb' | 'wild';

export interface Player {
  id: number;
  name: string;
  color: string; // css color
  colorName: string;
  human: boolean;
  alive: boolean;
  cards: CardFace[];
  /** Per-AI difficulty override; falls back to Settings.difficulty when unset. */
  aiDifficulty?: number;
  /** Whether this captain has already returned once (revival is one-per-player). */
  revived?: boolean;
  /** Hand held at the moment of elimination, restored if they return from exile. */
  bankedCards?: CardFace[];
}

export interface Settings {
  difficulty: 0 | 1 | 2 | 3;
  playerColor: number; // index into COLORS
  startingArmies: number; // extra armies beyond 1 per country
  disasterChance: number; // probability per turn-end
  speed: number; // delay multiplier
  reviveExiles: boolean; // opt-in: a rare event can return a defeated captain
  turnLimit?: number; // safety cap for headless simulation
}

/** A single line in the running game log the player can review at any time. */
export type LogTone = 'turn' | 'combat' | 'event' | 'card' | 'info';

export interface LogEntry {
  round: number; // game round (turn ÷ players), as shown to the player
  text: string;
  tone: LogTone;
}

export interface GameState {
  owner: number[]; // country id -> player id
  armies: number[]; // country id -> troop count
  prodCenters: number[]; // country ids hosting production centers
  players: Player[];
  current: number;
  turn: number;
  fastPlayout: boolean;
  log: LogEntry[]; // chronological record of every action this game
}

export const COLORS = [
  { name: 'Cobalt', color: '#3e6fb0', light: '#6f9fd8' },
  { name: 'Gold', color: '#b8932f', light: '#dcc06a' },
  { name: 'Crimson', color: '#a33a30', light: '#cf6f64' },
  { name: 'Jade', color: '#2f8465', light: '#65b294' },
];

export const AI_NAMES = ['Cmdre. Vane', 'Capt. Mor', 'Lady Hale'];

export const DIFFICULTIES = ['Ensign', 'Captain', 'Commodore', 'Admiral'] as const;

export const CARD_LABEL: Record<CardFace, string> = {
  '5': 'Ⅴ Levy',
  '8': 'Ⅷ Muster',
  '15': 'ⅩⅤ Host',
  double: '✕2 Rally',
  bomb: '✸ Bombard',
  antibomb: '⛨ Ward',
  wild: '★ Letter of Marque',
};

export const CARD_HINT: Record<CardFace, string> = {
  '5': 'Trade in a set of three for bonus armies.',
  '8': 'Trade in a set of three for bonus armies.',
  '15': 'Trade in a set of three for bonus armies.',
  double: 'Doubles your reinforcements at the start of your next turn.',
  bomb: 'Play during your turn to bombard any enemy country.',
  antibomb: 'Automatically wards off one enemy bombardment.',
  wild: 'Stands in for any card when trading a set.',
};

export const HAND_LIMIT = 5;

/** Result of an amount stepper that also allows re-picking a country. */
export type AmountResult =
  | { kind: 'amount'; value: number }
  | { kind: 'switch'; id: number }
  | { kind: 'cancel' };
