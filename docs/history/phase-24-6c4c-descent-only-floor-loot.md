# Phase 24.6c4c: descent-only normal floor loot

## Changes

- Exported `buildFloorState` and added an optional final `leg` parameter that defaults to `descent`.
- Wired the run leg into floor-seed derivation, giving ascent visits their own deterministic floor seed.
- Suppressed normal floor items, monster-house rewards, and food-drought correction on ascent without consuming their loot RNG streams.
- Kept normal enemies, enemy drops, traps, and dark-room/sunlight generation active on both legs.

## Verification

- `npm run typecheck`
- `npm test`
