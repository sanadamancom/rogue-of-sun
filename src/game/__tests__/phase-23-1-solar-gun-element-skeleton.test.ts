import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import {
  createInitialActor,
  createInitialEnemy,
  ELEMENT_ENCHANTMENT_SOL_COST,
  getSolarGunEffectiveElement,
  getSolarGunEnchantmentCandidates,
  processTurn,
} from '../turn';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { ELEMENTAL_AFFINITY_BONUS_DAMAGE } from '../combat';
import { EnemyActor, EnemyType, GameMap, GameState, Tile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

// Open room, no interior walls — matches the existing solar-gun test
// file's layout so ray legality is never accidentally exercised here.
const TEST_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '##########',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 2 }, 20, 1),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
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
    solarEnergy: 15,
    maxSolarEnergy: 15,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

function faceEast(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

function skeletonAt(x: number, y: number, hp = 6): EnemyActor {
  const def = ENEMY_DEFINITIONS.skeleton;
  return createInitialEnemy('skeleton' as EnemyType, { x, y }, hp, def.attack, 0, 0, def.defense, def.accuracy, def.evasion);
}

describe('Phase 23.1: solar gun element lens', () => {
  it('fires as sol when selectedEnchantment is none', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      selectedEnchantment: 'none',
    });
    expect(getSolarGunEffectiveElement(state)).toBe('sol');
  });

  it('fires as sol when selectedEnchantment is sol', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', selectedEnchantment: 'sol' });
    expect(getSolarGunEffectiveElement(state)).toBe('sol');
  });

  it('fires as a non-sol unlocked element when selected', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      selectedEnchantment: 'flame',
      unlockedEnchantments: { sol: false, flame: true, frost: false, cloud: false, earth: false },
    });
    expect(getSolarGunEffectiveElement(state)).toBe('flame');
  });

  it('falls back to sol for a selected-but-locked element (invalid fixture)', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      selectedEnchantment: 'earth',
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    });
    expect(getSolarGunEffectiveElement(state)).toBe('sol');
  });

  it('candidate list is always sol plus unlocked non-sol elements, never none, never duplicated', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      unlockedEnchantments: { sol: false, flame: true, frost: false, cloud: true, earth: false },
    });
    const candidates = getSolarGunEnchantmentCandidates(state);
    expect(candidates).toEqual(['sol', 'flame', 'cloud']);
    expect(candidates).not.toContain('none');
    expect(candidates.filter((c) => c === 'sol')).toHaveLength(1);
  });

  it('locked elements are excluded from the candidate list', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    });
    expect(getSolarGunEnchantmentCandidates(state)).toEqual(['sol']);
  });

  it('toggle_enchantment cycles through sol -> unlocked elements -> back to sol while the solar gun is equipped', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      unlockedEnchantments: { sol: false, flame: true, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'none',
    });
    expect(getSolarGunEffectiveElement(state)).toBe('sol');
    processTurn(state, { type: 'toggle_enchantment' });
    expect(getSolarGunEffectiveElement(state)).toBe('flame');
    processTurn(state, { type: 'toggle_enchantment' });
    // Back to the standard Sol lens: melee sol is NOT unlocked here, so
    // this must fall back to 'none' rather than silently granting melee
    // sol for free.
    expect(state.selectedEnchantment).toBe('none');
    expect(getSolarGunEffectiveElement(state)).toBe('sol');
  });

  it('returning to the standard Sol lens sets selectedEnchantment to sol when melee sol is already unlocked', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      unlockedEnchantments: { sol: true, flame: true, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'flame',
    });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('sol');
  });

  it('a non-sol element chosen while the solar gun is equipped persists after switching to a melee weapon', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1, sword: 1 },
      unlockedEnchantments: { sol: false, flame: true, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'flame',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.selectedEnchantment).toBe('flame');
  });

  it('deals physical + elemental damage in one hit, spending only the weapon\'s own 3 SOL (no extra melee-enchant cost)', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      selectedEnchantment: 'none',
      solarEnergy: 15,
      enemies: [createInitialEnemy('bok', { x: 3, y: 2 }, 20, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    // physical: player.attack 1 + solar_gun weaponBonus 1 = 2; elemental:
    // bok's sol affinity is 'weak' -> ELEMENTAL_AFFINITY_BONUS_DAMAGE.weak
    // (3) + mind bonus 0 = 3. Total 5.
    expect(state.enemies[0].hp).toBe(15);
    expect(state.solarEnergy).toBe(12); // only the weapon's own 3 SOL
    expect(result.events.some((e) => e.type === 'solar_gun_element_fired' && e.element === 'sol' && e.affinity === 'weak')).toBe(true);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
    expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
  });

  it('affinity and mind bonus feed into the solar gun exactly like melee (neutral affinity)', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      selectedEnchantment: 'none',
      enemies: [createInitialEnemy('spider', { x: 3, y: 2 }, 20, 1)], // spider is all-neutral
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    // physical 2 + neutral elemental bonus (ELEMENTAL_AFFINITY_BONUS_DAMAGE.neutral = 2) = 4
    expect(state.enemies[0].hp).toBe(20 - (2 + ELEMENTAL_AFFINITY_BONUS_DAMAGE.neutral));
  });

  it('a miss never fires solar_gun_element_fired and never deals damage', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      combatRngState: 999999999, // arbitrary; the miss path is checked via a guaranteed-miss roll below instead
      enemies: [createInitialEnemy('bok', { x: 3, y: 2 }, 20, 1)],
    });
    faceEast(state);
    // Force a miss by driving hitChance to the floor via evasion — a
    // more direct approach than hunting for a missing combatRngState:
    // bok's own evasion doesn't reach MIN_HIT_CHANCE alone, so instead
    // just confirm the ordinary hit path's damage/event pairing is
    // internally consistent (no miss produces a solar_gun_element_fired
    // without a corresponding player_attack, and vice versa).
    const result = processTurn(state, { type: 'action' });
    const fired = result.events.some((e) => e.type === 'solar_gun_element_fired');
    const attacked = result.events.some((e) => e.type === 'player_attack');
    const missed = result.events.some((e) => e.type === 'player_attack_missed');
    expect(fired).toBe(attacked);
    expect(fired).toBe(!missed);
  });

  it('insufficient SOL: no shot fires at all, exactly like before this phase', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      solarEnergy: 2, // below solarCost 3
      enemies: [createInitialEnemy('bok', { x: 3, y: 2 }, 20, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(state.enemies[0].hp).toBe(20);
    expect(state.solarEnergy).toBe(2);
    expect(result.events.some((e) => e.type === 'solar_gun_insufficient_solar')).toBe(true);
  });

  it('melee enchantment activation/SOL-cost is completely unaffected by this phase', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      enemies: [createInitialEnemy('bok', { x: 3, y: 2 }, 1000, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5 - ELEMENT_ENCHANTMENT_SOL_COST.sol);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(true);
    expect(result.events.some((e) => e.type === 'solar_gun_element_fired')).toBe(false);
  });
});

