import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import {
  ABILITY_RANK_CAP,
  BODY_MAX_HP_PER_RANK,
  MIND_MAX_SOL_PER_RANK,
  POWER_DAMAGE_PER_RANK,
  allocateAbilityPoint,
  getAbilityValue,
  getPowerDamageBonus,
} from '../ability';
import { GameEvent } from '../events';
import { GameMap, GameState, Tile, WeaponId } from '../types';

const TEST_LAYOUT: string[] = [
  '####################',
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
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(unspentAbilityPoints = 0): GameState {
  const playerPos = { x: 10, y: 4 };
  const enemyPos = { x: 9, y: 4 };
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 30, 10),
    enemies: [createInitialEnemy('bok', enemyPos, 1000, 1)],
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
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0 },
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
    unspentAbilityPoints,
  };
}

/** Allocates `n` ranks of `ability` in a row, granting exactly the points needed. */
function allocateRanks(state: GameState, ability: 'body' | 'mind' | 'power', n: number): void {
  state.unspentAbilityPoints = (state.unspentAbilityPoints ?? 0) + n;
  for (let i = 0; i < n; i++) {
    const result = allocateAbilityPoint(state, ability);
    if (!result.success) throw new Error(`allocation failed unexpectedly at rank ${i + 1}`);
  }
}

/** Attacks the single adjacent enemy via the facing 'action' and returns the resulting events. */
function attackAdjacentEnemy(state: GameState): GameEvent[] {
  state.player.facing = 'W';
  const result = processTurn(state, { type: 'action' });
  return result.events;
}

function playerAttackDamage(events: GameEvent[]): number {
  const attack = events.find((e) => e.type === 'player_attack');
  if (!attack || attack.type !== 'player_attack') throw new Error('no player_attack event found');
  return attack.damage;
}

