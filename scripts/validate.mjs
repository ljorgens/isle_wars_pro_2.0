// Validates the hand-authored map grid in src/mapdata.ts.
// Checks: row count/widths, 46 countries present, country contiguity,
// island contiguity, island membership matches ISLANDS metadata, and
// sea lanes connect coastal countries on different islands.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/mapdata.ts'), 'utf8');

const gridMatch = src.match(/export const GRID: string\[\] = \[([\s\S]*?)\];/);
if (!gridMatch) throw new Error('GRID not found');
const rows = [...gridMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);

const alphaMatch = src.match(/export const ALPHABET = '([^']+)'/);
const ALPHABET = alphaMatch[1];

const islandsMatch = src.match(/export const ISLANDS[\s\S]*?= \[([\s\S]*?)\];/);
const islands = [...islandsMatch[1].matchAll(/name: '([^']+)',\s*bonus: (\d+),\s*symbols: '([^']+)'/g)]
  .map((m) => ({ name: m[1], bonus: +m[2], symbols: m[3] }));

const lanesMatch = src.match(/export const LANES[\s\S]*?= \[([\s\S]*?)\];/);
const lanes = [...lanesMatch[1].matchAll(/\['(.)', '(.)'\]/g)].map((m) => [m[1], m[2]]);

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL:', msg); };

// --- row shape ---
const COLS = +src.match(/GRID_COLS = (\d+)/)[1];
const ROWS = +src.match(/GRID_ROWS = (\d+)/)[1];
if (rows.length !== ROWS) fail(`expected ${ROWS} rows, got ${rows.length}`);
rows.forEach((r, i) => {
  if (r.length !== COLS) fail(`row ${i} has length ${r.length}, expected ${COLS}`);
});

// --- collect cells ---
const cells = new Map(); // symbol -> [[c,r],...]
rows.forEach((row, r) => {
  [...row].forEach((ch, c) => {
    if (ch === '.') return;
    if (!ALPHABET.includes(ch)) fail(`unknown symbol '${ch}' at r${r} c${c}`);
    if (!cells.has(ch)) cells.set(ch, []);
    cells.get(ch).push([c, r]);
  });
});
if (cells.size !== 46) fail(`expected 46 countries, found ${cells.size}`);
for (const ch of ALPHABET) if (!cells.has(ch)) fail(`country '${ch}' has no cells`);

// --- contiguity (4-connected) ---
function contiguous(cellList) {
  const set = new Set(cellList.map(([c, r]) => `${c},${r}`));
  const seen = new Set();
  const stack = [cellList[0]];
  seen.add(`${cellList[0][0]},${cellList[0][1]}`);
  while (stack.length) {
    const [c, r] = stack.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`;
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([c + dc, r + dr]); }
    }
  }
  return seen.size === set.size;
}
for (const [ch, list] of cells) {
  if (!contiguous(list)) fail(`country '${ch}' is not contiguous`);
}

// --- island checks ---
const symToIsland = new Map();
islands.forEach((isl, i) => [...isl.symbols].forEach((s) => symToIsland.set(s, i)));
const allSyms = islands.map((i) => i.symbols).join('');
if (allSyms.length !== 46) fail(`island metadata covers ${allSyms.length} countries, expected 46`);
for (const ch of ALPHABET) if (!symToIsland.has(ch)) fail(`country '${ch}' not assigned to an island`);

islands.forEach((isl) => {
  const list = [...isl.symbols].flatMap((s) => cells.get(s) ?? []);
  if (list.length && !contiguous(list)) fail(`island '${isl.name}' is not contiguous`);
});

// islands must not touch each other
rows.forEach((row, r) => {
  [...row].forEach((ch, c) => {
    if (ch === '.') return;
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const nb = rows[r + dr]?.[c + dc];
      if (nb && nb !== '.' && symToIsland.get(nb) !== symToIsland.get(ch)) {
        fail(`islands touch at r${r} c${c} ('${ch}' vs '${nb}')`);
      }
    }
  });
});

// --- lanes ---
const laneIslands = new Set();
lanes.forEach(([a, b]) => {
  if (!cells.has(a) || !cells.has(b)) { fail(`lane ${a}-${b} references unknown country`); return; }
  const ia = symToIsland.get(a), ib = symToIsland.get(b);
  if (ia === ib) fail(`lane ${a}-${b} connects countries on the same island`);
  laneIslands.add(`${Math.min(ia, ib)}-${Math.max(ia, ib)}`);
});

// island graph connectivity via lanes
const adj = new Map(islands.map((_, i) => [i, new Set()]));
for (const key of laneIslands) {
  const [a, b] = key.split('-').map(Number);
  adj.get(a).add(b); adj.get(b).add(a);
}
const seenI = new Set([0]); const stackI = [0];
while (stackI.length) {
  const i = stackI.pop();
  for (const j of adj.get(i)) if (!seenI.has(j)) { seenI.add(j); stackI.push(j); }
}
if (seenI.size !== islands.length) fail(`island graph not connected via lanes (reached ${seenI.size}/${islands.length})`);

// --- summary ---
const sizes = islands.map((isl) => `${isl.name}: ${isl.symbols.length} countries, +${isl.bonus}`);
if (failures === 0) {
  console.log('Map OK — 46 countries, 9 islands, all contiguous, lanes connect all islands.');
  console.log(sizes.join('\n'));
} else {
  console.error(`${failures} problem(s) found.`);
  process.exit(1);
}
