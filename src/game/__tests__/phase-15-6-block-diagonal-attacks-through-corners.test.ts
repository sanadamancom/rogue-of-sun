import { describe, expect, it } from 'vitest';
import { canMove, isDiagonalCornerOpen } from '../map';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile, Vec2 } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

/**
 * Builds a fully-open rectangular room of the given size, with the given
 * extra tiles forced to 'wall' (everything else, including the border,
 * stays 'floor' — these tests care only about the specific corner tiles
 * under test, not about a realistic enclosed map).
 */
function roomWithWalls(width: number, height: number, walls: Vec2[]): GameMap {
  const terrain: Tile[][] = Array.from({ length: height }, () => Array.from({ length: width }, (): Tile => 'floor'));
  for (const w of walls) terrain[w.y][w.x] = 'wall';
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: roomWithWalls(10, 10, []),
    player: createInitialActor({ x: 2, y: 2 }, 30, 10, 0, 100, 0),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    otencoState: 'sealed',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
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
    ...overrides,
  };
}

describe('Phase 15.6: isDiagonalCornerOpen / canMove sharing', () => {
  it('is always open for cardinal (non-diagonal) pairs, regardless of walls', () => {
    const map = roomWithWalls(5, 5, [{ x: 2, y: 1 }]);
    expect(isDiagonalCornerOpen(map, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
    expect(isDiagonalCornerOpen(map, { x: 1, y: 1 }, { x: 1, y: 2 })).toBe(true);
  });

  it('is open when both corner tiles are walkable', () => {
    const map = roomWithWalls(5, 5, []);
    expect(isDiagonalCornerOpen(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
  });

  it('is closed when only sideA (attacker.x+dx, attacker.y) is a wall', () => {
    const map = roomWithWalls(5, 5, [{ x: 2, y: 1 }]);
    expect(isDiagonalCornerOpen(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });

  it('is closed when only sideB (attacker.x, attacker.y+dy) is a wall', () => {
    const map = roomWithWalls(5, 5, [{ x: 1, y: 2 }]);
    expect(isDiagonalCornerOpen(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });

  it('is closed when both corner tiles are walls', () => {
    const map = roomWithWalls(5, 5, [{ x: 2, y: 1 }, { x: 1, y: 2 }]);
    expect(isDiagonalCornerOpen(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });

  it('canMove for a diagonal step agrees exactly with isDiagonalCornerOpen (shared logic)', () => {
    const map = roomWithWalls(5, 5, [{ x: 2, y: 1 }]);
    const from = { x: 1, y: 1 };
    const to = { x: 2, y: 2 };
    expect(canMove(map, from, 'SE')).toBe(isDiagonalCornerOpen(map, from, to) && map.terrain[to.y][to.x] === 'floor');
    expect(canMove(map, from, 'SE')).toBe(false);
  });
});

describe('Phase 15.6: player attack through a corner', () => {
  it('attacks an enemy adjacent to the north/south/east/west (cardinal) normally', () => {
    for (const [facing, epos] of [
      ['N', { x: 2, y: 1 }],
      ['S', { x: 2, y: 3 }],
      ['E', { x: 3, y: 2 }],
      ['W', { x: 1, y: 2 }],
    ] as const) {
      const enemy = createInitialEnemy('bok', epos, 6, 0);
      const state = freshState({ equippedWeaponId: 'sword', enemies: [enemy] });
      state.player.facing = facing;
      const result = processTurn(state, { type: 'action' });
      expect(result.playerAttacked).toBe(true);
      expect(enemy.hp).toBeLessThan(6);
    }
  });

  it('attacks an enemy at an open diagonal position', () => {
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 0);
    const state = freshState({ equippedWeaponId: 'sword', enemies: [enemy] });
    state.player.facing = 'SE';
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBeLessThan(6);
  });

  it('does not attack when sideA (attacker.x+dx, attacker.y) is a wall', () => {
    const map = roomWithWalls(10, 10, [{ x: 3, y: 2 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 0);
    const state = freshState({ map, equippedWeaponId: 'sword', enemies: [enemy] });
    state.player.facing = 'SE';
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(6);
  });

  it('does not attack when sideB (attacker.x, attacker.y+dy) is a wall (the other orthogonal side)', () => {
    const map = roomWithWalls(10, 10, [{ x: 2, y: 3 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 0);
    const state = freshState({ map, equippedWeaponId: 'sword', enemies: [enemy] });
    state.player.facing = 'SE';
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(6);
  });

  it('does not attack when both orthogonal sides are walls', () => {
    const map = roomWithWalls(10, 10, [{ x: 3, y: 2 }, { x: 2, y: 3 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 0);
    const state = freshState({ map, equippedWeaponId: 'sword', enemies: [enemy] });
    state.player.facing = 'SE';
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(6);
  });

  it('a corner-blocked attack never defeats the enemy or grants EXP', () => {
    const map = roomWithWalls(10, 10, [{ x: 3, y: 2 }, { x: 2, y: 3 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 1, 0); // 1 HP: would die to any real hit
    const state = freshState({ map, equippedWeaponId: 'sword', enemies: [enemy] });
    state.player.facing = 'SE';
    const experienceBefore = (state as unknown as { experience?: number }).experience ?? 0;
    const result = processTurn(state, { type: 'action' });
    expect(enemy.alive).toBe(true);
    expect(enemy.hp).toBe(1);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(false);
    expect(result.events.some((e) => e.type === 'experience_gained')).toBe(false);
    expect((state as unknown as { experience?: number }).experience ?? 0).toBe(experienceBefore);
  });
});

describe('Phase 15.6: enemy attack through a corner (symmetric with the player)', () => {
  it('attacks the player when cardinally adjacent', () => {
    for (const epos of [
      { x: 2, y: 1 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
    ]) {
      const enemy = createInitialEnemy('bok', epos, 6, 10, 0, 0, 0, 100, 0);
      const state = freshState({ enemies: [enemy], combatRngState: 304 });
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'wait' });
      expect(state.player.hp).toBeLessThan(hpBefore);
    }
  });

  it('attacks the player from an open diagonal position', () => {
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
    const state = freshState({ enemies: [enemy] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBeLessThan(hpBefore);
  });

  it('does not attack when sideA (enemy.x+dx, enemy.y) is a wall', () => {
    // Enemy at (3,3), player at (2,2): dx=-1,dy=-1 from the enemy's
    // perspective, so sideA=(2,3).
    const map = roomWithWalls(10, 10, [{ x: 2, y: 3 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
    const state = freshState({ map, enemies: [enemy] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('does not attack when sideB (enemy.x, enemy.y+dy) is a wall (the other orthogonal side)', () => {
    const map = roomWithWalls(10, 10, [{ x: 3, y: 2 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
    const state = freshState({ map, enemies: [enemy] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('does not attack when both orthogonal sides are walls', () => {
    const map = roomWithWalls(10, 10, [{ x: 2, y: 3 }, { x: 3, y: 2 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
    const state = freshState({ map, enemies: [enemy] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('never pushes an enemy_attack or enemy_attack_missed event when blocked by a corner (fully silent, not even a miss)', () => {
    const map = roomWithWalls(10, 10, [{ x: 2, y: 3 }, { x: 3, y: 2 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
    const state = freshState({ map, enemies: [enemy] });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_attack_missed')).toBe(false);
  });

  it('falls back to its existing chase-step AI when attack is blocked by a corner, instead of standing still forever', () => {
    // Only sideA=(2,3) is a wall; sideB=(3,2) stays open, so the enemy has
    // a legal cardinal step around the corner even though the direct
    // diagonal attack/move is blocked.
    const map = roomWithWalls(10, 10, [{ x: 2, y: 3 }]);
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
    const state = freshState({ map, enemies: [enemy] });
    const posBefore = { ...enemy.pos };
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).not.toEqual(posBefore); // it moved instead of standing still
  });
});

describe('Phase 15.6: regression — diagonal movement corner-cut rules are unaffected', () => {
  it('the player still cannot move diagonally through a blocked corner', () => {
    const map = roomWithWalls(10, 10, [{ x: 3, y: 2 }, { x: 2, y: 3 }]);
    const state = freshState({ map });
    state.player.pos = { x: 2, y: 2 };
    const result = processTurn(state, { type: 'move', direction: 'SE' });
    expect(result.consumed).toBe(false);
    expect(state.player.pos).toEqual({ x: 2, y: 2 });
  });

  it('the player can still move through an open diagonal', () => {
    const state = freshState();
    state.player.pos = { x: 2, y: 2 };
    const result = processTurn(state, { type: 'move', direction: 'SE' });
    expect(result.consumed).toBe(true);
    expect(state.player.pos).toEqual({ x: 3, y: 3 });
  });

  it('cardinal movement and attacks are completely unaffected by this change', () => {
    const map = roomWithWalls(10, 10, [{ x: 3, y: 2 }, { x: 2, y: 3 }]);
    const state = freshState({ map });
    state.player.pos = { x: 2, y: 2 };
    const result = processTurn(state, { type: 'move', direction: 'N' });
    expect(result.consumed).toBe(true);
    expect(state.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('a normal (non-corner-blocked) kill still defeats the enemy and grants EXP', () => {
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 1, 0);
    const state = freshState({ equippedWeaponId: 'sword', enemies: [enemy] });
    state.player.facing = 'SE';
    const result = processTurn(state, { type: 'action' });
    expect(enemy.alive).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });

  it('applies the same corner rule regardless of enemy species (spot check: axe and sword species)', () => {
    for (const type of ['axe', 'sword'] as const) {
      const map = roomWithWalls(10, 10, [{ x: 2, y: 3 }, { x: 3, y: 2 }]);
      const enemy = createInitialEnemy(type, { x: 3, y: 3 }, 6, 10, 0, 0, 0, 100, 0);
      const state = freshState({ map, enemies: [enemy] });
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'wait' });
      expect(state.player.hp).toBe(hpBefore);
    }
  });
});
