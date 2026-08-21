# Phase 24.6c4d: S-armor deep loot route

## Changes

- Added `light_garb`, `dark_garb`, and `spike_mail` to normal armor loot only within their depth 19-26 descent eligibility window.
- Added a provisional flat S-rank weight with base 1 and slope 0, divided evenly among eligible S-rank armor species.
- Kept normal weapon candidate generation unchanged and kept `black_armor` excluded pending its Phase 24.7 event route.
- Kept the default three-floor production run unchanged, so the new deep route is not production-reachable yet.

## Verification

- `npm run typecheck`
- `npm test`
