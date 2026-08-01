import { describe, expect, it } from 'vitest';
import { computeHitChance } from '../combat';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { WEAPON_DEFINITIONS } from '../weapon-def';
import { createEmptyInventory } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

const TEST_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#..####..#',
  '#..#..#..#',
  '#..#..#..#',
  '#..####..#',
  '#........#',
  '##########',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 90, 0),
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
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
    selectedEnchantment: 'none',
    sunlight: [],
    combatRngState: 0,
    ...overrides,
  };
}

function faceEast(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

// mulberry32Step(0) is a known, precomputed roll of 26 (see rng.ts's
// algorithm) — well under every realistic hitChance in this game, so
// combatRngState: 0 is used throughout as a "guaranteed hit" seed for a
// single roll. A seed whose first roll is >= every realistic hitChance
// is used as a "guaranteed miss" seed instead.
const GUARANTEED_HIT_SEED = 0; // first roll: 26
const GUARANTEED_MISS_SEED = 43; // first roll: 99 (>= every possible hitChance, so always a miss)

describe('initial accuracy/evasion/hitModifier values (Phase 10.3)', () => {
  it('player: accuracy 90, evasion 0', () => {
    const state = createInitialState(1);
    expect(state.player.accuracy).toBe(90);
    expect(state.player.evasion).toBe(0);
  });

  it('every enemy: accuracy 90', () => {
    for (const def of Object.values(ENEMY_DEFINITIONS)) {
      expect(def.accuracy).toBe(90);
    }
  });

  it('bat: evasion 10; every other species: evasion 0', () => {
    expect(ENEMY_DEFINITIONS.bat.evasion).toBe(10);
    for (const [type, def] of Object.entries(ENEMY_DEFINITIONS)) {
      if (type === 'bat') continue;
      expect(def.evasion).toBe(0);
    }
  });

  it('weapon hit modifiers: sword +5, spear +5, hammer -5, solar_gun +5', () => {
    expect(WEAPON_DEFINITIONS.sword.hitModifier).toBe(5);
    expect(WEAPON_DEFINITIONS.spear.hitModifier).toBe(5);
    expect(WEAPON_DEFINITIONS.hammer.hitModifier).toBe(-5);
    expect(WEAPON_DEFINITIONS.solar_gun.hitModifier).toBe(5);
  });

  it('expected hit chances against a normal enemy (evasion 0)', () => {
    const evasion = 0;
    expect(computeHitChance(90, 0, evasion)).toBe(90); // bare hands
    expect(computeHitChance(90, WEAPON_DEFINITIONS.sword.hitModifier, evasion)).toBe(95);
    expect(computeHitChance(90, WEAPON_DEFINITIONS.spear.hitModifier, evasion)).toBe(95);
    expect(computeHitChance(90, WEAPON_DEFINITIONS.hammer.hitModifier, evasion)).toBe(85);
    expect(computeHitChance(90, WEAPON_DEFINITIONS.solar_gun.hitModifier, evasion)).toBe(95);
  });

  it('expected hit chances against a bat (evasion 10)', () => {
    const evasion = ENEMY_DEFINITIONS.bat.evasion;
    expect(computeHitChance(90, 0, evasion)).toBe(80); // bare hands
    expect(computeHitChance(90, WEAPON_DEFINITIONS.sword.hitModifier, evasion)).toBe(85);
    expect(computeHitChance(90, WEAPON_DEFINITIONS.spear.hitModifier, evasion)).toBe(85);
    expect(computeHitChance(90, WEAPON_DEFINITIONS.hammer.hitModifier, evasion)).toBe(75);
    expect(computeHitChance(90, WEAPON_DEFINITIONS.solar_gun.hitModifier, evasion)).toBe(85);
  });

  it('expected hit chance for a normal enemy attacking the player', () => {
    expect(computeHitChance(90, 0, 0)).toBe(90);
  });
});

describe('player attack: hit and miss (Phase 10.3)', () => {
  it('a guaranteed-hit roll deals damage and does not push a miss event', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'player_attack')).toBe(true);
    expect(result.events.some((e) => e.type === 'player_attack_missed')).toBe(false);
  });

  it('a guaranteed-miss roll pushes a miss event and never touches enemy HP', () => {
    const state = freshState({ combatRngState: GUARANTEED_MISS_SEED });
    const hpBefore = state.enemies[0].hp;
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'player_attack_missed')).toBe(true);
    expect(result.events.some((e) => e.type === 'player_attack')).toBe(false);
    expect(state.enemies[0].hp).toBe(hpBefore);
  });

  it('a miss never defeats the enemy', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)], // 1 HP: would die on any hit
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(true);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(false);
  });

  it('each weapon can miss and can hit (sword/spear/hammer/solar_gun/bare hands)', () => {
    const weapons: (import('../types').WeaponId | null)[] = ['sword', 'spear', 'hammer', 'solar_gun', null];
    for (const weaponId of weapons) {
      const hitState = freshState({
        combatRngState: GUARANTEED_HIT_SEED,
        equippedWeaponId: weaponId,
        inventory: weaponId ? { ...createEmptyInventory(), [weaponId]: 1 } : createEmptyInventory(),
      });
      faceEast(hitState);
      const hitResult = processTurn(hitState, { type: 'action' });
      expect(hitResult.events.some((e) => e.type === 'player_attack')).toBe(true);

      const missState = freshState({
        combatRngState: GUARANTEED_MISS_SEED,
        equippedWeaponId: weaponId,
        inventory: weaponId ? { ...createEmptyInventory(), [weaponId]: 1 } : createEmptyInventory(),
      });
      faceEast(missState);
      const missResult = processTurn(missState, { type: 'action' });
      expect(missResult.events.some((e) => e.type === 'player_attack_missed')).toBe(true);
    }
  });
});

