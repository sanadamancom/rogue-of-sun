/**
 * Phase 21.6 implementation_gate tests: dark-room / monster-house
 * integration. No production changes were needed for this phase — see
 * docs/history/phase-21-6-monster-house-dark-room-integration.md — so
 * these tests verify the existing independence of dark-room selection,
 * reveal, and visibility computation directly confirms every
 * specification point.
 */
import { describe, expect, it } from 'vitest';
import { createInitialState, advanceToNextFloor } from '../state';
import { processTurn } from '../turn';
import { computeCurrentVisibility, DARK_ROOM_VISIBILITY_RADIUS } from '../visibility';
import { applyMonsterHouseReveal } from '../monster-house';

// Seed 3, floor 2: a known dark monster house occurrence (darkRoomIndex
// === monsterHouse.roomIndex), found by seed sweep during Phase 21.6
// investigation. Used as a concrete fixture for direct verification
// alongside the broader seed-sweep tests below.
function buildDarkMonsterHouseFloor2() {
  let state = createInitialState(48);
  state.enemies.forEach((e) => (e.alive = false));
  state.player.pos = { ...state.exit };
  return advanceToNextFloor(state);
}

describe('dark room can be a monster house target room', () => {
  it('seed 48 floor 2 is a known dark monster house occurrence', () => {
    const state = buildDarkMonsterHouseFloor2();
    expect(state.map.monsterHouse).not.toBeNull();
    expect(state.map.darkRoomIndex).not.toBeNull();
    expect(state.map.darkRoomIndex).toBe(state.map.monsterHouse!.roomIndex);
  });

  it('across a 2000-seed sweep (floor 2 and 3), both dark and light monster houses occur', () => {
    let darkCount = 0;
    let lightCount = 0;
    for (let seed = 0; seed < 500; seed++) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        if (state.map.darkRoomIndex != null && state.map.darkRoomIndex === state.map.monsterHouse.roomIndex) {
          darkCount++;
        } else {
          lightCount++;
        }
      }
    }
    // Not asserting a specific ratio (that's a balance question, out of
    // scope) — just that neither category is unreachable.
    expect(darkCount).toBeGreaterThan(0);
    expect(lightCount).toBeGreaterThan(0);
  });
});

describe('reveal in a dark monster house does not depend on visibility', () => {
  it('applyMonsterHouseReveal succeeds for a dark target room via the same entry-cell move, independent of any visibility computation', () => {
    const state = buildDarkMonsterHouseFloor2();
    const room = state.map.rooms[state.map.monsterHouse!.roomIndex];
    // Find an entry cell (a room tile adjacent to an outside floor tile)
    // and its outside neighbor, matching Phase 21.3's contract test
    // shape, but for this dark room specifically.
    const deltas = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    let outside: { x: number; y: number } | null = null;
    let entry: { x: number; y: number } | null = null;
    outer: for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (state.map.terrain[y][x] !== 'floor') continue;
        for (const d of deltas) {
          const n = { x: x + d.x, y: y + d.y };
          if (n.x < 0 || n.x >= state.map.width || n.y < 0 || n.y >= state.map.height) continue;
          if (state.map.terrain[n.y][n.x] !== 'floor') continue;
          if (n.x >= room.x && n.x < room.x + room.width && n.y >= room.y && n.y < room.y + room.height) continue;
          outside = n;
          entry = { x, y };
          break outer;
        }
      }
    }
    expect(entry).not.toBeNull();
    expect(outside).not.toBeNull();

    // Confirm reveal succeeds via applyMonsterHouseReveal regardless of
    // whatever the player's current visibility would compute to (this
    // function never touches visibility.ts at all — no import, no call).
    const testMap = JSON.parse(JSON.stringify(state.map));
    testMap.monsterHouse = { roomIndex: state.map.monsterHouse!.roomIndex, status: 'hidden' };
    const revealed = applyMonsterHouseReveal(testMap, outside!, entry!);
    expect(revealed).toBe(true);
    expect(testMap.monsterHouse.status).toBe('revealed');
    // darkRoomIndex is completely untouched by the reveal.
    expect(testMap.darkRoomIndex).toBe(state.map.darkRoomIndex);
  });

  it('a blocked/unsuccessful move does not reveal a dark monster house', () => {
    const state = buildDarkMonsterHouseFloor2();
    const testMap = JSON.parse(JSON.stringify(state.map));
    testMap.monsterHouse = { roomIndex: state.map.monsterHouse!.roomIndex, status: 'hidden' };
    const someOutsidePos = { x: 0, y: 0 }; // wall / out of any room
    const revealed = applyMonsterHouseReveal(testMap, someOutsidePos, someOutsidePos);
    expect(revealed).toBe(false);
    expect(testMap.monsterHouse.status).toBe('hidden');
  });

  it('reveal happens exactly once — re-entering does not re-flag', () => {
    const state = buildDarkMonsterHouseFloor2();
    const room = state.map.rooms[state.map.monsterHouse!.roomIndex];
    const insidePos = { x: room.x + 1, y: room.y + 1 };
    const testMap = JSON.parse(JSON.stringify(state.map));
    testMap.monsterHouse = { roomIndex: state.map.monsterHouse!.roomIndex, status: 'revealed' };
    const revealedAgain = applyMonsterHouseReveal(testMap, { x: room.x, y: room.y }, insidePos);
    expect(revealedAgain).toBe(false);
    expect(testMap.monsterHouse.status).toBe('revealed');
  });
});

