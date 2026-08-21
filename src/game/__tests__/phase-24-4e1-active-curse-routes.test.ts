import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { normalizeEquipmentInstances, getHeldEquipmentInstances, isEquippedWeaponCurseLocked } from '../equipment-instance';
import { getActiveCurseEligibleInstances, getMummyCurseChance, selectTrapType, TRAP_TYPE_WEIGHTS } from '../curse-active';
import { createEmptyInventory } from '../item-def';
import { GameMap, GameState, Tile, TrapTile, Vec2 } from '../types';
import { formatEvent } from '../message-log';
import { resolveCardTargetEffect } from '../card-target-selection';
import { DEFAULT_RUN_CONFIG } from '../floor';

/**
 * Phase 24.4e1 focused tests: mummy's on-hit curse, curse_trap's
 * on-trigger curse, and their integration with the existing curse-lock/
 * Temperance/identification machinery. See
 * docs/history/phase-24-4e1-active-curse-routes.md for the full
 * contract these tests enforce, and this test file's own fixtures for
 * the exact (seed, floor, turn, combatRngState) combinations used to
 * deterministically hit/miss and succeed/fail the chance roll — found
 * by direct search against the production RNG streams, not hand-picked
 * to match an assumed implementation.
 */

const OPEN_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function testMap(): GameMap {
  const height = OPEN_LAYOUT.length;
  const width = OPEN_LAYOUT[0].length;
  const terrain: Tile[][] = OPEN_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 199, y: 199 } };
}

/** Minimal GameState with exactly one mummy adjacent to the player, matching enemy-behavior-mummy.test.ts's own fixture style. */
function mummyState(overrides: {
  turn?: number;
  combatRngState?: number;
  weapon?: boolean;
  armor?: boolean;
  weaponCursed?: boolean;
}): GameState {
  const turn = overrides.turn ?? 0;
  const mummy = createInitialEnemy('mummy', { x: 9, y: 5 }, 5, 2, turn, 0);
  const state: GameState = {
    map: testMap(),
    player: createInitialActor({ x: 10, y: 5 }, 20, 1),
    enemies: [mummy],
    turn,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    otencoState: 'sealed',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 199, y: 199 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: {
      ...createEmptyInventory(),
      sword: overrides.weapon === false ? 0 : 1,
      armor: overrides.armor ? 1 : 0,
    },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: overrides.weapon === false ? null : 'sword',
    equippedArmorId: overrides.armor ? 'armor' : null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: overrides.combatRngState ?? 0,
    sunlight: [],
  };
  normalizeEquipmentInstances(state);
  const weaponInst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword');
  const armorInst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'armor');
  if (weaponInst) {
    state.equippedWeaponInstanceId = weaponInst.instanceId;
    if (overrides.weaponCursed) {
      weaponInst.cursed = true;
      weaponInst.curseRevealed = true;
    }
  }
  if (armorInst) state.equippedArmorInstanceId = armorInst.instanceId;
  return state;
}

// Found by direct search: at (seed=1, floor=1, turn=4), mummy's chance
// roll succeeds for every combatRngState that lands a hit; at turn=0 it
// never does. combatRngState=0 hits at both turns; combatRngState=4 at
// turn=4 misses.
const TURN_CHANCE_SUCCEEDS = 4;
const TURN_CHANCE_FAILS = 0;
const CRS_HIT = 0;
const CRS_MISS = 4;

