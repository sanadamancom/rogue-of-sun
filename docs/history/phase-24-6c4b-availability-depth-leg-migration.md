# Phase 24.6c4b: item availability depth/leg migration

## Changes

- Replaced the run-depth-tier plus progress-ratio availability model with absolute `minimumDepth`, optional `maximumDepth`, and optional `leg` metadata.
- Production loot, equipment, card, accessory, enemy-drop, and Star-transform adapters now pass the current absolute floor and run leg directly.
- Kept `economyClass` metadata and the equipment C/B/A rank-weight curve unchanged.
- Added the canonical depth restrictions for the staged pool slots, enchantments, S-rank armor metadata, and `black_armor`.

## Expected sample-run change

In the current 3F sample run, `spear`, `hammer`, `frost_enchantment`, `cloud_enchantment`, and `earth_enchantment` remain ineligible because their canonical minimum depths are 5, 9, 9, 9, and 18.

## Verification

- `npm run typecheck`
- `npm test`
