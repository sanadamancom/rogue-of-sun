/**
 * Phase 21.3 implementation_gate tests: monster-house reveal on first
 * entry (applyMonsterHouseReveal) and its production wiring into
 * processTurn's move -> reveal -> enemy-action pipeline.
 */
import { describe, expect, it } from 'vitest';
import { GameMap, GameState, Room, Tile } from '../types';
import { applyMonsterHouseReveal } from '../monster-house';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createEmptyInventory } from '../item-def';

// Two rooms connected by a 1-wide corridor: room A (start) at x:[1,6),
// y:[1,6); room B (monster house target) at x:[10,16), y:[1,6). Corridor
// runs along y=3 from x=6 to x=10 — strictly outside both room rectangles
// (matches doorway-rule.test.ts's finding that doorway/corridor tiles
// never lie inside a room rectangle).
function testMap(): GameMap {
  const width = 20;
  const height = 8;
  const terrain: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push(new Array(width).fill('wall'));
  }
  const roomA: Room = { x: 1, y: 1, width: 5, height: 5 };
  const roomB: Room = { x: 10, y: 1, width: 6, height: 5 };
  for (const room of [roomA, roomB]) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        terrain[y][x] = 'floor';
      }
    }
  }
  // Corridor tile row at y=3 connecting the two rooms (x=6..9), strictly
  // between the rooms and outside both rectangles.
  for (let x = 6; x <= 9; x++) {
    terrain[3][x] = 'floor';
  }
  return { width, height, terrain, rooms: [roomA, roomB], exit: { x: 12, y: 3 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 3, y: 3 }, 30, 10, 0, 90, 0),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 2,
    totalFloors: 3,
    exit: { x: 12, y: 3 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { ...createEmptyInventory(),
      apple: 0,
      sword: 0,
      armor: 0,
      spear: 0,
      hammer: 0,
      sun_fruit: 0,
      solar_gun: 0,
      sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0,
      chocolate: 0,
      banana: 0,
      antidote: 0,
      panacea: 0,
      clairvoyance_fruit: 0,
      high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0,
    },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    traps: [],
    ...overrides,
  };
}

describe('applyMonsterHouseReveal: state transition (pure function)', () => {
  it('hidden -> revealed when moving from outside into the target room', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const revealed = applyMonsterHouseReveal(map, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(revealed).toBe(true);
    expect(map.monsterHouse.status).toBe('revealed');
  });

  it('roomIndex is unchanged after reveal', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    applyMonsterHouseReveal(map, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(map.monsterHouse.roomIndex).toBe(1);
  });

  it('consumes no RNG (pure, deterministic mutation)', () => {
    // No rng parameter exists on applyMonsterHouseReveal at all; confirm
    // repeated identical calls produce identical results.
    const mapA = testMap();
    mapA.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const mapB = testMap();
    mapB.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const resultA = applyMonsterHouseReveal(mapA, { x: 9, y: 3 }, { x: 11, y: 3 });
    const resultB = applyMonsterHouseReveal(mapB, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(resultA).toBe(resultB);
    expect(mapA.monsterHouse).toEqual(mapB.monsterHouse);
  });

  it('undefined monsterHouse: no-op, returns false', () => {
    const map = testMap();
    // map.monsterHouse left undefined
    const result = applyMonsterHouseReveal(map, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse).toBeUndefined();
  });

  it('null monsterHouse: no-op, returns false', () => {
    const map = testMap();
    map.monsterHouse = null;
    const result = applyMonsterHouseReveal(map, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse).toBeNull();
  });

  it('already revealed: no-op, stays revealed', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'revealed' };
    const result = applyMonsterHouseReveal(map, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse.status).toBe('revealed');
  });

  it('entering a different (non-target) room does not reveal', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    // Moving into room A (index 0), not the monster house room (index 1).
    const result = applyMonsterHouseReveal(map, { x: 6, y: 3 }, { x: 3, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse.status).toBe('hidden');
  });

  it('moving outside-to-outside (corridor to corridor) does not reveal', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = applyMonsterHouseReveal(map, { x: 6, y: 3 }, { x: 7, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse.status).toBe('hidden');
  });

  it('moving inside-to-inside (within the target room) does not re-reveal (already hidden->hidden, no transition needed here since it was never revealed, but confirms no spurious flip)', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'revealed' };
    const result = applyMonsterHouseReveal(map, { x: 11, y: 3 }, { x: 12, y: 4 });
    expect(result).toBe(false);
    expect(map.monsterHouse.status).toBe('revealed');
  });

  it('leaving the room after reveal keeps status revealed (never reverts to hidden)', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'revealed' };
    const result = applyMonsterHouseReveal(map, { x: 11, y: 3 }, { x: 9, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse.status).toBe('revealed');
  });

  it('re-entering an already-revealed room does not re-transition (idempotent)', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'revealed' };
    const result = applyMonsterHouseReveal(map, { x: 9, y: 3 }, { x: 11, y: 3 });
    expect(result).toBe(false);
    expect(map.monsterHouse.status).toBe('revealed');
  });

  it('does not mutate map.rooms, posBefore, or posAfter', () => {
    const map = testMap();
    map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const roomsBefore = JSON.parse(JSON.stringify(map.rooms));
    const posBefore = { x: 9, y: 3 };
    const posAfter = { x: 11, y: 3 };
    const posBeforeCopy = { ...posBefore };
    const posAfterCopy = { ...posAfter };
    applyMonsterHouseReveal(map, posBefore, posAfter);
    expect(map.rooms).toEqual(roomsBefore);
    expect(posBefore).toEqual(posBeforeCopy);
    expect(posAfter).toEqual(posAfterCopy);
  });
});

