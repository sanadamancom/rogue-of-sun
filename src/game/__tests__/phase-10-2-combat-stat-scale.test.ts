import { describe, expect, it } from 'vitest';
import { computeAttackDamage, computeIncomingDamage } from '../combat';
import { ARMOR_DEFINITIONS } from '../armor-def';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { createEmptyInventory } from '../item-def';
import { WEAPON_DEFINITIONS } from '../weapon-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn, REGEN_TURNS_PER_HP } from '../turn';
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
    player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0),
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0)],
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
    ...overrides,
  };
}

function faceEast(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

describe('stat model (Phase 10.2)', () => {
  it('the player has max_hp, attack, and defense', () => {
    const state = createInitialState(1);
    expect(typeof state.player.maxHp).toBe('number');
    expect(typeof state.player.attack).toBe('number');
    expect(typeof state.player.defense).toBe('number');
  });

  it('every enemy definition has hp, attack, and defense', () => {
    for (const type of Object.keys(ENEMY_DEFINITIONS) as (keyof typeof ENEMY_DEFINITIONS)[]) {
      const def = ENEMY_DEFINITIONS[type];
      expect(typeof def.hp).toBe('number');
      expect(typeof def.attack).toBe('number');
      expect(typeof def.defense).toBe('number');
    }
  });

  it('every weapon definition has an attack (bonus) value', () => {
    for (const id of Object.keys(WEAPON_DEFINITIONS) as (keyof typeof WEAPON_DEFINITIONS)[]) {
      expect(typeof WEAPON_DEFINITIONS[id].attackPower).toBe('number');
    }
  });

  it('current HP and max HP are separate fields', () => {
    const state = createInitialState(1);
    state.player.hp = 5;
    expect(state.player.hp).not.toBe(state.player.maxHp);
    expect(state.player.maxHp).toBe(30);
  });

  it('defense is not uniformly 0 across every enemy (golem and kraken carry the roster\'s only nonzero defense)', () => {
    const values = Object.values(ENEMY_DEFINITIONS).map((d) => d.defense);
    expect(values.some((v) => v > 0)).toBe(true);
    expect(ENEMY_DEFINITIONS.golem.defense).toBe(1);
    expect(ENEMY_DEFINITIONS.kraken.defense).toBe(1);
  });
});

describe('damage core (combat.ts, Phase 10.2)', () => {
  it('computeAttackDamage adds base attack and weapon bonus, subtracts defense', () => {
    expect(computeAttackDamage(10, 10, 0)).toBe(20);
    expect(computeAttackDamage(10, 0, 0)).toBe(10);
  });

  it('computeAttackDamage subtracts defender defense', () => {
    expect(computeAttackDamage(10, 10, 5)).toBe(15);
  });

  it('computeAttackDamage floors at 1 on a connecting hit, even against heavy defense', () => {
    expect(computeAttackDamage(10, 0, 100)).toBe(1);
  });

  it('computeIncomingDamage subtracts defense and floors at 0 (not 1) — preserving the pre-existing complete-negation design', () => {
    expect(computeIncomingDamage(10, 0)).toBe(10);
    expect(computeIncomingDamage(10, 5)).toBe(5);
    expect(computeIncomingDamage(10, 10)).toBe(0);
    expect(computeIncomingDamage(10, 100)).toBe(0);
  });

  it('is a pure function: repeated calls with the same input give the same output, and never touch any state', () => {
    const a = computeAttackDamage(10, 10, 3);
    const b = computeAttackDamage(10, 10, 3);
    expect(a).toBe(b);
    const c = computeIncomingDamage(20, 5);
    const d = computeIncomingDamage(20, 5);
    expect(c).toBe(d);
  });
});

describe('weapon damage uses the shared calculation (Phase 10.2)', () => {
  it('bare hands: damage equals player.attack alone (weapon bonus 0)', () => {
    const state = freshState();
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(10);
  });

  it('sword: damage equals player.attack + sword bonus (10)', () => {
    const state = freshState({ equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(20);
  });

  it('spear: damage equals player.attack + spear bonus (0)', () => {
    const state = freshState({
      equippedWeaponId: 'spear',
      inventory: { ...createEmptyInventory(), spear: 1 },
      enemies: [createInitialEnemy('bok', { x: 4, y: 1 }, 1000, 10, 0, 0, 0)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(10);
  });

  it('hammer: damage equals player.attack + hammer bonus (20)', () => {
    const state = freshState({ equippedWeaponId: 'hammer', inventory: { ...createEmptyInventory(), hammer: 1 } });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(30);
  });

  it('solar gun: still consumes its own SOL cost and deals player.attack + 0 bonus, unaffected by an active sol selection', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      solUnlocked: true,
      selectedEnchantment: 'sol',
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4); // solar gun's own solarCost, unrelated to sol enchantment
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(10); // no melee sol bonus applied
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('enemy defense actually reduces the player\'s final damage', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('golem', { x: 3, y: 1 }, 1000, 30, 0, 0, ENEMY_DEFINITIONS.golem.defense)],
    });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    // player.attack 10 + sword bonus 10 - golem defense 1 = 19
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(19);
  });
});

describe('representative hit counts at real production values (Phase 10.2)', () => {
  function hitsToDefeat(weaponBonus: number, defenderHp: number, defenderDefense: number): number {
    const perHit = computeAttackDamage(10, weaponBonus, defenderDefense);
    return Math.ceil(defenderHp / perHit);
  }

  it('bok (no defense): sword kills in 2 hits, matching the pre-10.2 ratio', () => {
    expect(hitsToDefeat(WEAPON_DEFINITIONS.sword.attackPower, ENEMY_DEFINITIONS.bok.hp, ENEMY_DEFINITIONS.bok.defense)).toBe(2);
  });

  it('mummy (no defense): hammer kills in 2 hits, matching the pre-10.2 ratio', () => {
    expect(
      hitsToDefeat(WEAPON_DEFINITIONS.hammer.attackPower, ENEMY_DEFINITIONS.mummy.hp, ENEMY_DEFINITIONS.mummy.defense),
    ).toBe(2);
  });

  it('golem (defense 1): sword now takes 3 hits — the one documented, accepted deviation from the pre-10.2 ratio (was 2)', () => {
    expect(
      hitsToDefeat(WEAPON_DEFINITIONS.sword.attackPower, ENEMY_DEFINITIONS.golem.hp, ENEMY_DEFINITIONS.golem.defense),
    ).toBe(3);
  });

  it('axe (no defense): sword kills in 3 hits, matching the pre-10.2 ratio', () => {
    expect(hitsToDefeat(WEAPON_DEFINITIONS.sword.attackPower, ENEMY_DEFINITIONS.axe.hp, ENEMY_DEFINITIONS.axe.defense)).toBe(3);
  });

  function hitsToDefeatPlayer(enemyAttack: number, playerDefense: number, playerHp: number): number | 'infinite' {
    const perHit = computeIncomingDamage(enemyAttack, playerDefense);
    if (perHit === 0) return 'infinite';
    return Math.ceil(playerHp / perHit);
  }

  it('armored player takes exactly 0 damage from bok/cockatrice/spider/bat, matching the pre-10.2 complete-negation case', () => {
    const armoredDefense = ARMOR_DEFINITIONS.armor.armorValue; // no base player defense source yet
    for (const type of ['bok', 'cockatrice', 'spider', 'bat'] as const) {
      expect(hitsToDefeatPlayer(ENEMY_DEFINITIONS[type].attack, armoredDefense, 30)).toBe('infinite');
    }
  });

  it('armored player still takes 3 hits from golem, matching the pre-10.2 ratio', () => {
    const armoredDefense = ARMOR_DEFINITIONS.armor.armorValue;
    expect(hitsToDefeatPlayer(ENEMY_DEFINITIONS.golem.attack, armoredDefense, 30)).toBe(2);
  });
});

describe('HP and recovery at the new scale (Phase 10.2)', () => {
  it('player max HP is 30 on a brand new run', () => {
    const state = createInitialState(1);
    expect(state.player.maxHp).toBe(30);
  });

  it('enemy max HP values are scaled 10x from their pre-10.2 values', () => {
    expect(ENEMY_DEFINITIONS.bok.hp).toBe(30);
    expect(ENEMY_DEFINITIONS.mummy.hp).toBe(50);
    expect(ENEMY_DEFINITIONS.axe.hp).toBe(60);
  });

  it('apple heals 20 HP, clamped to maxHp', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 1 },
      enemies: [],
    });
    state.player.hp = 5;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(state.player.hp).toBe(25);
  });

  it('healing never exceeds max HP', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 1 }, enemies: [] });
    state.player.hp = 25;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(state.player.hp).toBe(30); // clamped, not 45
  });

  it('natural regen heals 10 HP after REGEN_TURNS_PER_HP consumed turns', () => {
    const state = freshState({ enemies: [] });
    state.player.hp = 5;
    let result;
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      result = processTurn(state, { type: 'wait' });
    }
    expect(result!.playerRegenerated).toBe(true);
    expect(state.player.hp).toBe(15);
  });

  it('a brand new run re-initializes at the new max HP', () => {
    let state = createInitialState(7);
    state.player.hp = 1;
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    state = advanceToNextFloor(state);
    // HP carries over (not healed by a floor transition), but maxHp stays the new-scale value.
    expect(state.player.maxHp).toBe(30);
  });
});