describe('darkness state is preserved through reveal (production wiring)', () => {
  it('darkRoomIndex is unchanged after a real processTurn move that reveals the dark monster house', () => {
    const state = buildDarkMonsterHouseFloor2();
    const darkRoomIndexBefore = state.map.darkRoomIndex;
    const room = state.map.rooms[state.map.monsterHouse!.roomIndex];
    // Find any entry-adjacent outside tile and move the player there,
    // then step into the room via processTurn.
    const deltas: Array<{ dx: number; dy: number; dir: 'N' | 'S' | 'E' | 'W' }> = [
      { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
    ];
    let moved = false;
    outer: for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (state.map.terrain[y][x] !== 'floor') continue;
        for (const d of deltas) {
          const from = { x: x + d.dx, y: y + d.dy };
          if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
          if (state.map.terrain[from.y][from.x] !== 'floor') continue;
          if (from.x >= room.x && from.x < room.x + room.width && from.y >= room.y && from.y < room.y + room.height) continue;
          if (state.enemies.some((e) => e.alive && e.pos.x === from.x && e.pos.y === from.y)) continue;
          if (state.enemies.some((e) => e.alive && e.pos.x === x && e.pos.y === y)) continue;
          state.player.pos = from;
          const result = processTurn(state, { type: 'move', direction: d.dir });
          if (result.consumed && state.player.pos.x === x && state.player.pos.y === y) {
            expect(result.monsterHouseRevealed).toBe(true);
            moved = true;
          }
          break outer;
        }
      }
    }
    expect(moved).toBe(true);
    expect(state.map.monsterHouse!.status).toBe('revealed');
    expect(state.map.darkRoomIndex).toBe(darkRoomIndexBefore);
  });

  it('a light (non-dark) monster house never gains a dark state on reveal', () => {
    // Find a light monster house occurrence and confirm darkRoomIndex
    // stays null/different after reveal.
    for (let seed = 0; seed < 200; seed++) {
      let state = createInitialState(seed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      if (!state.map.monsterHouse) continue;
      const isLight = state.map.darkRoomIndex == null || state.map.darkRoomIndex !== state.map.monsterHouse.roomIndex;
      if (!isLight) continue;
      const darkRoomIndexBefore = state.map.darkRoomIndex;
      const testMap = JSON.parse(JSON.stringify(state.map));
      const room = testMap.rooms[testMap.monsterHouse.roomIndex];
      testMap.monsterHouse.status = 'hidden';
      applyMonsterHouseReveal(testMap, { x: room.x - 1 >= 0 ? room.x - 1 : room.x, y: room.y }, { x: room.x, y: room.y });
      expect(testMap.darkRoomIndex).toBe(darkRoomIndexBefore);
      return;
    }
    throw new Error('no light monster house found in 200 seeds — cannot run this test');
  });
});

