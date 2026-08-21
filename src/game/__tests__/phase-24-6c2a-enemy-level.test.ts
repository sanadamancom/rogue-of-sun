import { describe, expect, it } from 'vitest';
import { applyEnemyLevelMultiplier, ENEMY_DEFINITIONS } from '../enemy-def';
import { advanceToNextFloor, buildEnemies, buildRosterPreviewFloorState, createInitialState } from '../state';

describe('Phase 24.6c2a EnemyLevel multipliers', () => {
  it('keeps level 1 stats byte-identical to the species definition', () => {
    const def = ENEMY_DEFINITIONS.bok;
    expect(applyEnemyLevelMultiplier(def, 1)).toEqual({
      hp: def.hp,
      attack: def.attack,
      defense: def.defense,
      accuracy: def.accuracy,
      evasion: def.evasion,
      experienceReward: def.experienceReward,
    });
  });

  it('applies level 2 ceiling, nearest rounding, flat bonuses, and EXP multiplier', () => {
    expect(applyEnemyLevelMultiplier(ENEMY_DEFINITIONS.bok, 2)).toEqual({
      hp: 10,
      attack: 4,
      defense: 1,
      accuracy: 92,
      evasion: 3,
      experienceReward: 3,
    });
  });

  it('applies level 3 rules and caps accuracy at 95', () => {
    expect(applyEnemyLevelMultiplier({ ...ENEMY_DEFINITIONS.golem, accuracy: 94 }, 3)).toEqual({
      hp: 23,
      attack: 19,
      defense: 3,
      accuracy: 95,
      evasion: 5,
      experienceReward: 24,
    });
  });

  it.each([
    [1, 10],
    [2, 15],
    [3, 20],
  ] as const)('applies bat-specific evasion at level %i', (level, evasion) => {
    expect(applyEnemyLevelMultiplier(ENEMY_DEFINITIONS.bat, level).evasion).toBe(evasion);
  });
});

describe('Phase 24.6c2a production spawning', () => {
  it('buildEnemies creates level 1 enemies with unchanged base stats', () => {
    const [enemy] = buildEnemies([{ x: 1, y: 2 }], ['bat'], 7);
    const def = ENEMY_DEFINITIONS.bat;
    expect(enemy).toMatchObject({
      level: 1,
      hp: def.hp,
      maxHp: def.hp,
      attack: def.attack,
      defense: def.defense,
      accuracy: def.accuracy,
      evasion: def.evasion,
    });
  });

  it('normal and roster-preview production paths only create level 1 base-stat enemies', () => {
    for (const state of [createInitialState(12345), buildRosterPreviewFloorState(67890)]) {
      expect(state.enemies.length).toBeGreaterThan(0);
      for (const enemy of state.enemies) {
        const def = ENEMY_DEFINITIONS[enemy.type];
        expect(enemy).toMatchObject({
          level: 1,
          hp: def.hp,
          maxHp: def.hp,
          attack: def.attack,
          defense: def.defense,
          accuracy: def.accuracy,
          evasion: def.evasion,
        });
      }
    }
  });

  it('monster-house production enemies are also level 1 with base stats', () => {
    let found = false;
    for (let seed = 1; seed <= 500 && !found; seed += 1) {
      const state = advanceToNextFloor(createInitialState(seed));
      for (const enemy of state.enemies.filter((candidate) => candidate.spawnSource === 'monster_house')) {
        const def = ENEMY_DEFINITIONS[enemy.type];
        expect(enemy).toMatchObject({ level: 1, hp: def.hp, maxHp: def.hp, attack: def.attack });
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
