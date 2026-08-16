import { describe, expect, it } from 'vitest';
import { getGroundItemPoolForFloor, createEmptyInventory} from '../item-def';
import { createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Room, Tile, TrapTile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

const TEST_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  const rooms: Room[] = [{ x: 1, y: 1, width: 18, height: 5 }];
  return { width, height, terrain, rooms, exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
    enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 99, y: 99 },
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

describe('clairvoyance fruit (Phase 18.2)', () => {
  it('is available in the floor 1 ground item pool', () => {
    expect(getGroundItemPoolForFloor(1)).toContain('clairvoyance_fruit');
    expect(getGroundItemPoolForFloor(2)).toContain('clairvoyance_fruit');
    expect(getGroundItemPoolForFloor(3)).toContain('clairvoyance_fruit');
  });

  it('using it reveals every hidden trap on the floor', () => {
    const trapA: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const trapB: TrapTile = { id: 1, pos: { x: 10, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      enemies: [],
      traps: [trapA, trapB],
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(state.traps?.[0].revealed).toBe(true);
    expect(state.traps?.[1].revealed).toBe(true);
  });

  it('does not trigger any trap it reveals', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      enemies: [],
      traps: [trap],
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(state.traps?.[0].revealed).toBe(true);
    expect(state.traps?.[0].triggered).toBe(false);
  });

  it('discovers both slow_trap and poison_trap in one use', () => {
    const trapA: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const trapB: TrapTile = { id: 1, pos: { x: 10, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      enemies: [],
      traps: [trapA, trapB],
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    const revealedEvents = result.events.filter((e) => e.type === 'trap_revealed');
    expect(revealedEvents).toHaveLength(2);
  });

  it('does not change an already-revealed trap', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      enemies: [],
      traps: [trap],
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(state.traps?.[0].revealed).toBe(true);
    expect(result.events.some((e) => e.type === 'trap_revealed')).toBe(false);
  });

  it('does not change an already-triggered trap', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: true, trapType: 'poison_trap' };
    const state = freshState({
      enemies: [],
      traps: [trap],
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const before = { ...state.traps![0] };
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(state.traps?.[0]).toEqual(before);
  });

  it('never affects another floor\'s trap state', () => {
    const state = createInitialState(7777);
    state.inventory.clairvoyance_fruit = 1;
    const firstFloorTraps = (state.traps ?? []).map((t) => t.id);
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    // Every trap revealed belongs to the current floor's own array; the
    // ids present are unchanged (clairvoyance never adds/removes traps
    // or reaches into any other floor's state, which doesn't even exist
    // yet at this point).
    expect((state.traps ?? []).map((t) => t.id)).toEqual(firstFloorTraps);
  });

  it('using it with zero traps on the floor still succeeds, consumes the item, and consumes a turn', () => {
    const state = freshState({
      enemies: [],
      traps: [],
      turn: 0,
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.clairvoyance_fruit).toBe(0);
    expect(state.turn).toBe(1);
  });

  it('using it with traps present but none hidden (all already revealed) still succeeds, consumes the item, and consumes a turn', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      enemies: [],
      traps: [trap],
      turn: 0,
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.clairvoyance_fruit).toBe(0);
    expect(state.turn).toBe(1);
  });

  it('follows the existing item-use turn order: enemy still acts on the same turn as any other item use', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [],
      inventory: { ...freshState().inventory, clairvoyance_fruit: 1, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const enemyPosBefore = { ...state.enemies[0].pos };
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    // The bok chases the player every turn it acts; a moved position
    // confirms the standard post-item-use enemy resolution phase ran,
    // exactly as it does for apple/banana/etc.
    expect(state.enemies[0].pos).not.toEqual(enemyPosBefore);
  });
});