describe('miss side effects (Phase 10.3)', () => {
  it('hammer miss: no knockback', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
    });
    faceEast(state);
    const before = { ...state.enemies[0].pos };
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'enemy_knocked_back')).toBe(false);
    expect(state.enemies[0].pos).toEqual(before);
  });

  it('hammer miss: hammerRecovery still triggers (the swing itself happened)', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('melee miss: sol enchantment SOL is not consumed', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      selectedEnchantment: 'sol',
      solarEnergy: 5,
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('solar gun: a valid shot that misses still consumes its own SOL cost', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      solarEnergy: 5,
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
    expect(result.events.some((e) => e.type === 'player_attack_missed')).toBe(true);
  });

  it('no target / out of range / insufficient SOL: no roll and no combat RNG consumption', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      solarEnergy: 0, // insufficient
    });
    const stateBefore = state.combatRngState;
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.combatRngState).toBe(stateBefore);
  });

  it('a whiff (no target in range) never consumes combat RNG', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED, enemies: [] });
    const stateBefore = state.combatRngState;
    processTurn(state, { type: 'face', direction: 'N' });
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'player_whiff')).toBe(true);
    expect(state.combatRngState).toBe(stateBefore);
  });
});

describe('enemy attack: hit and miss (Phase 10.3)', () => {
  it('a hit reduces player HP; a miss does not', () => {
    const hitState = freshState({ combatRngState: GUARANTEED_HIT_SEED });
    const hpBefore = hitState.player.hp;
    processTurn(hitState, { type: 'wait' });
    expect(hitState.player.hp).toBeLessThan(hpBefore);

    const missState = freshState({ combatRngState: GUARANTEED_MISS_SEED });
    const hpBefore2 = missState.player.hp;
    const result = processTurn(missState, { type: 'wait' });
    expect(missState.player.hp).toBe(hpBefore2);
    expect(result.events.some((e) => e.type === 'enemy_attack_missed')).toBe(true);
  });

  it('a miss still ends that enemy\'s turn (enemyActed true)', () => {
    const state = freshState({ combatRngState: GUARANTEED_MISS_SEED });
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyActed).toBe(true);
  });

  it('existing armor-based damage reduction still applies on a hit', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedArmorId: 'armor',
      inventory: { ...createEmptyInventory(), armor: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)], // attack 10 = armorValue 10 -> 0 dmg
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore); // fully absorbed, same as pre-10.3
  });
});

describe('miss side effects on world state (Phase 10.3)', () => {
  it('a player miss never triggers enemy_defeated or drops', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(false);
    expect(state.phase).toBe('playing');
  });

  it('a hit still triggers the existing defeat/floor-cleared path normally', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });
});

describe('combat RNG determinism (Phase 10.3)', () => {
  it('the same seed and same input sequence produce the same sequence of hit/miss results', () => {
    function runSequence(): boolean[] {
      const state = freshState({ combatRngState: 555 });
      const outcomes: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        state.enemies[0].hp = 1000;
        faceEast(state);
        const result = processTurn(state, { type: 'action' });
        outcomes.push(result.events.some((e) => e.type === 'player_attack'));
      }
      return outcomes;
    }
    expect(runSequence()).toEqual(runSequence());
  });

  it('createInitialState seeds combatRngState deterministically from runSeed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.combatRngState).toBe(b.combatRngState);
  });

  it('a different run seed gives a different combatRngState (in general)', () => {
    const a = createInitialState(1);
    const b = createInitialState(2);
    expect(a.combatRngState).not.toBe(b.combatRngState);
  });

  it('combatRngState persists (already-advanced) across a floor transition', () => {
    let state = createInitialState(42);
    // Consume one combat roll.
    state.enemies[0].pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    faceEast(state);
    processTurn(state, { type: 'action' });
    const advancedRngState = state.combatRngState;
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    state = advanceToNextFloor(state);
    expect(state.combatRngState).toBe(advancedRngState);
  });

  it('combat RNG never perturbs map generation determinism', () => {
    const a = createInitialState(2024);
    const b = createInitialState(2024);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    expect(a.groundItems).toEqual(b.groundItems);
  });
});

describe('weapon/species regression under the hit/miss system (Phase 10.3)', () => {
  it('sword still only reaches adjacent tiles', () => {
    expect(WEAPON_DEFINITIONS.sword.reach).toBe(1);
  });

  it('spear still reaches 2 tiles', () => {
    expect(WEAPON_DEFINITIONS.spear.reach).toBe(2);
  });

  it('a guaranteed-hit hammer attack still knocks back a surviving enemy', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'enemy_knocked_back')).toBe(true);
  });
});
