# Phase 24.6c4e1: Otenco placement and rescue

## Changes

- Added sealed/rescued state and the floor-local Otenco coordinate.
- Added deterministic descent-26 placement maximizing the minimum distance from start and stairs, with room/y/x tie-breaking and no RNG consumption.
- Excluded Otenco's room from monster-house selection and resolved contact as a consumed move, with player death taking priority over rescue.
- Kept floor-transition, return-leg, UI, message-log, telemetry, and save-schema work outside this slice.

## Verification

- `npm run typecheck`
- `npm test`
