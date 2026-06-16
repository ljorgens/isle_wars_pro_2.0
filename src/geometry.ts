// Turns the ASCII cell grid into renderable geometry: smoothed country
// polygons, island outlines, centroids, and the adjacency graph.
import { ALPHABET, CELL, GRID, ISLANDS, LANES } from './mapdata';

export interface Country {
  id: number; // 0..45
  symbol: string;
  island: number;
  cells: [number, number][];
  centroid: [number, number]; // svg coords
  path: string;
  neighbors: number[]; // land adjacency + sea lanes
  laneNeighbors: number[]; // subset connected via sea lane
}

export interface Island {
  id: number;
  name: string;
  bonus: number;
  countries: number[];
  path: string;
  labelAt: [number, number];
}

export interface WorldMap {
  countries: Country[];
  islands: Island[];
  lanes: [number, number][]; // country id pairs
  width: number;
  height: number;
}

type Pt = [number, number];

const key = (c: number, r: number) => c * 1000 + r;

/** Deterministic jitter so shared vertices between countries stay welded. */
function jitter([x, y]: Pt): Pt {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  const a = ((h & 0xffff) / 0xffff - 0.5) * 0.42;
  const b = (((h >> 16) & 0x7fff) / 0x7fff - 0.5) * 0.42;
  return [x + a, y + b];
}

/** Trace the outer boundary of a set of grid cells (clockwise loop). */
function traceBoundary(cells: [number, number][]): Pt[] {
  const inSet = new Set(cells.map(([c, r]) => key(c, r)));
  // Directed boundary edges; interior is kept on the right as we walk.
  const edges = new Map<string, Pt[]>(); // start point -> list of end points
  const addEdge = (a: Pt, b: Pt) => {
    const k = `${a[0]},${a[1]}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k)!.push(b);
  };
  for (const [c, r] of cells) {
    if (!inSet.has(key(c, r - 1))) addEdge([c, r], [c + 1, r]); // top, walk right
    if (!inSet.has(key(c + 1, r))) addEdge([c + 1, r], [c + 1, r + 1]); // right, walk down
    if (!inSet.has(key(c, r + 1))) addEdge([c + 1, r + 1], [c, r + 1]); // bottom, walk left
    if (!inSet.has(key(c - 1, r))) addEdge([c, r + 1], [c, r]); // left, walk up
  }
  // Chain edges into loops; return the longest loop (outer boundary).
  const loops: Pt[][] = [];
  while (edges.size) {
    const startKey = edges.keys().next().value as string;
    const loop: Pt[] = [];
    let cur = startKey.split(',').map(Number) as Pt;
    let prevDir: Pt = [0, 0];
    while (true) {
      const k = `${cur[0]},${cur[1]}`;
      const outs = edges.get(k);
      if (!outs || outs.length === 0) break;
      // At corner-touch junctions prefer the sharpest right turn to keep
      // each loop tight around its own region.
      let pick = 0;
      if (outs.length > 1) {
        const score = (b: Pt) => {
          const d: Pt = [b[0] - cur[0], b[1] - cur[1]];
          return prevDir[0] * d[1] - prevDir[1] * d[0]; // cross product
        };
        pick = outs.reduce((best, b, i) => (score(b) > score(outs[best]) ? i : best), 0);
      }
      const next = outs.splice(pick, 1)[0];
      if (outs.length === 0) edges.delete(k);
      loop.push(cur);
      prevDir = [next[0] - cur[0], next[1] - cur[1]];
      cur = next;
      if (cur[0] === loop[0][0] && cur[1] === loop[0][1]) break;
    }
    if (loop.length > 2) loops.push(loop);
  }
  loops.sort((a, b) => b.length - a.length);
  return loops[0] ?? [];
}

/** Collapse runs of collinear points, then Chaikin-smooth the closed loop. */
function smooth(loop: Pt[], iterations: number): Pt[] {
  let pts = loop.filter((p, i) => {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const next = loop[(i + 1) % loop.length];
    return (next[0] - prev[0]) * (p[1] - prev[1]) !== (p[0] - prev[0]) * (next[1] - prev[1]);
  });
  pts = pts.map(jitter);
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.72 + b[0] * 0.28, a[1] * 0.72 + b[1] * 0.28]);
      out.push([a[0] * 0.28 + b[0] * 0.72, a[1] * 0.28 + b[1] * 0.72]);
    }
    pts = out;
  }
  return pts;
}

function toPath(pts: Pt[]): string {
  if (!pts.length) return '';
  const d = pts
    .map((p, i) => `${i ? 'L' : 'M'}${(p[0] * CELL).toFixed(1)} ${(p[1] * CELL).toFixed(1)}`)
    .join('');
  return d + 'Z';
}

export function buildWorld(): WorldMap {
  const cellsBySymbol = new Map<string, [number, number][]>();
  GRID.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      if (!cellsBySymbol.has(ch)) cellsBySymbol.set(ch, []);
      cellsBySymbol.get(ch)!.push([c, r]);
    });
  });

  const symbolToIsland = new Map<string, number>();
  ISLANDS.forEach((isl, i) => [...isl.symbols].forEach((s) => symbolToIsland.set(s, i)));

  const countries: Country[] = [...ALPHABET].map((symbol, id) => {
    const cells = cellsBySymbol.get(symbol)!;
    const cx = cells.reduce((s, [c]) => s + c + 0.5, 0) / cells.length;
    const cy = cells.reduce((s, [, r]) => s + r + 0.5, 0) / cells.length;
    return {
      id,
      symbol,
      island: symbolToIsland.get(symbol)!,
      cells,
      centroid: [cx * CELL, cy * CELL],
      path: toPath(smooth(traceBoundary(cells), 2)),
      neighbors: [],
      laneNeighbors: [],
    };
  });

  // Land adjacency from shared cell edges.
  const owner = new Map<number, number>();
  countries.forEach((co) => co.cells.forEach(([c, r]) => owner.set(key(c, r), co.id)));
  const linked = new Set<string>();
  const link = (a: number, b: number, lane: boolean) => {
    const k = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (linked.has(k)) return;
    linked.add(k);
    countries[a].neighbors.push(b);
    countries[b].neighbors.push(a);
    if (lane) {
      countries[a].laneNeighbors.push(b);
      countries[b].laneNeighbors.push(a);
    }
  };
  countries.forEach((co) =>
    co.cells.forEach(([c, r]) => {
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        const nb = owner.get(key(c + dc, r + dr));
        if (nb !== undefined && nb !== co.id) link(co.id, nb, false);
      }
    }),
  );

  const laneIds: [number, number][] = LANES.map(([a, b]) => {
    const ia = ALPHABET.indexOf(a);
    const ib = ALPHABET.indexOf(b);
    link(ia, ib, true);
    return [ia, ib];
  });

  const islands: Island[] = ISLANDS.map((meta, id) => {
    const ids = [...meta.symbols].map((s) => ALPHABET.indexOf(s));
    const cells = ids.flatMap((i) => countries[i].cells);
    const minR = Math.min(...cells.map(([, r]) => r));
    const cx = cells.reduce((s, [c]) => s + c + 0.5, 0) / cells.length;
    return {
      id,
      name: meta.name,
      bonus: meta.bonus,
      countries: ids,
      path: toPath(smooth(traceBoundary(cells), 2)),
      labelAt: [cx * CELL, (minR - 0.55) * CELL],
    };
  });

  return {
    countries,
    islands,
    lanes: laneIds,
    width: GRID[0].length * CELL,
    height: GRID.length * CELL,
  };
}
