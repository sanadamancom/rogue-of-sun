import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyType, GameMap, GameState, Tile } from '../types';
import { createEmptyInventory } from '../item-def';
import { DEFAULT_RUN_CONFIG } from '../floor';

/**
 * Phase 16.1 early-resource-and-combat-pressure rebalance: before this
 * phase, every living enemy on a floor moved toward the player every
 * single turn from the moment it spawned, regardless of distance — see
 * turn.ts's `tryChaseStep`/`trySpiderChaseStep`/etc, none of which had
 * any distance check. Once Phase 16 enlarged the map to 48x36 with more
 * rooms, this meant a full floor's enemies (6-8 of them) could all
 * converge on the player at once well before the player had even seen
 * most of them. `resolveOneEnemy` now gates every non-adjacent,
 * non-stationary enemy behind AGGRO_RANGE (Chebyshev distance 8): an
 * enemy farther than that neither moves, attacks, nor runs any of its
 * own per-species bookkeeping until the player is within range.
 */

const WIDE_LAYOUT: string[] = Array.from({ length: 6 }, (_, y) =>
  y === 0 || y === 5 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`,
);

function wideTestMap(): GameMap {
  const height = WIDE_LAYOUT.length;
  const width = WIDE_LAYOUT[0].length;
  const terrain: Tile[][] = WIDE_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function baseState(enemyX: number): GameState {
  return {
    map: wideTestMap(),
    player: createInitialActor({ x: 2, y: 2 }, 15, 2, 0, 90, 0),
    enemies: [createInitialEnemy('bok' as EnemyType, { x: enemyX, y: 2 }, 6, 3, 0, 0, 0, 90, 0)],
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
    inventory: { ...createEmptyInventory(), apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
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
  };
}

describe('Phase 16.1: enemy aggro range', () => {
  it('an enemy beyond AGGRO_RANGE (Chebyshev 8) does not move toward the player', () => {
    const state = baseState(2 + 9); // distance 9, just outside range
    const before = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].pos).toEqual(before);
  });

  it('an enemy at exactly AGGRO_RANGE (8) does chase', () => {
    const state = baseState(2 + 8); // distance 8, exactly at the boundary
    const before = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].pos).not.toEqual(before);
  });

  it('an enemy well within range chases normally, same as before this phase', () => {
    const state = baseState(2 + 4); // distance 4
    const before = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].pos).not.toEqual(before);
  });

  it('an already-adjacent enemy still attacks regardless of the range check', () => {
    const state = baseState(3); // distance 1, adjacent
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed')).toBe(true);
  });

  it('an out-of-range enemy starts chasing once the player closes the distance', () => {
    const state = baseState(2 + 9); // distance 9, out of range
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].pos.x).toBe(11); // unmoved
    // Player walks toward the enemy until it's within range, then the
    // enemy should start closing the distance back on its own turns.
    for (let i = 0; i < 2; i++) processTurn(state, { type: 'move', direction: 'E' }); // player 2 -> 4, distance now 7
    const beforeChase = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].pos).not.toEqual(beforeChase);
  });
});