describe('Phase 24.4e1: mummy on-hit curse', () => {
  it('scales the on-hit curse threshold with the mummy instance level', () => {
    expect(getMummyCurseChance(1)).toBe(0.1);
    expect(getMummyCurseChance(2)).toBe(0.15);
    expect(getMummyCurseChance(3)).toBe(0.2);
  });

  it('curses the equipped weapon on a confirmed hit with a successful chance roll', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    const result = processTurn(state, { type: 'wait' });
    const cursed = result.events.filter((e) => e.type === 'equipment_cursed');
    expect(cursed).toHaveLength(1);
    expect(cursed[0]).toMatchObject({ source: 'mummy_hit', equipped: true, revealed: true });
    const weaponInst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword')!;
    expect(weaponInst.cursed).toBe(true);
    expect(weaponInst.curseRevealed).toBe(true);
  });

  it('does not curse on a miss, even at a chance-succeeding turn', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_MISS });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack_missed')).toBe(true);
    expect(result.events.some((e) => e.type === 'equipment_cursed')).toBe(false);
  });

  it('does not curse on a hit when the chance roll fails', () => {
    const state = mummyState({ turn: TURN_CHANCE_FAILS, combatRngState: CRS_HIT });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(true);
    expect(result.events.some((e) => e.type === 'equipment_cursed')).toBe(false);
  });

  it('never curses when nothing is equipped (0 eligible candidates)', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT, weapon: false });
    const before = state.combatRngState;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'equipment_cursed')).toBe(false);
    // 0-candidate scope never even constructs the chance RNG stream —
    // this is a purely internal-stream claim, but we can at least assert
    // no crash and normal hit-roll behavior proceeded unaffected.
    expect(typeof state.combatRngState).toBe('number');
    void before;
  });

  it('curses at most one instance even when weapon and armor are both eligible', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT, armor: true });
    const result = processTurn(state, { type: 'wait' });
    const cursed = result.events.filter((e) => e.type === 'equipment_cursed');
    expect(cursed).toHaveLength(1);
  });

  it('never targets an already-cursed equipped weapon (excluded by eligibility)', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT, weaponCursed: true });
    const result = processTurn(state, { type: 'wait' });
    // The only eligible candidate was excluded, so no new curse event
    // fires (0 candidates once the already-cursed weapon is filtered
    // out).
    expect(result.events.some((e) => e.type === 'equipment_cursed')).toBe(false);
  });

  it('does not change general item identification when curse is applied', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    processTurn(state, { type: 'wait' });
    expect((state.identifiedGeneralItemIds ?? []).includes('sword')).toBe(false);
  });

  it('does not advance the turn counter more than the normal single action', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    const turnBefore = state.turn;
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('is deterministic: the same fixture processed twice yields the same curse outcome', () => {
    const stateA = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    const stateB = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    const resultA = processTurn(stateA, { type: 'wait' });
    const resultB = processTurn(stateB, { type: 'wait' });
    const curseA = resultA.events.find((e) => e.type === 'equipment_cursed');
    const curseB = resultB.events.find((e) => e.type === 'equipment_cursed');
    expect(curseA).toEqual(curseB);
  });
});

// --- curse_trap ---

function trapPlayerState(trap: TrapTile, overrides: { weapon?: boolean; weaponEquipped?: boolean } = {}): GameState {
  const state: GameState = {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 5 }, 30, 10),
    enemies: [createInitialEnemy('bok', { x: 15, y: 5 }, 1000, 0, 0, 0)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    otencoState: 'sealed',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 199, y: 199 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { ...createEmptyInventory(), sword: overrides.weapon === false ? 0 : 1 },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: overrides.weaponEquipped ? 'sword' : null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    traps: [trap],
  };
  normalizeEquipmentInstances(state);
  if (overrides.weaponEquipped) {
    const weaponInst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword');
    if (weaponInst) state.equippedWeaponInstanceId = weaponInst.instanceId;
  }
  return state;
}

function curseTrap(pos: Vec2, id = 0): TrapTile {
  return { id, pos, revealed: false, triggered: false, trapType: 'curse_trap' };
}

describe('Phase 24.4e1: curse_trap', () => {
  it('with no eligible equipment, triggers with a no-op message and no equipment_cursed event', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: false });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.traps?.[0].triggered).toBe(true);
    expect(result.events.some((e) => e.type === 'equipment_cursed')).toBe(false);
    const trapResult = result.events.find((e) => e.type === 'curse_trap_result');
    expect(trapResult).toMatchObject({ outcome: 'no_target' });
    expect(formatEvent(trapResult!)).toBe('何も起こらなかった。');
  });

  it('with exactly one eligible unequipped instance, curses it without revealing it (no true-name leak)', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: true, weaponEquipped: false });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    const cursedEvent = result.events.find((e) => e.type === 'equipment_cursed');
    expect(cursedEvent).toMatchObject({ source: 'curse_trap', equipped: false, revealed: false });
    const inst = getHeldEquipmentInstances(state)[0];
    expect(inst.cursed).toBe(true);
    expect(inst.curseRevealed).toBe(false);
    const trapResult = result.events.find((e) => e.type === 'curse_trap_result');
    expect(trapResult).toMatchObject({ outcome: 'unequipped' });
    // No displayName, no itemId, no instanceId anywhere in the
    // player-facing event — only the safe generic message.
    expect((trapResult as { displayName?: string }).displayName).toBeUndefined();
    expect(formatEvent(trapResult!)).toBe('持ち物に不吉な気配が宿った。');
  });

  it('with the eligible instance currently equipped, curses it and reveals it immediately with its displayed name', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: true, weaponEquipped: true });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    const cursedEvent = result.events.find((e) => e.type === 'equipment_cursed');
    expect(cursedEvent).toMatchObject({ source: 'curse_trap', equipped: true, revealed: true });
    const inst = getHeldEquipmentInstances(state)[0];
    expect(inst.cursed).toBe(true);
    expect(inst.curseRevealed).toBe(true);
    const trapResult = result.events.find((e) => e.type === 'curse_trap_result');
    expect(trapResult).toMatchObject({ outcome: 'equipped' });
    expect(formatEvent(trapResult!)).toContain('呪われている');
  });

  it('does not change inventory count, instance identity, or refineLevel', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: true, weaponEquipped: true });
    const before = getHeldEquipmentInstances(state)[0];
    const beforeId = before.instanceId;
    const beforeRefine = before.refineLevel;
    const beforeCount = state.inventory.sword;
    processTurn(state, { type: 'move', direction: 'E' });
    const after = getHeldEquipmentInstances(state)[0];
    expect(after.instanceId).toBe(beforeId);
    expect(after.refineLevel).toBe(beforeRefine);
    expect(state.inventory.sword).toBe(beforeCount);
  });

  it('one-shot: a re-step onto an already-triggered curse_trap does not fire again', () => {
    const trap = curseTrap({ x: 4, y: 5 });
    const state = trapPlayerState(trap, { weapon: true, weaponEquipped: true });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    const secondResult = processTurn(state, { type: 'move', direction: 'W' });
    expect(secondResult.events.some((e) => e.type === 'curse_trap_result')).toBe(false);
  });

  it('does not consume or perturb combatRngState (no combat involved)', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: true, weaponEquipped: true });
    const before = state.combatRngState;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.combatRngState).toBe(before);
  });

  it('never advances an extra turn for the trap effect itself', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: true, weaponEquipped: true });
    const turnBefore = state.turn;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.turn).toBe(turnBefore + 1);
  });
});

