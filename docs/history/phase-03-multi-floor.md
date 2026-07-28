# Phase 03: Deterministic Multi-Floor Runs

## Purpose and scope

Extends a single play session ("run") from one random floor to a
deterministic sequence of 3 floors. On each floor, the player must defeat
the floor's enemy before the staircase (the existing yellow exit tile)
unlocks; reaching it after that advances to the next floor. Reaching the
staircase on floor 3 after defeating its enemy is the run's Victory.

Out of scope (deferred to Phase 04+): multiple enemies, per-floor
difficulty scaling, items/chests/traps, player growth, upstairs/backtracking,
branching routes, floor themes, transition animations, save/load.

## Run seed and floor seed

- `runSeed` identifies the whole run; the same runSeed always produces the
  same 3 floors in the same order.
- `floorSeed = deriveFloorSeed(runSeed, floor)` (new `src/game/floor.ts`) is
  a pure function: it mixes `runSeed` with the floor number using a
  golden-ratio-derived odd constant, then draws one value from the
  existing mulberry32 `createRng`. No shared PRNG instance is consumed
  across floors, so floor seeds can be requested in any order and always
  match. Neither `Date.now` nor `Math.random` is used in this derivation.
- Each floor's map/placement generation is otherwise unchanged from
  Phase 02 (`generateMap(floorSeed)` + a placement RNG derived from
  `floorSeed ^ 0x51ed270b`, same as Phase 02's single-floor flow).

## 3-floor state transitions

- `GamePhase` gained a transient value, `'floor_cleared'`, replacing the
  previously unused `'floor_reached'`. `processTurn` (in `turn.ts`) now:
  - Sets `'gameover'` if the player died this turn (unchanged).
  - Otherwise, if the player is on the exit tile **and** the floor's enemy
    is not alive (defeated this turn or earlier): sets `'victory'` if
    `floor >= totalFloors`, else sets `'floor_cleared'`.
  - Defeating the enemy alone (not on the exit tile) no longer ends the
    run; the player can keep exploring, exactly as specified.
  - Reaching the exit while the enemy is still alive does not change phase.
- `main.ts`'s key handler checks the phase right after `processTurn`; if it
  is `'floor_cleared'`, it calls `advanceToNextFloor` synchronously within
  the same key event and redraws the scene, before any further input can
  be processed — so a single exit contact can never advance more than one
  floor, and there is no interstitial screen.

## Player state persistence

`advanceToNextFloor` (in `state.ts`) carries over the player's current HP,
max HP, and attack into the new floor's initial actor, then only replaces
position, enemy, exit, and map. Floor transitions never heal the player.
Turn count is a run-cumulative counter and is not reset per floor.

## Enter / N behavior

- `Enter` now restarts the same run (`runSeed`) from floor 1, with the
  player's stats reset to their initial values (previously it only
  regenerated the current single floor).
- `N` starts a brand-new run (a new random `runSeed`) from floor 1.
- Both work identically from `'gameover'` and `'victory'`. No new input
  handlers are registered per floor transition; the existing single
  `keydown` listener is reused for all floors of a run.

## HUD

Added `FLOOR n/3`, the run seed, and the current floor seed to the
existing HP/Turn HUD line (two lines total), without otherwise changing
its layout or position.

## Tests added/changed

- `src/game/__tests__/floor-seed.test.ts` (new, 5 tests): determinism,
  distinctness across floors, order-independence, run-seed sensitivity,
  and independence from `Math.random`/timing.
- `src/game/__tests__/multi-floor.test.ts` (new, 9 tests): floor 1 start
  state, no-advance while enemy alive, `floor_cleared` on floors 1/2 vs.
  `victory` only on floor 3, HP carry-over without healing, no double
  advance per contact, defeating the enemy alone not ending the run, game
  over ending the run regardless of floor, and same-runSeed restart
  reproducing floor 1 with full HP.
- `src/game/__tests__/multi-floor-robustness.test.ts` (new, 2 tests): all
  300 floors (100 run seeds × 3 floors) generate successfully, and the
  same 100 run seeds regenerate identical map terrain on a second pass.
- Updated for the new phase semantics (existing behavior renamed, not
  weakened): `integration.test.ts` (`'floor_reached'` → `'floor_cleared'`
  in the two tests that exercised the terminal-transition case),
  `seed-restart.test.ts` (`state.seed` is now the *floor* seed, not the
  run seed; the exposure test now checks `runSeed` instead), and
  `turn.test.ts` (added the new required `GameState` fields:
  `runSeed`, `floor`, `totalFloors`).

## Verification results

- 100 run seeds × 3 floors = 300 floors: 300/300 generated successfully.
  Every floor was checked against the full set of Phase 02 shape
  constraints (reusing the same validation logic as `robustness.test.ts`):
  room count in range, full floor connectivity via flood fill from the
  floor's actual player start tile, the exit reachable from that start
  tile, zero forbidden 2×2 floor blocks, start/exit/enemy each on a floor
  tile, and no overlap between start/exit/enemy. 0 shape violations across
  all 300 floors. (An earlier version of this test only checked
  generation success and determinism, not shape; it was extended to run
  the full Phase 02 validation per floor, per the Phase 03 verification
  follow-up.)
- Determinism recheck: the same 100 run seeds regenerated twice produced
  0 mismatches in map terrain.
- Type check: pass (`tsc -b --noEmit`).
- Full test suite: 20 files, 88 tests, all passing.
- Production build (`tsc -b && vite build`): succeeds.
- `git diff --check`: passes (no whitespace errors).
- Seed 2780624551 regression (`floor-block-geometry.test.ts`, generated
  directly via `generateMap`, independent of the run/floor system): still
  passes unchanged.
- Real-browser check (headless Chromium via Playwright, dev server):
  loaded cleanly with zero console/page errors; HUD showed
  `FLOOR 1/3`, run seed, and floor seed; movement/attack keys and the
  Enter/N restart keys were exercised with no errors; screenshots
  confirmed the map, player, enemy, and camera-follow rendered correctly.
- User manual verification (2026-07-29, real browser, interactive play):
  the user played the build directly and confirmed the following worked
  correctly: the staircase does not advance the floor while its enemy is
  alive; defeating the enemy alone does not trigger Victory; reaching the
  staircase after defeating the enemy advances floor 1→2 and 2→3; on
  floor 3, reaching the staircase after defeating its enemy triggers
  Victory; current HP is not restored on floor transitions; the map,
  enemy, staircase, and camera all switch correctly per floor; Enter
  restarts the same run seed from floor 1; N starts a new run seed from
  floor 1; and movement, attacks, taking damage, and Game Over all behave
  correctly.

## Unverified / remaining items

- The manual-verification checklist's specific run seed 2780624551 was
  regression-tested at the map-generation level (unchanged shape) but not
  driven through a full interactive playthrough under that exact seed:
  forcing `Math.random` to yield a specific run seed in the browser
  breaks Phaser's own internal use of `Math.random` for texture keys
  (observed directly: this crashes the scene), so a specific seed was not
  forced through the real UI. The user's manual verification (see above)
  was performed with naturally-generated random run seeds instead, and
  covered the same behaviors the checklist calls for.
- Sprite display sizing was adjusted after the initial Phase 03
  implementation (multiple iterations, ending with the player and enemy
  sprites both displayed at a square 48×48 via a non-uniform render-time
  scale, with the source sprite sheets left unmodified). This is a
  cosmetic change with no effect on game logic, map generation, or the
  floor/run system, and does not affect any of the verification results
  above.