describe('Phase 13.3a ability numeric effects', () => {
  describe('compatibility (rank0)', () => {
    it('rank0 has maxHp 30, maxSOL 5, and power bonus 0', () => {
      const state = freshState();
      expect(state.player.maxHp).toBe(30);
      expect(state.maxSolarEnergy).toBe(5);
      expect(getPowerDamageBonus(state)).toBe(0);
    });

    it('rank0 preserves existing per-weapon damage exactly (Phase 15.1 weapon bonuses)', () => {
      const cases: { weaponId: WeaponId | null; expectedDamage: number }[] = [
        { weaponId: null, expectedDamage: 10 },
        { weaponId: 'sword', expectedDamage: 12 },
        { weaponId: 'spear', expectedDamage: 11 },
        { weaponId: 'hammer', expectedDamage: 13 },
      ];
      for (const { weaponId, expectedDamage } of cases) {
        const state = freshState();
        state.equippedWeaponId = weaponId;
        const events = attackAdjacentEnemy(state);
        expect(playerAttackDamage(events)).toBe(expectedDamage);
      }
    });
  });

  describe('body', () => {
    it('maxHp for rank 0/1/3/5/10 matches 30 + 2*rank (Phase 15.3 rebalance)', () => {
      const expected: Record<number, number> = { 0: 30, 1: 32, 3: 36, 5: 40, 10: 50 };
      for (const [rank, maxHp] of Object.entries(expected)) {
        const state = freshState();
        allocateRanks(state, 'body', Number(rank));
        expect(state.player.maxHp).toBe(maxHp);
        expect(getAbilityValue(state, 'body')).toBe(Number(rank));
      }
    });

    it('a successful allocation increases maxHp and current HP by 4 each', () => {
      const state = freshState(1);
      const hpBefore = state.player.hp;
      const maxHpBefore = state.player.maxHp;
      allocateAbilityPoint(state, 'body');
      expect(state.player.maxHp).toBe(maxHpBefore + BODY_MAX_HP_PER_RANK);
      expect(state.player.hp).toBe(hpBefore + BODY_MAX_HP_PER_RANK);
    });

    it('while damaged, current HP still recovers by 2 (clamped to the new max) (Phase 15.3 rebalance)', () => {
      const state = freshState(1);
      state.player.hp = 5; // damaged, well below maxHp 30
      allocateAbilityPoint(state, 'body');
      expect(state.player.maxHp).toBe(32);
      expect(state.player.hp).toBe(7);
    });

    it('current HP never exceeds the updated max HP', () => {
      const state = freshState(1);
      state.player.hp = state.player.maxHp; // already full
      allocateAbilityPoint(state, 'body');
      expect(state.player.hp).toBe(state.player.maxHp);
      expect(state.player.hp).toBe(32);
    });

    it('rank 10 rejects further allocation and leaves points/HP unchanged', () => {
      const state = freshState(1);
      allocateRanks(state, 'body', ABILITY_RANK_CAP);
      const maxHpAtCap = state.player.maxHp;
      const hpAtCap = state.player.hp;
      state.unspentAbilityPoints = 1;
      const result = allocateAbilityPoint(state, 'body');
      expect(result.success).toBe(false);
      expect(state.player.maxHp).toBe(maxHpAtCap);
      expect(state.player.hp).toBe(hpAtCap);
      expect(state.unspentAbilityPoints).toBe(1);
      expect(getAbilityValue(state, 'body')).toBe(ABILITY_RANK_CAP);
    });
  });

  describe('mind', () => {
    it('maxSOL for rank 0/1/3/5/10 matches 5 + 2*rank (Phase 15.3 rebalance)', () => {
      const expected: Record<number, number> = { 0: 5, 1: 7, 3: 11, 5: 15, 10: 25 };
      for (const [rank, maxSol] of Object.entries(expected)) {
        const state = freshState();
        allocateRanks(state, 'mind', Number(rank));
        expect(state.maxSolarEnergy).toBe(maxSol);
        expect(getAbilityValue(state, 'mind')).toBe(Number(rank));
      }
    });

    it('a successful allocation increases maxSOL but never restores current SOL (Phase 15.3 rebalance)', () => {
      const state = freshState(1);
      const solBefore = state.solarEnergy;
      const maxSolBefore = state.maxSolarEnergy;
      allocateAbilityPoint(state, 'mind');
      expect(state.maxSolarEnergy).toBe(maxSolBefore + MIND_MAX_SOL_PER_RANK);
      expect(state.solarEnergy).toBe(solBefore);
    });

    it('while SOL is depleted, current SOL stays depleted after allocation (Phase 15.3 rebalance)', () => {
      const state = freshState(1);
      state.solarEnergy = 0;
      allocateAbilityPoint(state, 'mind');
      expect(state.maxSolarEnergy).toBe(7);
      expect(state.solarEnergy).toBe(0);
    });

    it('current SOL never exceeds the updated max SOL (Phase 15.3: no longer restored, so it stays below the new max)', () => {
      const state = freshState(1);
      state.solarEnergy = state.maxSolarEnergy; // already full (5)
      allocateAbilityPoint(state, 'mind');
      expect(state.maxSolarEnergy).toBe(7);
      expect(state.solarEnergy).toBe(5);
      expect(state.solarEnergy).toBeLessThanOrEqual(state.maxSolarEnergy);
    });

    it('rank 10 rejects further allocation and leaves points/SOL unchanged', () => {
      const state = freshState(1);
      allocateRanks(state, 'mind', ABILITY_RANK_CAP);
      const maxSolAtCap = state.maxSolarEnergy;
      const solAtCap = state.solarEnergy;
      state.unspentAbilityPoints = 1;
      const result = allocateAbilityPoint(state, 'mind');
      expect(result.success).toBe(false);
      expect(state.maxSolarEnergy).toBe(maxSolAtCap);
      expect(state.solarEnergy).toBe(solAtCap);
      expect(state.unspentAbilityPoints).toBe(1);
      expect(getAbilityValue(state, 'mind')).toBe(ABILITY_RANK_CAP);
    });
  });

  describe('power (strength)', () => {
    it('direct-attack bonus for rank 0/1/3/5/10 matches 1*rank (Phase 15.3 rebalance)', () => {
      const expected: Record<number, number> = { 0: 0, 1: 1, 3: 3, 5: 5, 10: 10 };
      for (const [rank, bonus] of Object.entries(expected)) {
        const state = freshState();
        allocateRanks(state, 'power', Number(rank));
        expect(getPowerDamageBonus(state)).toBe(bonus);
      }
    });

    it('applies once to unarmed, sword, spear, hammer, and the solar gun', () => {
      const weapons: (WeaponId | null)[] = [null, 'sword', 'spear', 'hammer', 'solar_gun'];
      for (const weaponId of weapons) {
        const state = freshState(2);
        allocateRanks(state, 'power', 2); // +4 bonus
        state.equippedWeaponId = weaponId;
        if (weaponId === 'solar_gun') {
          state.player.facing = 'W'; // ray toward the adjacent enemy
          const result = processTurn(state, { type: 'action' });
          expect(playerAttackDamage(result.events)).toBe(
            weaponBaseDamage(weaponId) + POWER_DAMAGE_PER_RANK * 2,
          );
        } else {
          const events = attackAdjacentEnemy(state);
          expect(playerAttackDamage(events)).toBe(weaponBaseDamage(weaponId) + POWER_DAMAGE_PER_RANK * 2);
        }
      }
    });

    it('does not apply to poison damage', () => {
      const state = freshState();
      allocateRanks(state, 'power', 5);
      state.activeEffects = [{ id: 'poison', strength: 3, remainingTurns: 5 }];
      state.poisonTickProgress = 1; // Phase 15.2: primed so this turn ticks
      const result = processTurn(state, { type: 'wait' });
      const poisonEvent = result.events.find((e) => e.type === 'poison_damage');
      expect(poisonEvent).toBeDefined();
      if (poisonEvent && poisonEvent.type === 'poison_damage') {
        expect(poisonEvent.actualDamage).toBe(3); // unaffected by power's +10
      }
    });

    it('does not apply to starvation damage', () => {
      const state = freshState();
      allocateRanks(state, 'power', 5);
      state.hunger = 0;
      state.starvationProgress = 4; // one tick away from starvation damage (STARVATION_INTERVAL=5)
      const result = processTurn(state, { type: 'wait' });
      const starvationEvent = result.events.find((e) => e.type === 'starvation_damage');
      expect(starvationEvent).toBeDefined();
      if (starvationEvent && starvationEvent.type === 'starvation_damage') {
        expect(starvationEvent.damage).toBe(1); // STARVATION_DAMAGE, unaffected by power
      }
    });

    it('preserves the existing relative damage gap between weapons', () => {
      const state = freshState(3);
      allocateRanks(state, 'power', 3); // +3 bonus (Phase 15.3), applies uniformly
      const unarmedState = freshState();
      unarmedState.abilities = { ...state.abilities! };
      const swordState = freshState();
      swordState.abilities = { ...state.abilities! };
      swordState.equippedWeaponId = 'sword';
      const hammerState = freshState();
      hammerState.abilities = { ...state.abilities! };
      hammerState.equippedWeaponId = 'hammer';

      const unarmedDmg = playerAttackDamage(attackAdjacentEnemy(unarmedState));
      const swordDmg = playerAttackDamage(attackAdjacentEnemy(swordState));
      const hammerDmg = playerAttackDamage(attackAdjacentEnemy(hammerState));

      // Base gaps (10 unarmed / 12 sword / 13 hammer, Phase 15.1) are
      // preserved exactly since the +6 bonus is a flat addition applied
      // identically to all three.
      expect(swordDmg - unarmedDmg).toBe(2);
      expect(hammerDmg - swordDmg).toBe(1);
    });
  });

  describe('allocation invariants', () => {
    it('a successful allocation consumes exactly 1 point', () => {
      const state = freshState(3);
      allocateAbilityPoint(state, 'body');
      expect(state.unspentAbilityPoints).toBe(2);
    });

    it('a failed allocation (0 points) changes nothing', () => {
      const state = freshState(0);
      const maxHpBefore = state.player.maxHp;
      const result = allocateAbilityPoint(state, 'body');
      expect(result.success).toBe(false);
      expect(state.player.maxHp).toBe(maxHpBefore);
      expect(state.unspentAbilityPoints).toBe(0);
    });

    it('allocation does not consume a turn', () => {
      const state = freshState(1);
      const turnBefore = state.turn;
      allocateAbilityPoint(state, 'body');
      expect(state.turn).toBe(turnBefore);
    });

    it('a successful allocation still emits exactly 1 ability_point_spent event', () => {
      const state = freshState(1);
      const result = allocateAbilityPoint(state, 'mind');
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('ability_point_spent');
    });
  });
});

// Phase 15.1 rebalance: weapon bonuses over the fixture's base attack (10)
// are now sword +2, spear +1, hammer +3, solar_gun +1 (see weapon-def.ts).
function weaponBaseDamage(weaponId: WeaponId | null): number {
  switch (weaponId) {
    case null:
      return 10;
    case 'sword':
      return 12;
    case 'spear':
      return 11;
    case 'hammer':
      return 13;
    case 'solar_gun':
      return 11;
    default:
      return 10;
  }
}