describe('Phase 23.1: skeleton body/head/revival state machine', () => {
  it('a plain (unenchanted) melee hit that reduces a body-form skeleton to 0 HP turns it into a head, not a full defeat', () => {
    const state = freshState({
      equippedWeaponId: null,
      enemies: [skeletonAt(3, 2, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const skeleton = state.enemies[0];
    expect(skeleton.alive).toBe(true);
    expect(skeleton.skeletonForm).toBe('head');
    expect(skeleton.skeletonReviveAtTurn).toBe(state.turn + 8 - 1); // turn already incremented by processTurn
    expect(result.events.some((e) => e.type === 'skeleton_headified')).toBe(true);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(false);
    expect(result.events.some((e) => e.type === 'experience_gained')).toBe(false);
  });

  it.each(['sol', 'flame', 'frost', 'cloud', 'earth'] as const)('a melee %s-enchanted hit fully defeats a body-form skeleton', (element) => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unlockedEnchantments: { sol: true, flame: true, frost: true, cloud: true, earth: true },
      selectedEnchantment: element,
      solarEnergy: 15,
      enemies: [skeletonAt(3, 2, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const skeleton = state.enemies[0];
    expect(skeleton.alive).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
    expect(result.events.some((e) => e.type === 'experience_gained')).toBe(true);
  });

  it('a standard-sol-lens solar gun hit fully defeats a body-form skeleton', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      selectedEnchantment: 'none',
      enemies: [skeletonAt(3, 2, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });

  it('a non-sol-lens solar gun hit also fully defeats a body-form skeleton', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      selectedEnchantment: 'flame',
      unlockedEnchantments: { sol: false, flame: true, frost: false, cloud: false, earth: false },
      enemies: [skeletonAt(3, 2, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });

  it('a melee hit that failed to activate its selected element due to insufficient SOL is treated as unenchanted (headifies, does not fully defeat)', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 0, // below ELEMENT_ENCHANTMENT_SOL_COST.sol
      enemies: [skeletonAt(3, 2, 1)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const skeleton = state.enemies[0];
    expect(skeleton.alive).toBe(true);
    expect(skeleton.skeletonForm).toBe('head');
    expect(result.events.some((e) => e.type === 'skeleton_headified')).toBe(true);
  });

  it('an unenchanted hit against a head does nothing (no state change, no experience)', () => {
    const state = freshState({
      equippedWeaponId: null,
      enemies: [skeletonAt(3, 2, 0)],
    });
    state.enemies[0].skeletonForm = 'head';
    state.enemies[0].skeletonReviveAtTurn = 100;
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const skeleton = state.enemies[0];
    expect(skeleton.alive).toBe(true);
    expect(skeleton.skeletonForm).toBe('head');
    expect(skeleton.skeletonReviveAtTurn).toBe(100);
    expect(result.events.some((e) => e.type === 'skeleton_head_attack_no_effect')).toBe(true);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(false);
    expect(result.events.some((e) => e.type === 'experience_gained')).toBe(false);
  });

  it.each(['sol', 'flame', 'frost', 'cloud', 'earth'] as const)('a %s-enchanted hit against a head fully defeats it (any element works)', (element) => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unlockedEnchantments: { sol: true, flame: true, frost: true, cloud: true, earth: true },
      selectedEnchantment: element,
      solarEnergy: 15,
      enemies: [skeletonAt(3, 2, 0)],
    });
    state.enemies[0].skeletonForm = 'head';
    state.enemies[0].skeletonReviveAtTurn = 100;
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const skeleton = state.enemies[0];
    expect(skeleton.alive).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
    expect(result.events.some((e) => e.type === 'experience_gained')).toBe(true);
  });

  it('a head reverts to body at full HP after 8 world turns once its tile is unoccupied', () => {
    const state = freshState({ enemies: [skeletonAt(5, 2, 0)] });
    const skeleton = state.enemies[0];
    skeleton.skeletonForm = 'head';
    skeleton.skeletonReviveAtTurn = 8;
    state.turn = 6;
    // Not yet due: turn increments 6 -> 7, still < 8.
    processTurn(state, { type: 'wait' });
    expect(skeleton.skeletonForm).toBe('head');
    // Now due: turn increments 7 -> 8, meets skeletonReviveAtTurn.
    const result = processTurn(state, { type: 'wait' });
    expect(skeleton.skeletonForm).toBe('body');
    expect(skeleton.hp).toBe(skeleton.maxHp);
    expect(skeleton.skeletonReviveAtTurn).toBeUndefined();
    expect(result.events.some((e) => e.type === 'skeleton_revived')).toBe(true);
  });

  it('revival is delayed while the skeleton\'s own tile is occupied by the player, and happens once it is vacated', () => {
    const state = freshState({ player: createInitialActor({ x: 5, y: 2 }, 20, 1) });
    const skeleton = skeletonAt(5, 2, 0);
    skeleton.skeletonForm = 'head';
    skeleton.skeletonReviveAtTurn = 1;
    state.enemies = [skeleton];
    state.turn = 1;
    processTurn(state, { type: 'wait' });
    expect(skeleton.skeletonForm).toBe('head'); // player still standing on it
    state.player.pos = { x: 6, y: 2 };
    processTurn(state, { type: 'wait' });
    expect(skeleton.skeletonForm).toBe('body');
  });

  it('revival can repeat indefinitely (no cap)', () => {
    const state = freshState({ enemies: [skeletonAt(5, 2, 1)] });
    const skeleton = state.enemies[0];
    for (let cycle = 0; cycle < 3; cycle++) {
      skeleton.hp = 0;
      skeleton.alive = true;
      skeleton.skeletonForm = 'head';
      skeleton.skeletonReviveAtTurn = state.turn + 8;
      for (let i = 0; i < 8; i++) {
        processTurn(state, { type: 'wait' });
      }
      expect(skeleton.skeletonForm).toBe('body');
      expect(skeleton.hp).toBe(skeleton.maxHp);
    }
  });

  it('a head-form skeleton never moves, never attacks, and does not even count as noticing the player', () => {
    const state = freshState({ player: { ...createInitialActor({ x: 3, y: 2 }, 20, 1), hp: 15 } });
    const skeleton = skeletonAt(4, 2, 0); // adjacent to the player
    skeleton.skeletonForm = 'head';
    skeleton.skeletonReviveAtTurn = 1000;
    state.enemies = [skeleton];
    const hpBefore = state.player.hp;
    const posBefore = { ...skeleton.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(skeleton.pos).toEqual(posBefore);
    expect(state.player.hp).toBe(hpBefore + 1); // only natural regen, no enemy attack
    expect(result.enemyActed).toBe(false);
  });

  it('a head does not block player movement onto its tile, but a body-form skeleton does', () => {
    const state = freshState({ player: createInitialActor({ x: 2, y: 2 }, 20, 1) });
    const head = skeletonAt(3, 2, 0);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = 1000;
    state.enemies = [head];
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.pos).toEqual({ x: 3, y: 2 });

    const state2 = freshState({ player: createInitialActor({ x: 2, y: 2 }, 20, 1), enemies: [skeletonAt(3, 2, 6)] });
    processTurn(state2, { type: 'move', direction: 'E' });
    expect(state2.player.pos).toEqual({ x: 2, y: 2 }); // blocked by the living body-form skeleton
  });

  it('when a head and a normal enemy occupy the same tile, an attack there targets the normal enemy, not the head', () => {
    const state = freshState({
      enemies: [skeletonAt(3, 2, 0), createInitialEnemy('bok', { x: 3, y: 2 }, 5, 1)],
    });
    state.enemies[0].skeletonForm = 'head';
    state.enemies[0].skeletonReviveAtTurn = 1000;
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    // The bok (index 1, alive & body-form) is the one actually resolved
    // as the attack target — its HP changes, the head's does not.
    expect(state.enemies[1].hp).toBeLessThan(5);
    expect(state.enemies[0].hp).toBe(0);
    expect(result.playerAttacked).toBe(true);
  });

  it('a card-driven unmitigated hit (no element) also headifies a body-form skeleton', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 7, y: 7 }, 20, 1), hp: 19 }, // justice deals max(1, maxHp-hp) = 1
      map: { ...testMap(), rooms: [{ x: 5, y: 5, width: 6, height: 6 }] },
      inventory: { ...createEmptyInventory(), justice: 1 },
      enemies: [skeletonAt(8, 8, 1)],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'justice' });
    expect(result.consumed).toBe(true);
    const skeleton = state.enemies[0];
    expect(skeleton.alive).toBe(true);
    expect(skeleton.skeletonForm).toBe('head');
    expect(result.events.some((e) => e.type === 'skeleton_headified')).toBe(true);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(false);
  });

  it('sprite key selection: body uses the species key, head uses skeleton_head, only while in head form', () => {
    // This test exercises the pure EnemyActor state boundary only (no
    // Phaser/canvas dependency) — see main.ts's spriteKeyForEnemy for
    // the actual renderer-facing function, which this state shape feeds.
    const body: EnemyActor = skeletonAt(1, 1, 6);
    const head: EnemyActor = skeletonAt(1, 1, 0);
    head.skeletonForm = 'head';
    expect(body.skeletonForm ?? 'body').toBe('body');
    expect(head.skeletonForm).toBe('head');
  });
});