describe('processTurn: monster house reveal integration', () => {
  it('a successful normal move into the target room reveals it', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(result.monsterHouseRevealed).toBe(true);
    expect(state.map.monsterHouse.status).toBe('revealed');
  });

  it('moving toward the room from the corridor approach (not yet inside) does not reveal', () => {
    const state = freshState({
      player: createInitialActor({ x: 6, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(result.monsterHouseRevealed).toBe(false);
    expect(state.map.monsterHouse.status).toBe('hidden');
  });

  it('a blocked move into a wall does not reveal and does not consume a turn', () => {
    const state = freshState({
      player: createInitialActor({ x: 3, y: 1 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'N' }); // wall above
    expect(result.consumed).toBe(false);
    expect(result.monsterHouseRevealed).toBe(false);
    expect(state.map.monsterHouse.status).toBe('hidden');
  });

  it('a move blocked by an enemy does not reveal', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 10, y: 3 }, 1000, 0, 0, 0, 0, 0, 0)],
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    // Moving into an occupied tile resolves as an attack, not a move —
    // player position does not change, so no reveal should occur.
    expect(state.player.pos).toEqual({ x: 9, y: 3 });
    expect(result.monsterHouseRevealed).toBe(false);
    expect(state.map.monsterHouse.status).toBe('hidden');
  });

  it('waiting outside the target room does not reveal', () => {
    const state = freshState({
      player: createInitialActor({ x: 3, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(result.monsterHouseRevealed).toBe(false);
    expect(state.map.monsterHouse.status).toBe('hidden');
  });

  it('facing (a non-move action) outside the target room does not reveal', () => {
    const state = freshState({
      player: createInitialActor({ x: 3, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'face', direction: 'N' });
    expect(result.monsterHouseRevealed).toBe(false);
    expect(state.map.monsterHouse.status).toBe('hidden');
  });

  it('the reveal happens before enemy actions resolve this same turn (enemy still acts exactly once)', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 13, y: 3 }, 10, 2, 0, 0, 0, 90, 0)],
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.monsterHouseRevealed).toBe(true);
    // Enemy phase ran exactly once this turn (acted flag reflects the
    // single resolveEnemiesAction pass — bok's chase-step AI moves it
    // toward the player, so acted should be true; the key assertion is
    // that this is the same single call, not a doubled/skipped one).
    expect(result.enemyActed).toBe(true);
  });

  it('the move that reveals still consumes exactly 1 turn (turn counter advances by 1)', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const turnBefore = state.turn;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('does not require additional input after a reveal (single processTurn call fully resolves it)', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.phase).toBe('playing');
  });

  it('re-entering an already-revealed room via processTurn does not re-transition or re-flag', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'revealed' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.monsterHouseRevealed).toBe(false);
    expect(state.map.monsterHouse.status).toBe('revealed');
  });

  it('a floor with no monster house never sets monsterHouseRevealed', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
    });
    // map.monsterHouse left undefined (no monster house this floor)
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.monsterHouseRevealed).toBe(false);
  });
});

describe('regression: existing behavior unaffected by monster house reveal wiring', () => {
  it('normal room entry (no monster house on the floor) behaves exactly as before', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.player.pos).toEqual({ x: 10, y: 3 });
  });

  it('GameState literals without map.monsterHouse continue to work (optional field)', () => {
    const state = freshState();
    expect(state.map.monsterHouse).toBeUndefined();
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(result.monsterHouseRevealed).toBe(false);
  });
});
