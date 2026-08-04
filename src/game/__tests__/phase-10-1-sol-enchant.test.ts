import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import { createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyType, GameMap, GameState, Tile } from '../types';

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
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    // Phase 10.2 combat stat/scale redesign raised weapon/sol damage
    // substantially (e.g. sword+sol now deals 21+10=31 against this
    // fixture's player.attack of 1); a large default HP keeps every
    // activation test below from accidentally defeating the enemy
    // (which would suppress tryKnockback/further exchanges) unless a
    // test deliberately wants a kill and overrides hp itself.
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
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
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

/** Player facing east (S default -> face E first) with an adjacent 'bok' target at (3,1). */
function faceEastAtEnemy(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

describe('sol enchantment state (Phase 10.1)', () => {
  it('starts locked and unselected on a brand new state', () => {
    const state = freshState();
    expect(state.solUnlocked).toBe(false);
    expect(state.selectedEnchantment).toBe('none');
  });

  it('picking up the sol_enchantment ground item sets solUnlocked true', () => {
    const state = freshState({
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sol_enchantment', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.solUnlocked).toBe(true);
    expect(result.events.some((e) => e.type === 'sol_enchantment_acquired')).toBe(true);
  });

  it('does not auto-select sol immediately after pickup', () => {
    const state = freshState({
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sol_enchantment', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.selectedEnchantment).toBe('none');
  });

  it('never adds sol_enchantment to the stacked inventory', () => {
    const state = freshState({
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sol_enchantment', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.sol_enchantment).toBeUndefined();
  });

  it('cannot select sol while locked (toggle is a no-op)', () => {
    const state = freshState({ solUnlocked: false });
    const result = processTurn(state, { type: 'toggle_enchantment' });
    expect(result.consumed).toBe(false);
    expect(state.selectedEnchantment).toBe('none');
    expect(result.events.some((e) => e.type === 'enchantment_toggled')).toBe(false);
  });

  it('toggles none<->sol once unlocked', () => {
    const state = freshState({ solUnlocked: true, unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false } });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('sol');
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('none');
  });

  it('toggle does not consume a turn or move the enemy', () => {
    const state = freshState({ solUnlocked: true, enemies: [createInitialEnemy('bok', { x: 7, y: 6 }, 10, 1)] });
    const enemyBefore = { ...state.enemies[0].pos };
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'toggle_enchantment' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.enemies[0].pos).toEqual(enemyBefore);
  });

  it('preserves the selected enchantment across a weapon switch', () => {
    const state = freshState({
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      inventory: { ...createEmptyInventory(), sword: 1, spear: 1 },
      equippedWeaponId: 'sword',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(state.selectedEnchantment).toBe('sol');
  });
});

describe('sol enchantment activation (Phase 10.1)', () => {
  function attackingState(weaponId: 'sword' | 'spear' | 'hammer', solarEnergy = 5, enemyType: EnemyType = 'bok'): GameState {
    return freshState({
      equippedWeaponId: weaponId,
      inventory: { ...createEmptyInventory(), [weaponId]: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy,
      // Phase 14.4 enemy affinities: bok is sol-weak, so tests that
      // assert a plain neutral-affinity sol bonus (10) pass an
      // explicitly-neutral enemy type instead of relying on the
      // (now weak) default.
      enemies: [createInitialEnemy(enemyType, { x: 3, y: 1 }, 1000, 1)],
    });
  }

  it('sword hit consumes 1 SOL and adds 10 bonus damage (Phase 15.1)', () => {
    const state = attackingState('sword', 5, 'spider');
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(true);
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    // fixture player.attack 1 + sword bonus 2 - defense 0 = 3, + sol bonus 10 = 13
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(13);
  });

  it('spear hit consumes 1 SOL and adds 10 bonus damage (Phase 10.2)', () => {
    const state = freshState({
      equippedWeaponId: 'spear',
      inventory: { ...createEmptyInventory(), spear: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      enemies: [createInitialEnemy('spider', { x: 4, y: 1 }, 1000, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    // fixture player.attack 1 + spear bonus 1 - defense 0 = 2, + sol bonus 10 = 12
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(12);
  });

  it('hammer hit consumes 1 SOL and adds 10 bonus damage (Phase 15.1)', () => {
    const state = attackingState('hammer', 5, 'spider');
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    // fixture player.attack 1 + hammer bonus 3 - defense 0 = 4, + sol bonus 10 = 14
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(14);
  });

  it('goes from SOL 1 to SOL 0 on a single activation', () => {
    const state = attackingState('sword', 1);
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(0);
  });

  it('deals normal (unbonused) damage when SOL is 0', () => {
    const state = attackingState('sword', 0);
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(0);
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(3); // no bonus (fixture player.attack 1 + sword bonus 2)
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('keeps sol selected even when SOL is 0', () => {
    const state = attackingState('sword', 0);
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.selectedEnchantment).toBe('sol');
  });

  it('reactivates automatically once SOL is replenished, without reselecting', () => {
    const state = attackingState('sword', 0);
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' }); // SOL 0 -> normal hit
    state.solarEnergy = 5; // simulate recovery (sun fruit / charge)
    state.enemies[0].hp = 10;
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(true);
    expect(state.solarEnergy).toBe(4);
  });

  it('does not consume SOL while none is selected', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'none',
      combatRngState: 304,
      solarEnergy: 5,
    });
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
  });

  it('does not consume SOL on a whiff', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      enemies: [], // nothing to hit
    });
    processTurn(state, { type: 'face', direction: 'N' });
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
    expect(result.events.some((e) => e.type === 'player_whiff')).toBe(true);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('does not activate for bare-handed hits', () => {
    const state = freshState({
      equippedWeaponId: null,
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('does not apply the melee bonus to the solar gun', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    // Solar gun still spends its own 1 SOL via its existing mechanism,
    // but never the sol-enchantment bonus/event on top of that.
    expect(state.solarEnergy).toBe(4);
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent && (attackEvent as { damage: number }).damage).toBe(2); // fixture player.attack 1 + solar_gun bonus 1, no sol enchant bonus
  });

  it('never consumes more than 1 SOL for a single hit', () => {
    const state = attackingState('sword', 5);
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  it('does not push a duplicate activation event when the hit defeats the enemy', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 1)], // dies to the bonused hit
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const activationEvents = result.events.filter((e) => e.type === 'sol_enchantment_used');
    expect(activationEvents.length).toBe(1);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });
});

describe('existing weapon behavior preserved under sol enchantment (Phase 10.1)', () => {
  it('hammer knockback still occurs alongside a sol-bonused hit', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    // Checked via the event, not final position, since the knocked-back
    // enemy immediately takes its own chase-toward-player turn afterward
    // within this same processTurn call, which can bring it back adjacent.
    expect(result.events.some((e) => e.type === 'enemy_knocked_back')).toBe(true);
    expect(state.hammerRecovery).toBe(true);
  });

  it('solar gun SOL consumption and attack are unaffected by an unrelated sol selection', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
      solUnlocked: false,
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'none',
      combatRngState: 304,
      solarEnergy: 5,
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
    expect(result.playerAttacked).toBe(true);
  });
});

describe('sol enchantment world placement (Phase 10.1)', () => {
  it('places exactly one sol_enchantment ground item on floor 1, on a reachable floor tile not shared with start/exit/enemies/other items', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createInitialState(seed);
      const solItems = state.groundItems.filter((item) => item.itemId === 'sol_enchantment');
      expect(solItems.length).toBe(1);
      const pos = solItems[0].pos;
      expect(pos).not.toEqual(state.player.pos);
      expect(pos).not.toEqual(state.exit);
      for (const enemy of state.enemies) {
        expect(pos).not.toEqual(enemy.pos);
      }
      const otherItemPositions = state.groundItems
        .filter((item) => item.itemId !== 'sol_enchantment')
        .map((item) => item.pos);
      for (const otherPos of otherItemPositions) {
        expect(pos).not.toEqual(otherPos);
      }
      expect(state.map.terrain[pos.y][pos.x]).toBe('floor');
    }
  });

  it('is deterministic: the same seed places sol_enchantment at the same position twice', () => {
    const a = createInitialState(42);
    const b = createInitialState(42);
    const posA = a.groundItems.find((item) => item.itemId === 'sol_enchantment')?.pos;
    const posB = b.groundItems.find((item) => item.itemId === 'sol_enchantment')?.pos;
    expect(posA).toEqual(posB);
  });
});