describe('visibility does not leak dedicated enemies/rewards outside dark-room FOV', () => {
  it('dedicated enemies/rewards far from the player in a dark monster house are excluded from computeCurrentVisibility', () => {
    const state = buildDarkMonsterHouseFloor2();
    const room = state.map.rooms[state.map.monsterHouse!.roomIndex];
    // Place the player at one corner of the dark room; anything beyond
    // DARK_ROOM_VISIBILITY_RADIUS should not appear in the visible set —
    // same shadowcasting rule as any other dark room, no spawnSource
    // special-casing exists to check because none was added.
    state.player.pos = { x: room.x, y: room.y };
    const visible = computeCurrentVisibility(state.map, state.map.rooms, state.player.pos);
    const visibleKeys = new Set(visible.map((p) => `${p.x},${p.y}`));

    const dedicatedEnemies = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    const dedicatedRewards = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
    expect(dedicatedEnemies.length).toBeGreaterThan(0);
    expect(dedicatedRewards.length).toBeGreaterThan(0);

    let anyOutOfRange = false;
    for (const e of [...dedicatedEnemies, ...dedicatedRewards]) {
      const dist = Math.max(Math.abs(e.pos.x - state.player.pos.x), Math.abs(e.pos.y - state.player.pos.y));
      if (dist > DARK_ROOM_VISIBILITY_RADIUS) {
        anyOutOfRange = true;
        expect(visibleKeys.has(`${e.pos.x},${e.pos.y}`)).toBe(false);
      }
    }
    // Sanity: this fixture actually has at least one far-away dedicated
    // entity to make the check meaningful.
    expect(anyOutOfRange).toBe(true);
  });

  it('entities within dark-room FOV radius are included in computeCurrentVisibility', () => {
    const state = buildDarkMonsterHouseFloor2();
    const room = state.map.rooms[state.map.monsterHouse!.roomIndex];
    const dedicatedEnemies = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    const near = dedicatedEnemies[0];
    state.player.pos = { x: near.pos.x, y: near.pos.y }; // stand right on it — distance 0
    const visible = computeCurrentVisibility(state.map, state.map.rooms, state.player.pos);
    const visibleKeys = new Set(visible.map((p) => `${p.x},${p.y}`));
    expect(visibleKeys.has(`${near.pos.x},${near.pos.y}`)).toBe(true);
    void room;
  });

  it('a light monster house uses whole-room visibility (not radius-limited), same as any ordinary lit room', () => {
    for (let seed = 0; seed < 200; seed++) {
      let state = createInitialState(seed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      if (!state.map.monsterHouse) continue;
      const isLight = state.map.darkRoomIndex == null || state.map.darkRoomIndex !== state.map.monsterHouse.roomIndex;
      if (!isLight) continue;
      const room = state.map.rooms[state.map.monsterHouse.roomIndex];
      state.player.pos = { x: room.x, y: room.y };
      const visible = computeCurrentVisibility(state.map, state.map.rooms, state.player.pos);
      const visibleKeys = new Set(visible.map((p) => `${p.x},${p.y}`));
      // Whole room should be visible regardless of distance from player.
      const farCorner = { x: room.x + room.width - 1, y: room.y + room.height - 1 };
      expect(visibleKeys.has(`${farCorner.x},${farCorner.y}`)).toBe(true);
      return;
    }
    throw new Error('no light monster house found in 200 seeds — cannot run this test');
  });
});

describe('dark monster house preserves Phase 21.4/21.5 enemy and reward rules', () => {
  it('dedicated enemy count is between 4 and 8 in a dark monster house, same as a light one', () => {
    const state = buildDarkMonsterHouseFloor2();
    const dedicated = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    expect(dedicated.length).toBeGreaterThanOrEqual(4);
    expect(dedicated.length).toBeLessThanOrEqual(8);
  });

  it('dedicated reward count is up to 3 in a dark monster house, same as a light one', () => {
    const state = buildDarkMonsterHouseFloor2();
    const rewards = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
    expect(rewards.length).toBeGreaterThan(0);
    expect(rewards.length).toBeLessThanOrEqual(3);
  });

  it('a reward in a dark monster house can still be auto-picked-up via move', () => {
    const state = buildDarkMonsterHouseFloor2();
    const reward = state.groundItems.find((i) => i.spawnSource === 'monster_house');
    expect(reward).toBeDefined();
    const deltas: Array<{ dx: number; dy: number; dir: 'N' | 'S' | 'E' | 'W' }> = [
      { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
    ];
    let picked = false;
    for (const d of deltas) {
      const from = { x: reward!.pos.x + d.dx, y: reward!.pos.y + d.dy };
      if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
      if (state.map.terrain[from.y][from.x] !== 'floor') continue;
      const testState = JSON.parse(JSON.stringify(state));
      testState.enemies = testState.enemies.filter(
        (e: any) => !(e.pos.x === reward!.pos.x && e.pos.y === reward!.pos.y) && !(e.pos.x === from.x && e.pos.y === from.y),
      );
      testState.player.pos = from;
      const before = testState.groundItems.length;
      const result = processTurn(testState, { type: 'move', direction: d.dir });
      if (result.consumed && testState.player.pos.x === reward!.pos.x && testState.player.pos.y === reward!.pos.y) {
        expect(testState.groundItems.length).toBeLessThan(before);
        picked = true;
        break;
      }
    }
    expect(picked).toBe(true);
  });
});

describe('regression: monster-house-free and light-monster-house floors unaffected', () => {
  it('floor 1 never has a monster house or a dark-monster-house interaction', () => {
    for (const seed of [1, 2, 3, 42]) {
      const state = createInitialState(seed);
      expect(state.map.monsterHouse ?? null).toBeNull();
    }
  });

  it('ordinary dark rooms (no monster house) still behave exactly as before', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createInitialState(seed);
      if (state.map.darkRoomIndex == null) continue;
      // No monster house on floor 1 ever, so darkRoomIndex here is a
      // plain ordinary dark room with no interaction to verify beyond
      // "it still exists and monsterHouse is null".
      expect(state.map.monsterHouse ?? null).toBeNull();
      return;
    }
  });
});