describe('sol enchantment at the new scale (Phase 10.2)', () => {
  function solState(overrides?: Partial<GameState>): GameState {
    return freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      ...overrides,
    });
  }

  it('a sol-eligible hit consumes exactly 1 SOL', () => {
    const state = solState();
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  it('a sol-eligible hit adds exactly 10 bonus damage on top of the base formula', () => {
    const state = solState();
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    // player.attack 10 + sword bonus 10 - defense 0 = 20, + sol bonus 10 = 30
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(30);
  });

  it('a whiff still consumes the turn but never consumes SOL', () => {
    const state = solState({ enemies: [] });
    processTurn(state, { type: 'face', direction: 'N' });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'action' });
    expect(state.turn).toBe(turnBefore + 1);
    expect(result.events.some((e) => e.type === 'player_whiff')).toBe(true);
    expect(state.solarEnergy).toBe(5);
  });

  it('an out-of-reach attack (spear whiff at 2 tiles with an obstruction) never consumes SOL', () => {
    const state = solState({
      equippedWeaponId: 'spear',
      inventory: { ...createEmptyInventory(), spear: 1 },
      enemies: [], // nothing in range at all
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
  });

  it('SOL 0: deals normal (unbonused) damage', () => {
    const state = solState({ solarEnergy: 0 });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(20); // no +10 bonus
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('SOL 0: selection is preserved (still sol)', () => {
    const state = solState({ solarEnergy: 0 });
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.selectedEnchantment).toBe('sol');
  });

  it('SOL replenished: reactivates without reselecting', () => {
    const state = solState({ solarEnergy: 0 });
    faceEast(state);
    processTurn(state, { type: 'action' });
    state.solarEnergy = 5;
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(true);
    expect(state.solarEnergy).toBe(4);
  });

  it('never activates for bare hands', () => {
    const state = solState({ equippedWeaponId: null, inventory: createEmptyInventory() });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('never activates for the solar gun', () => {
    const state = solState({ equippedWeaponId: 'solar_gun', inventory: { ...createEmptyInventory(), solar_gun: 1 } });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    // Solar gun still spends its own 1 SOL, but never the enchantment's.
    expect(state.solarEnergy).toBe(4);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('never consumes more than 1 SOL for a single hit', () => {
    const state = solState();
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  it('does not push a duplicate activation event when the hit defeats the enemy', () => {
    const state = solState({ enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0)] });
    faceEast(state);
    const result = processTurn(state, { type: 'action' });
    const activationEvents = result.events.filter((e) => e.type === 'sol_enchantment_used');
    expect(activationEvents.length).toBe(1);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });
});

describe('existing weapon behavior regression at the new scale (Phase 10.2)', () => {
  it('sword still only reaches adjacent tiles (reach 1, unchanged)', () => {
    expect(WEAPON_DEFINITIONS.sword.reach).toBe(1);
  });

  it('spear still reaches 2 tiles (unchanged)', () => {
    expect(WEAPON_DEFINITIONS.spear.reach).toBe(2);
  });

  it('hammer still knocks back (knockbackDistance unchanged at 1)', () => {
    expect(WEAPON_DEFINITIONS.hammer.knockbackDistance).toBe(1);
  });

  it('hammer still has recoil (hasRecoil unchanged)', () => {
    expect(WEAPON_DEFINITIONS.hammer.hasRecoil).toBe(true);
  });

  it('sol activation does not clear hammerRecovery', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
      solUnlocked: true,
      selectedEnchantment: 'sol',
      solarEnergy: 5,
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });
});

describe('world determinism unaffected by the stat/scale redesign (Phase 10.2)', () => {
  it('the same seed produces the same map, enemy, and item placement', () => {
    const a = createInitialState(2024);
    const b = createInitialState(2024);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('the sol enchantment ground item placement is unaffected', () => {
    const a = createInitialState(2024);
    const b = createInitialState(2024);
    const solA = a.groundItems.find((i) => i.itemId === 'sol_enchantment');
    const solB = b.groundItems.find((i) => i.itemId === 'sol_enchantment');
    expect(solA).toEqual(solB);
  });

  it('the sunlight layer is unaffected', () => {
    const a = createInitialState(2024);
    const b = createInitialState(2024);
    expect(a.sunlight).toEqual(b.sunlight);
  });
});

describe('UI-facing values are representable at the new scale (Phase 10.2)', () => {
  it('player HP and max HP are both representable as 2-3 digit numbers', () => {
    const state = createInitialState(1);
    expect(state.player.maxHp).toBeGreaterThanOrEqual(10);
    expect(state.player.maxHp).toBeLessThan(1000);
  });

  it('enemy HP values are all representable as 2-3 digit numbers', () => {
    for (const def of Object.values(ENEMY_DEFINITIONS)) {
      expect(def.hp).toBeGreaterThanOrEqual(10);
      expect(def.hp).toBeLessThan(1000);
    }
  });

  it('the ENCHANT state fields still exist and behave as before (locked/none/sol)', () => {
    const state = createInitialState(1);
    expect(state.solUnlocked).toBe(false);
    expect(state.selectedEnchantment).toBe('none');
  });
});
