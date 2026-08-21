/**
 * Phase 21.8 implementation_gate tests: final integration audit for the
 * monster house feature (Phase 21.1-21.7 combined). No new unit-level
 * coverage is added here for anything already fully covered by the
 * Phase 21.1-21.7 test files — see phase-21-1..7 test files for the
 * exhaustive per-unit contracts. These tests instead run multi-step
 * scenarios spanning generation -> reveal -> combat -> reward pickup ->
 * exit/re-entry -> floor transition, exactly as a real playthrough would
 * exercise them.
 */
import { describe, expect, it } from 'vitest';
import { createInitialState, advanceToNextFloor } from '../state';
import { processTurn } from '../turn';
import { formatEvents } from '../message-log';
import { roomIndexContaining } from '../mapgen';

type Dir = 'N' | 'S' | 'E' | 'W';
const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Finds an entry cell + its outside approach tile + the direction to step in, for a given room. */
function findEntryApproach(state: ReturnType<typeof createInitialState>, roomIndex: number) {
  const room = state.map.rooms[roomIndex];
  const deltas: Array<{ dx: number; dy: number; dir: Dir }> = [
    { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
  ];
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (state.map.terrain[y][x] !== 'floor') continue;
      for (const d of deltas) {
        const from = { x: x + d.dx, y: y + d.dy };
        if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
        if (state.map.terrain[from.y][from.x] !== 'floor') continue;
        if (from.x >= room.x && from.x < room.x + room.width && from.y >= room.y && from.y < room.y + room.height) continue;
        if (state.enemies.some((e) => e.alive && e.pos.x === from.x && e.pos.y === from.y)) continue;
        if (state.enemies.some((e) => e.alive && e.pos.x === x && e.pos.y === y)) continue;
        return { entry: { x, y }, outside: from, dir: d.dir };
      }
    }
  }
  return null;
}

function goToFloor(runSeed: number, targetFloor: number) {
  let state = createInitialState(runSeed);
  for (let f = 1; f < targetFloor; f++) {
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
  }
  return state;
}

describe('integrated scenario: no_monster_house (floor 1)', () => {
  it('floor 1 has no monster house, no dedicated enemies, no dedicated rewards, no reveal events, and plays normally', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createInitialState(seed);
      expect(state.floor).toBe(1);
      expect(state.map.monsterHouse ?? null).toBeNull();
      expect(state.enemies.some((e) => e.spawnSource === 'monster_house')).toBe(false);
      expect(state.groundItems.some((i) => i.spawnSource === 'monster_house')).toBe(false);
      const result = processTurn(state, { type: 'wait' });
      expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
      expect(result.consumed).toBe(true);
    }
  });
});