describe('Phase 24.4e1: trap type generation weights', () => {
  it('TRAP_TYPE_WEIGHTS sums to 100 and matches the provisional 45/45/10 split', () => {
    expect(TRAP_TYPE_WEIGHTS.slow_trap + TRAP_TYPE_WEIGHTS.poison_trap + TRAP_TYPE_WEIGHTS.curse_trap).toBe(100);
    expect(TRAP_TYPE_WEIGHTS).toEqual({ slow_trap: 45, poison_trap: 45, curse_trap: 10 });
  });

  it('selectTrapType respects the weighted boundaries deterministically', () => {
    expect(selectTrapType(() => 0)).toBe('slow_trap');
    expect(selectTrapType(() => 0.44)).toBe('slow_trap');
    expect(selectTrapType(() => 0.45)).toBe('poison_trap');
    expect(selectTrapType(() => 0.89)).toBe('poison_trap');
    expect(selectTrapType(() => 0.9)).toBe('curse_trap');
    expect(selectTrapType(() => 0.999)).toBe('curse_trap');
  });
});

describe('Phase 24.4e1: shared eligibility helper', () => {
  it('excludes an already-cursed instance', () => {
    const state = mummyState({ weapon: true });
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    expect(getActiveCurseEligibleInstances(state)).not.toContainEqual(inst);
  });

  it('excludes solar_gun even though its rank is C', () => {
    const state = mummyState({ weapon: false });
    state.inventory.solar_gun = 1;
    state.equippedWeaponId = 'solar_gun';
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'solar_gun')!;
    expect(getActiveCurseEligibleInstances(state)).not.toContainEqual(inst);
  });

  it('excludes black_armor (rank R, filtered by rank alone)', () => {
    const state = mummyState({ weapon: false });
    state.inventory.black_armor = 1;
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'black_armor')!;
    expect(getActiveCurseEligibleInstances(state)).not.toContainEqual(inst);
  });
});

describe('Phase 24.4e1: integration with existing curse-lock and Temperance', () => {
  it('a mummy-cursed equipped weapon is blocked from unequip by the existing curse-lock rule', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    processTurn(state, { type: 'wait' });
    expect(isEquippedWeaponCurseLocked(state)).toBe(true);
  });

  it('Temperance can decurse a mummy-applied curse on the same instance', () => {
    const state = mummyState({ turn: TURN_CHANCE_SUCCEEDS, combatRngState: CRS_HIT });
    processTurn(state, { type: 'wait' });
    const inst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword')!;
    expect(inst.cursed).toBe(true);
    const transaction = resolveCardTargetEffect(state, 'temperance', { kind: 'equipment_instance', instanceId: inst.instanceId });
    expect(transaction.status).toBe('success');
    if (transaction.status !== 'success') throw new Error('unreachable');
    const decursed = getHeldEquipmentInstances(transaction.nextState).find((i) => i.instanceId === inst.instanceId)!;
    expect(decursed.cursed).toBe(false);
    expect(decursed.instanceId).toBe(inst.instanceId);
  });

  it('Temperance can decurse a curse_trap-applied curse on an equipped instance', () => {
    const state = trapPlayerState(curseTrap({ x: 3, y: 5 }), { weapon: true, weaponEquipped: true });
    processTurn(state, { type: 'move', direction: 'E' });
    const inst = getHeldEquipmentInstances(state)[0];
    expect(inst.cursed).toBe(true);
    const transaction = resolveCardTargetEffect(state, 'temperance', { kind: 'equipment_instance', instanceId: inst.instanceId });
    expect(transaction.status).toBe('success');
    if (transaction.status !== 'success') throw new Error('unreachable');
    const decursed = getHeldEquipmentInstances(transaction.nextState).find((i) => i.instanceId === inst.instanceId)!;
    expect(decursed.cursed).toBe(false);
  });
});
