# Tempest Isles — A War of Nine Islands

A browser-based tribute to **Isle Wars Pro** (Soleau Software, 2002): a
Risk-style island-conquest game where earthquakes, floods, rebellions and
wandering production centers answer to no admiral. All-new code, map, art and
name — the rules follow the original's manual (see `RULES_SPEC.md`).

## Play

```sh
npm install
npm run dev      # then open http://localhost:5173
```

`npm run build` produces a static bundle in `dist/` you can host anywhere.

## The game

- **46 countries on 9 islands**, 4 fleets — solo vs. three AI captains, or
  **hotseat with 2–4 human players** (the original's registered-version
  feature).
- Conquer all nine islands to win.
- Reinforcements each turn: countries ÷ 3 (min 2) + island bonuses
  (8/5/5/4/4/3/2/2/2).
- Attacks need an **equal-or-larger** stack than the defender; ties favor the
  defender; an attacking force worn down to 1 forfeits the turn **and the
  country**.
- Capture a country to draw a card: army sets (trade 3 matching at turn
  start), Rally (×2 reinforcements), Bombard, Ward, Wild — and Mutiny, which
  costs your whole hand.
- Random disasters strike between turns: earthquakes, floods, rebellions,
  rebel takeovers, and production centers (⚓, light-blue counts) that move
  around the map or double the armies stationed on them.
- Difficulty, color, starting armies, disaster frequency and pace are set on
  the title screen; wins/losses per rank persist in localStorage.
- Synthesized sound effects (WebAudio, no assets) — toggle with the Sound
  button in the menu bar.
- While the deploy stepper is open you can click a different country to
  re-target the deployment.

## Interpretations & tuned constants

Spots where the original manual is silent (marked `[UNVERIFIED]` in
`RULES_SPEC.md`) use these choices:

- Combat resolution: hidden d6 vs d6 per clash, loser drops one army.
- Bombard reduces the target to ⅓ of its armies (min 1); a Ward blocks one.
- Army-card sets pay 3× face value (8/8/8 → 24).
- Disaster chance per turn-end: 8/16/28/45% by setting; earthquakes and
  floods halve 3–4 random countries.
- 5 production centers.

## Project layout

- `src/mapdata.ts` — the map as an ASCII cell grid (one char = one cell, one
  symbol = one country); islands, bonuses and sea lanes.
- `src/geometry.ts` — grid → smoothed organic coastlines, centroids,
  adjacency graph.
- `src/engine.ts` — rules engine and turn loop.
- `src/ai.ts` — AI captains (difficulty scales discipline and strategy).
- `src/render.ts` / `src/ui.ts` — SVG map and DOM interaction layer.
- `src/sfx.ts` — synthesized WebAudio sound effects.
- `scripts/validate.mjs` — map integrity checks (`npm run validate`).
- `scripts/sim.ts` — headless all-AI simulator for stability/balance
  (`npm run sim -- 200` runs 200 games per difficulty rank).
- `scripts/playtest.mjs` — headless Chrome smoke test (needs `npm i --no-save
  playwright-core` and a dev server running).
- `reference/` — the original Isle Wars Pro shareware, manual and screenshot
  used to document the rules.