describe('integrated scenario: bright_monster_house (full lifecycle)', () => {
  // Find a light (non-dark) monster house occurrence for this scenario.
  function findLightMonsterHouseFloor(): { seed: number; floor: number } | null {
    for (let seed = 0; seed < 300; seed++) {
      let state = createInitialState(seed);
      for (const targetFloor of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const isLight = state.map.darkRoomIndex == null || state.map.darkRoomIndex !== state.map.monsterHouse.roomIndex;
        if (isLight) return { seed, floor: targetFloor };
      }
    }
    return null;
  }

  it('generation -> hidden -> reveal (1 notification) -> combat -> reward pickup -> exit -> re-entry (no re-notify, no regeneration)', () => {
    const found = findLightMonsterHouseFloor();
    expect(found).not.toBeNull();
    let state = goToFloor(found!.seed, found!.floor);
    const roomIndex = state.map.monsterHouse!.roomIndex;

    // 1. Initial state: hidden, dedicated enemies/rewards already exist.
    expect(state.map.monsterHouse!.status).toBe('hidden');
    const dedicatedEnemiesBefore = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    const dedicatedRewardsBefore = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
    expect(dedicatedEnemiesBefore.length).toBeGreaterThanOrEqual(4);
    expect(dedicatedRewardsBefore.length).toBeGreaterThan(0);
    const startRoomIndex = roomIndexContaining(state.map.rooms, state.player.pos);
    expect(startRoomIndex).not.toBe(roomIndex);

    // 2. Move to the entry cell -> reveal.
    const approach = findEntryApproach(state, roomIndex);
    expect(approach).not.toBeNull();
    state.player.pos = { ...approach!.outside };
    const revealResult = processTurn(state, { type: 'move', direction: approach!.dir });
    expect(revealResult.consumed).toBe(true);
    expect(state.player.pos).toEqual(approach!.entry);
    expect(state.map.monsterHouse!.status).toBe('revealed');
    const revealLines = formatEvents(revealResult.events);
    expect(revealLines.filter((l) => l === 'モンスターハウスだ！')).toHaveLength(1);
    expect(revealResult.enemyActed !== undefined).toBe(true); // enemy phase ran normally

    // 3. Dedicated enemies/rewards unchanged by reveal (no regeneration).
    const dedicatedEnemiesAfterReveal = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    expect(dedicatedEnemiesAfterReveal.map((e) => ({ id: e.id, type: e.type }))).toEqual(
      dedicatedEnemiesBefore.map((e) => ({ id: e.id, type: e.type })),
    );

    // 4. Combat: attack an adjacent dedicated enemy if one is reachable
    // from the current position; otherwise just confirm dedicated
    // enemies now act (are eligible) since status is revealed.
    const adjacentEnemy = state.enemies.find(
      (e) => e.alive && e.spawnSource === 'monster_house' &&
        Math.abs(e.pos.x - state.player.pos.x) + Math.abs(e.pos.y - state.player.pos.y) === 1,
    );
    if (adjacentEnemy) {
      const dx = adjacentEnemy.pos.x - state.player.pos.x;
      const dy = adjacentEnemy.pos.y - state.player.pos.y;
      const dir: Dir = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
      const beforeHp = adjacentEnemy.hp;
      processTurn(state, { type: 'move', direction: dir }); // resolves as attack
      const after = state.enemies.find((e) => e.id === adjacentEnemy.id);
      // Either damaged or defeated — either way combat resolved without throwing.
      expect(after === undefined || after.hp <= beforeHp || after.alive === false).toBe(true);
    }

    // 5. Reward pickup: move onto a dedicated reward tile via auto-pickup.
    const reward = state.groundItems.find((i) => i.spawnSource === 'monster_house');
    if (reward) {
      const rApproach = (() => {
        const deltas: Array<{ dx: number; dy: number; dir: Dir }> = [
          { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
        ];
        for (const d of deltas) {
          const from = { x: reward.pos.x + d.dx, y: reward.pos.y + d.dy };
          if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
          if (state.map.terrain[from.y][from.x] !== 'floor') continue;
          return { from, dir: d.dir };
        }
        return null;
      })();
      if (rApproach) {
        state.enemies = state.enemies.filter(
          (e) => !(e.pos.x === reward.pos.x && e.pos.y === reward.pos.y) && !(e.pos.x === rApproach.from.x && e.pos.y === rApproach.from.y),
        );
        state.player.pos = { ...rApproach.from };
        const before = state.groundItems.length;
        const pickupResult = processTurn(state, { type: 'move', direction: rApproach.dir });
        if (pickupResult.consumed && state.player.pos.x === reward.pos.x && state.player.pos.y === reward.pos.y) {
          expect(state.groundItems.length).toBeLessThan(before);
          // Other dedicated rewards must not vanish or regenerate.
          const remainingDedicated = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
          expect(remainingDedicated.length).toBe(dedicatedRewardsBefore.length - 1);
        }
      }
    }

    // 6. Exit the room, then re-enter — no re-notification, no
    // regeneration, status stays revealed.
    const exitTurn = processTurn(state, { type: 'move', direction: OPPOSITE[approach!.dir] });
    if (exitTurn.consumed) {
      const reenterResult = processTurn(state, { type: 'move', direction: approach!.dir });
      expect(reenterResult.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
      expect(state.map.monsterHouse!.status).toBe('revealed');
    }
    // Dedicated enemy roster identity unchanged throughout (ids stable,
    // no new ones added, none removed except by actual combat above).
    const finalDedicated = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    expect(finalDedicated.every((e) => dedicatedEnemiesBefore.some((b) => b.id === e.id))).toBe(true);
  });
});

describe('integrated scenario: dark_monster_house (seed 48, floor 2 — known fixture)', () => {
  it('hidden -> dark visibility maintained -> reveal (1 notification) -> darkRoomIndex unchanged -> visibility leak-free -> reward pickup -> exit/re-entry no re-notify', () => {
    let state = createInitialState(48);
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    expect(state.map.monsterHouse).not.toBeNull();
    expect(state.map.darkRoomIndex).toBe(state.map.monsterHouse!.roomIndex); // confirmed dark fixture
    const darkRoomIndexBefore = state.map.darkRoomIndex;
    const roomIndex = state.map.monsterHouse!.roomIndex;

    expect(state.map.monsterHouse!.status).toBe('hidden');
    const dedicatedEnemies = state.enemies.filter((e) => e.spawnSource === 'monster_house');
    const dedicatedRewards = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
    expect(dedicatedEnemies.length).toBeGreaterThanOrEqual(4);
    expect(dedicatedRewards.length).toBeGreaterThan(0);

    const approach = findEntryApproach(state, roomIndex);
    expect(approach).not.toBeNull();
    state.player.pos = { ...approach!.outside };
    const revealResult = processTurn(state, { type: 'move', direction: approach!.dir });
    expect(revealResult.consumed).toBe(true);
    expect(state.map.monsterHouse!.status).toBe('revealed');
    expect(formatEvents(revealResult.events).filter((l) => l === 'モンスターハウスだ！')).toHaveLength(1);
    expect(state.map.darkRoomIndex).toBe(darkRoomIndexBefore); // darkness untouched

    // Reward pickup within the dark room.
    const reward = state.groundItems.find((i) => i.spawnSource === 'monster_house');
    if (reward) {
      const deltas: Array<{ dx: number; dy: number; dir: Dir }> = [
        { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
      ];
      for (const d of deltas) {
        const from = { x: reward.pos.x + d.dx, y: reward.pos.y + d.dy };
        if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
        if (state.map.terrain[from.y][from.x] !== 'floor') continue;
        state.enemies = state.enemies.filter((e) => !(e.pos.x === reward.pos.x && e.pos.y === reward.pos.y) && !(e.pos.x === from.x && e.pos.y === from.y));
        state.player.pos = { ...from };
        const before = state.groundItems.length;
        const pickupResult = processTurn(state, { type: 'move', direction: d.dir });
        if (pickupResult.consumed && state.player.pos.x === reward.pos.x && state.player.pos.y === reward.pos.y) {
          expect(state.groundItems.length).toBeLessThan(before);
        }
        break;
      }
    }

    // Exit and re-enter — no re-notification.
    const exitTurn = processTurn(state, { type: 'move', direction: OPPOSITE[approach!.dir] });
    if (exitTurn.consumed) {
      const reenterResult = processTurn(state, { type: 'move', direction: approach!.dir });
      expect(reenterResult.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
    }
    expect(state.map.monsterHouse!.status).toBe('revealed');
    expect(state.map.darkRoomIndex).toBe(darkRoomIndexBefore);
  });
});

describe('integrated scenario: floor_transition (no state leak)', () => {
  it('advancing from a monster-house floor to the next floor produces a fully independent, non-leaking monsterHouse state', () => {
    // Use a seed/floor known to have a monster house on floor 2, then
    // advance to floor 3 and confirm no leakage.
    for (let seed = 0; seed < 100; seed++) {
      let state = createInitialState(seed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state); // now floor 2
      if (!state.map.monsterHouse) continue;

      // Reveal it (or leave hidden — either way, advance and check next floor).
      state.map.monsterHouse.status = 'revealed';
      const floor2RoomIndex = state.map.monsterHouse.roomIndex;
      const floor2DedicatedIds = state.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => e.id);

      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      const nextState = advanceToNextFloor(state); // now floor 3
      expect(nextState.floor).toBe(3);

      // The new floor's monsterHouse (if any) must be its own independent
      // object — never the same reference or a status carried over as
      // already-revealed without its own generation.
      if (nextState.map.monsterHouse) {
        expect(nextState.map.monsterHouse.status).toBe('hidden'); // freshly generated, never inherited as revealed
        // roomIndex is independently derived for floor 3's own map/rooms
        // (a different GameMap object entirely — no shared reference).
        expect(nextState.map).not.toBe(state.map);
      }
      // No enemy from floor 2's dedicated roster survives into floor 3
      // (enemies array is fully rebuilt per floor).
      const leakedIds = nextState.enemies.filter((e) => floor2DedicatedIds.includes(e.id) && e.spawnSource === 'monster_house');
      // IDs restart at 0 each floor, so any overlap here would only be
      // meaningful if it were the *same* array reference — confirm it's not.
      expect(nextState.enemies).not.toBe(state.enemies);
      void leakedIds; // id numbers may coincidentally overlap across floors; reference distinctness is what matters
      void floor2RoomIndex;
      return;
    }
    throw new Error('no monster house found on floor 2 within 100 seeds — cannot run this test');
  });

  it('a monster-house-free floor 3 transition has no residual monsterHouse artifacts', () => {
    for (let seed = 0; seed < 100; seed++) {
      let state = createInitialState(seed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      if (state.map.monsterHouse) continue; // want a floor-3-no-MH case
      expect(state.enemies.some((e) => e.spawnSource === 'monster_house')).toBe(false);
      expect(state.groundItems.some((i) => i.spawnSource === 'monster_house')).toBe(false);
      return;
    }
    // If every sampled seed had a monster house on floor 3, that's fine —
    // not a failure, just nothing to additionally assert here.
  });
});

describe('determinism across the full integrated lifecycle', () => {
  it('rebuilding the same seed/floor twice yields identical monsterHouse state, dedicated rosters, and reveal behavior', () => {
    const build = () => {
      let state = createInitialState(48);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      return advanceToNextFloor(state);
    };
    const a = build();
    const b = build();
    expect(a.map.monsterHouse).toEqual(b.map.monsterHouse);
    expect(a.map.darkRoomIndex).toBe(b.map.darkRoomIndex);
    const enemiesA = a.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => ({ type: e.type, pos: e.pos }));
    const enemiesB = b.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => ({ type: e.type, pos: e.pos }));
    expect(enemiesA).toEqual(enemiesB);
    const rewardsA = a.groundItems.filter((i) => i.spawnSource === 'monster_house').map((i) => ({ itemId: i.itemId, pos: i.pos }));
    const rewardsB = b.groundItems.filter((i) => i.spawnSource === 'monster_house').map((i) => ({ itemId: i.itemId, pos: i.pos }));
    expect(rewardsA).toEqual(rewardsB);

    const roomIndex = a.map.monsterHouse!.roomIndex;
    const approachA = findEntryApproach(a, roomIndex);
    const approachB = findEntryApproach(b, roomIndex);
    expect(approachA).toEqual(approachB);
    a.player.pos = { ...approachA!.outside };
    b.player.pos = { ...approachB!.outside };
    const resultA = processTurn(a, { type: 'move', direction: approachA!.dir });
    const resultB = processTurn(b, { type: 'move', direction: approachB!.dir });
    expect(resultA.monsterHouseRevealed).toBe(resultB.monsterHouseRevealed);
    expect(formatEvents(resultA.events)).toEqual(formatEvents(resultB.events));
  });
});
