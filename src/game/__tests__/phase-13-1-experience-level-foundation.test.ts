import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER } from '../enemy-def';
import { createInitialState, advanceToNextFloor } from '../state';
import {
  applyExperienceGain,
  getExperience,
  getExperienceRequirement,
  getLevel,
  getUnspentAbilityPoints,
  LEVEL_CAP,
} from '../progression';
import { GameEvent } from '../events';
import { EnemyType, GameMap, GameState, Tile } from '../types';
import { createEmptyInventory } from '../item-def';
import { DEFAULT_RUN_CONFIG } from '../floor';

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

function singleEnemyState(type: EnemyType, hp: number): GameState {
  const playerPos = { x: 10, y: 4 };
  const enemyPos = { x: 9, y: 4 };
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 100, 50),
    enemies: [createInitialEnemy(type, enemyPos, hp, 1)],
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

function killAdjacentEnemy(state: GameState): GameEvent[] {
  state.player.facing = 'W';
  const result = processTurn(state, { type: 'action' });
  return result.events;
}

describe('Phase 13.1 experience/level/ability-point progression foundation', () => {
  describe('progression math (progression.ts)', () => {
    it('requires 5 exp for Lv1, 10 for Lv2, 15 for Lv3', () => {
      expect(getExperienceRequirement(1)).toBe(5);
      expect(getExperienceRequirement(2)).toBe(10);
      expect(getExperienceRequirement(3)).toBe(15);
    });

    it('does not level up below the requirement', () => {
      const state = singleEnemyState('bok', 100);
      const result = applyExperienceGain(state, 4);
      expect(result.newLevel).toBe(1);
      expect(state.level).toBe(1);
      expect(state.experience).toBe(4);
    });

    it('levels up exactly at the requirement, with experience reset to 0', () => {
      const state = singleEnemyState('bok', 100);
      const result = applyExperienceGain(state, 5);
      expect(result.newLevel).toBe(2);
      expect(state.experience).toBe(0);
    });

    it('carries surplus experience into the next level', () => {
      const state = singleEnemyState('bok', 100);
      applyExperienceGain(state, 4);
      applyExperienceGain(state, 3);
      expect(state.level).toBe(2);
      expect(state.experience).toBe(2);
    });

    it('supports multiple level-ups from a single gain', () => {
      const state = singleEnemyState('bok', 100);
      // Lv1->2 needs 5, Lv2->3 needs 10: 16 exp should reach Lv3 with 1 left over.
      const result = applyExperienceGain(state, 16);
      expect(result.newLevel).toBe(3);
      expect(state.experience).toBe(1);
      expect(result.levelUps.map((l) => l.level)).toEqual([2, 3]);
    });

    it('grants 1 ability point per level gained', () => {
      const state = singleEnemyState('bok', 100);
      applyExperienceGain(state, 16); // reaches Lv3: two level-ups
      expect(getUnspentAbilityPoints(state)).toBe(2);
    });

    it('never exceeds LEVEL_CAP (99)', () => {
      const state = singleEnemyState('bok', 100);
      const result = applyExperienceGain(state, 1_000_000);
      expect(result.newLevel).toBe(LEVEL_CAP);
      expect(state.level).toBe(LEVEL_CAP);
      expect(state.experience).toBe(0);
    });
  });

  describe('enemy experience rewards', () => {
    it('every existing enemy definition has an experienceReward', () => {
      for (const type of ENEMY_TYPES_IN_ORDER) {
        expect(ENEMY_DEFINITIONS[type].experienceReward).toBeDefined();
      }
    });

    it('every current enemy rewards a positive integer experience (Phase 15.1: per-species 1/2/3, not a flat 1)', () => {
      for (const type of ENEMY_TYPES_IN_ORDER) {
        expect(ENEMY_DEFINITIONS[type].experienceReward).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(ENEMY_DEFINITIONS[type].experienceReward)).toBe(true);
      }
    });

    it('awards experience exactly once per defeated enemy', () => {
      const state = singleEnemyState('bok', 1);
      const events = killAdjacentEnemy(state);
      const gains = events.filter((e) => e.type === 'experience_gained');
      expect(gains).toHaveLength(1);
      expect(state.experience).toBe(1);
    });

    it('does not re-award experience from an already-dead enemy', () => {
      const state = singleEnemyState('bok', 1);
      killAdjacentEnemy(state);
      const expBefore = getExperience(state);
      // Enemy is already dead; a further action turn does nothing to it.
      processTurn(state, { type: 'wait' });
      expect(getExperience(state)).toBe(expBefore);
    });

    it('does not award experience for non-defeat actions (wait)', () => {
      const state = singleEnemyState('bok', 100);
      processTurn(state, { type: 'wait' });
      expect(getExperience(state)).toBe(0);
      expect(getLevel(state)).toBe(1);
    });
  });

  describe('events and messages', () => {
    it('pushes experience_gained immediately after enemy_defeated', () => {
      const state = singleEnemyState('bok', 1);
      const events = killAdjacentEnemy(state);
      const defeatedIndex = events.findIndex((e) => e.type === 'enemy_defeated');
      expect(defeatedIndex).toBeGreaterThanOrEqual(0);
      expect(events[defeatedIndex + 1].type).toBe('experience_gained');
    });

    it('pushes player_leveled_up only when a level threshold is crossed', () => {
      const state = singleEnemyState('bok', 1);
      state.experience = 4; // 4 + 1 (bok's reward) = 5, exactly Lv1's requirement
      const events = killAdjacentEnemy(state);
      const levelUps = events.filter((e) => e.type === 'player_leveled_up');
      expect(levelUps).toHaveLength(1);
    });

    it('does not push player_leveled_up for a defeat that does not cross a level threshold', () => {
      const state = singleEnemyState('bok', 1);
      const events = killAdjacentEnemy(state);
      const levelUps = events.filter((e) => e.type === 'player_leveled_up');
      expect(levelUps).toHaveLength(0);
    });
  });

  describe('lifecycle', () => {
    it('a new run starts at Lv1, EXP0, ability points 0', () => {
      const state = createInitialState(42);
      expect(getLevel(state)).toBe(1);
      expect(getExperience(state)).toBe(0);
      expect(getUnspentAbilityPoints(state)).toBe(0);
    });

    it('floor transition maintains level/experience/ability points', () => {
      const state = createInitialState(42);
      applyExperienceGain(state, 7); // Lv2, 2 exp, 1 ability point
      const next = advanceToNextFloor(state);
      expect(getLevel(next)).toBe(2);
      expect(getExperience(next)).toBe(2);
      expect(getUnspentAbilityPoints(next)).toBe(1);
    });
  });

  describe('no effect on existing combat stats', () => {
    it('leveling up does not change maxHp, current HP, SOL, attack, or defense', () => {
      const state = singleEnemyState('bok', 1);
      const hpBefore = state.player.hp;
      const maxHpBefore = state.player.maxHp;
      const solBefore = state.solarEnergy;
      const attackBefore = state.player.attack;
      const defenseBefore = state.player.defense;
      state.experience = 4;
      killAdjacentEnemy(state); // triggers a level-up
      expect(state.player.hp).toBe(hpBefore);
      expect(state.player.maxHp).toBe(maxHpBefore);
      expect(state.solarEnergy).toBe(solBefore);
      expect(state.player.attack).toBe(attackBefore);
      expect(state.player.defense).toBe(defenseBefore);
    });
  });
});
