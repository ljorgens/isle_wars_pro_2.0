# Isle Wars Pro — Clone Rules Specification

Source of truth: official game manual (`reference/islepro_zip/extracted/app/Islepro.txt`,
v1.01, Soleau Software, 2002) plus board screenshot
(`reference/Isle_Wars_Pro_screenshot.png`). Items marked **[UNVERIFIED]** need
observation of the original game to pin down.

## Overview

Risk-style territory conquest for 4 players (1 human + 3 AI in shareware; up to
4 humans in registered). Board: **46 countries spread across 9 islands** on an
ocean map, islands connected by sea lanes (ships). Win by conquering all 9
islands. Average game 8–45 minutes.

## Setup / Options

- Options at new game: difficulty level, player color, number of starting
  armies, frequency of natural disasters, game speed.
- Board distributes armies at start **[UNVERIFIED: exact distribution —
  appears random]**, then first player is chosen randomly.

## Turn structure

1. **Card trade-in (forced):** if you hold a set of 3 matching cards you must
   decide to trade at the top of your turn (one opportunity).
2. **Reinforcements:** armies = floor(countries owned ÷ 3), **minimum 2**,
   plus island bonuses for each island fully controlled, plus card bonuses.
3. **Place armies** on owned countries (any split).
4. **Attack phase** (optional, repeatable): buttons [ATTACK] [MOVE] [PASS]
   [CARDS] [CANCEL].
5. **Move (fortify):** one move of any number of troops between two adjacent
   countries, ends turn. Or **Pass** to end turn without moving.

### Island bonus values

Manual shows 9 islands with bonuses laid out spatially:

```
                2
            8
  2    4    3      5
     4       5
                 2
```

i.e. values {2, 8, 2, 4, 3, 5, 4, 5, 2} — bonus scales with island size.
**[UNVERIFIED: which island on the screenshot maps to which value]**

## Combat

- Attack only an **adjacent** country (land adjacency, or sea-lane lines
  between islands).
- **Eligibility rule (differs from Risk):** you may only attack if your army
  count in the attacking country is **≥ the defender's count**.
- Resolution per roll: computer rolls dice (hidden). Higher roll wins; loser
  loses 1 army. **Ties go to the defender** (attacker loses 1).
  **[UNVERIFIED: dice count/sides — behaves as 1v1 comparison]**
- Large battles (e.g. 60 vs 40): computer auto-rolls ~5 times per click.
- Player chooses [ATTACK] again or [QUIT ATTACK] after each round.
- **Attacker-down-to-1 rule (unique):** if the attacking stack falls to 1
  army, you forfeit your turn AND the attacking country changes hands to the
  defender.
- On conquest (defender at 0): move in at least 1 army from the attacking
  stack (player chooses how many).
- Eliminated player: may concede (recorded loss) or watch the AI play out the
  game at fast speed.

## Cards

- Earn **1 card per turn** if you captured at least one country that turn.
- Hand limit **5**; on overflow you must discard one card of your choice.
- Card types:
  - **5 / 8 / 15 Bonus Armies** — adds that many armies at start of turn.
  - **Double** — doubles your placement total at start of turn.
  - **Bomb** — bomb any country, reducing its troops. **[UNVERIFIED: damage
    amount/formula]**
  - **Anti-Bomb** — passively blocks one enemy bomb on your countries, then
    is consumed.
  - **Lose All Cards** — drawing it wipes your hand immediately.
  - **Wild** — matches any card in a set.
- **Trade-in:** set = 3 identical cards, or 2 identical + wild, or 1 + 2
  wilds. 3 wilds is NOT a set. Trading is mandatory-decision at turn start.
  **[UNVERIFIED: what trading a set yields — presumably the cards' effects]**

## Random events ("Situations / Disasters / Production Centers")

Random, unpredictable, frequency configurable in options. Six event types:

1. **Earthquake** — hits 3–4 grids, armies decreased there.
2. **Flooding** — hits 3–4 grids, armies decreased there.
3. **Rebellion** — occurs in one country, armies decreased.
4. **Rebel takeover** — one country **changes hands** from its owner.
5. **Production centers move** — relocate to other random countries.
6. **Production center increase** — armies on production centers **double**.

- Production centers are marked by **light blue** army-count text (normal is
  white).
- **[UNVERIFIED: number of production centers, event probability per turn,
  army-loss amounts for events 1–3, whether events fire between turns]**

## UI (from screenshot, 800×600)

- Ocean-blue board, 9 irregular islands each in a distinct color region,
  countries numbered with army counts overlaid.
- White sea-lane lines connecting islands.
- Top-left: per-player card counts (Blue, Yellow, Red, Green).
- Bottom status bar: contextual prompts (e.g. "Attacking Country 14 /
  Attacking From Country 9", "Country 9 Attacks 14 / 21 Against 3") and
  action buttons.
- Bottom menu: New Game, Help, Options, Soleau Games, Scores, Quit.
- Scoreboard tracks wins/losses per difficulty level; quitting mid-game while
  controlling fewer than 10 countries records a loss.

## Clone legal notes

- Mechanics/rules are reimplementable; do NOT reuse Soleau's name, artwork,
  map drawing, or rules text verbatim in a public release. Use an original
  map layout (46 countries / 9 islands structure is fine), original art, and
  a different title.
