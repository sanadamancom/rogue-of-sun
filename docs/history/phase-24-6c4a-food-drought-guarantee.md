# Phase 24.6c4a: food drought guarantee

Implemented the food-shortage correction from [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §12.

## Implementation

- Added the additive-default `foodDroughtFloors` run counter. Descent floors reset it when finalized ground-item generation contains chocolate and increment it otherwise; ascent holds it unchanged.
- A descent floor entered after three drought floors reserves one guaranteed chocolate before the unchanged normal item-placement loop, using a dedicated RNG stream isolated from all existing generation streams.
- Preserved the Phase 16.1 floor-1 chocolate substitution unchanged and carried the new counter through floor transitions.

## Scope and verification

This mechanism is strictly additive and currently only descent-reachable: production remains the pre-26F three-floor run, while the ascent-hold branch is retained for the future long-run structure. Focused tests cover counter updates, transition carry-over, reserved placement, the extra-item contract, and RNG isolation. `npm test` and `npm run typecheck` pass.
