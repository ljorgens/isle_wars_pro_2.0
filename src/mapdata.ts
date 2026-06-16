// Tempest Isles — original map definition.
// Each character in GRID is one map cell; each distinct character is one
// country (46 total). '.' is open sea. Geometry, adjacency and coastlines
// are derived from this grid at load time (see geometry.ts).

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';

export const GRID_COLS = 60;
export const GRID_ROWS = 35;

// prettier-ignore
export const GRID: string[] = [
  '............................................................',
  '............................................................',
  '...................33444....................................',
  '..................33344455...............CDDD...............',
  '..................333444555..............CCCDD..............',
  '..................666777888..............EEFFF..............',
  '..................666777888...............EEFF..............',
  '...000.............99AAA88..................................',
  '..00011............99AAABBB.................................',
  '..000111............9AAABB..................................',
  '..222111....................................................',
  '...22211..............................PPQQ..................',
  '....222..............................PPPQQQRR...............',
  '....................................PPPQQQRRRR..............',
  '......................LLMM..........SSSTTTRRR...............',
  '....GGH..............LLLMMM.........SSSTTTUUU...............',
  '...GGGHH.............NNNOOO..........SSTTTUUU...............',
  '..GGGHHHH............NNNOOO...........STTUU.................',
  '..IIIJJJJ.............NOO..............TUU..................',
  '..IIIJJJ....................................................',
  '...IKKJJ....................................................',
  '....KKKJ....................................................',
  '.....KKK....................................................',
  '...........................aabb.............................',
  '..........................aaabbb............................',
  '.........VVWW............aaabbbcc...........................',
  '........VVVWWW..........aaabbbccc.........gghh..............',
  '.......VVVWWWW..........dddeeeccc........ggghhh.............',
  '.......XXXYYYY..........dddeeefff........iiijjj.............',
  '.......XXXYYZZZ..........ddeeeff..........iijj..............',
  '........XXYYZZZ...........deeeff............................',
  '..........YZZZ.............eeef.............................',
  '............................................................',
  '............................................................',
  '............................................................',
];

export interface IslandMeta {
  name: string;
  bonus: number;
  /** country symbols belonging to this island */
  symbols: string;
}

// Bonus multiset {8,5,5,4,4,3,2,2,2} mirrors the original's island values.
export const ISLANDS: IslandMeta[] = [
  { name: 'Skerryholm',  bonus: 2, symbols: '012' },
  { name: 'Stormcrown',  bonus: 8, symbols: '3456789AB' },
  { name: 'The Cays',    bonus: 2, symbols: 'CDEF' },
  { name: 'Boreas',      bonus: 4, symbols: 'GHIJK' },
  { name: 'Midmark',     bonus: 3, symbols: 'LMNO' },
  { name: 'Levanter',    bonus: 5, symbols: 'PQRSTU' },
  { name: 'Auster',      bonus: 4, symbols: 'VWXYZ' },
  { name: 'Mistral',     bonus: 5, symbols: 'abcdef' },
  { name: 'Ember Atoll', bonus: 2, symbols: 'ghij' },
];

// Sea lanes: ship routes connecting islands (pairs of country symbols).
export const LANES: [string, string][] = [
  ['0', '3'], // Skerryholm – Stormcrown
  ['2', 'G'], // Skerryholm – Boreas
  ['5', 'C'], // Stormcrown – The Cays
  ['A', 'L'], // Stormcrown – Midmark
  ['B', 'P'], // Stormcrown – Levanter
  ['F', 'Q'], // The Cays – Levanter
  ['H', 'N'], // Boreas – Midmark
  ['K', 'V'], // Boreas – Auster
  ['O', 'S'], // Midmark – Levanter
  ['O', 'a'], // Midmark – Mistral
  ['U', 'g'], // Levanter – Ember Atoll
  ['Z', 'd'], // Auster – Mistral
  ['f', 'i'], // Mistral – Ember Atoll
];

export const CELL = 18; // px per grid cell in SVG space
