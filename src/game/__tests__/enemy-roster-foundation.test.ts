import { describe, expect, it } from 'vitest';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER } from '../enemy-def';
import { buildRosterPreviewFloorState, createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState } from '../types';

describe('enemy roster foundation (Phase 06 + density correction)', () => {
  it('registers all 9 species with a unique id matching its record key', () => {
    expect(ENEMY_TYPES_IN_ORDER).toHaveLength(9);
    expect(new Set(ENEMY_TYPES_IN_ORDER).size).toBe(9);
    for (const type of ENEMY_TYPES_IN_ORDER) {
      expect(ENEMY_DEFINITIONS[type].id).toBe(type);
    }
  });

  it('normal play (createInitialState) spawns exactly 2 enemies, not all 9', () => {
    const state = createInitialState(42);
    expect(state.enemies).toHaveLength(2);
  });

  it('normal-floor enemies always use common-table hp/attack for whatever species they rolled', () => {
    for (const runSeed of [1, 42, 12345, 999999]) {
      const state = createInitialState(runSeed);
      for (const enemy of state.enemies) {
        const def = ENEMY_DEFINITIONS[enemy.type];
        expect(enemy.hp).toBe(def.hp);
        expect(enemy.maxHp).toBe(def.hp);
        expect(enemy.attack).toBe(def.attack);
      }
    }
  });

  it('never places any normal-floor enemy on a wall, on the player, on the exit, or overlapping another enemy', () => {
    for (const runSeed of [1, 42, 12345, 999999]) {
      const state = createInitialState(runSeed);
      const occupied = new Set<string>();
      for (const enemy of state.enemies) {
        expect(state.map.terrain[enemy.pos.y][enemy.pos.x]).toBe('floor');
        expect(enemy.pos).not.toEqual(state.player.pos);
        expect(enemy.pos).not.toEqual(state.exit);
        const key = `${enemy.pos.x},${enemy.pos.y}`;
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);
      }
    }
  });

  describe('roster preview (test/dev-only: all 9 species at once)', () => {
    it('places exactly one of each species, in fixed roster order, with common-table hp/attack', () => {
      const state = buildRosterPreviewFloorState(42);
      expect(state.enemies).toHaveLength(9);
      state.enemies.forEach((enemy, i) => {
        const def = ENEMY_DEFINITIONS[ENEMY_TYPES_IN_ORDER[i]];
        expect(enemy.type).toBe(def.id);
        expect(enemy.hp).toBe(def.hp);
        expect(enemy.maxHp).toBe(def.hp);
        expect(enemy.attack).toBe(def.attack);
      });
    });

    it('never places any enemy on a wall, on the player, on the exit, or overlapping another enemy', () => {
      for (const runSeed of [1, 42, 12345, 999999]) {
        const state = buildRosterPreviewFloorState(runSeed);
        const occupied = new Set<string>();
        for (const enemy of state.enemies) {
          expect(state.map.terrain[enemy.pos.y][enemy.pos.x]).toBe('floor');
          expect(enemy.pos).not.toEqual(state.player.pos);
          expect(enemy.pos).not.toEqual(state.exit);
          const key = `${enemy.pos.x},${enemy.pos.y}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
    });

    it('is deterministic: same seed yields identical species, stats, and positions', () => {
      const a = buildRosterPreviewFloorState(2024);
      const b = buildRosterPreviewFloorState(2024);
      expect(a.enemies).toEqual(b.enemies);
    });
  });

  it('kraken (stationary behaviorType) never moves and never attacks even when adjacent to the player', () => {
    const state: GameState = buildRosterPreviewFloorState(7);
    const kraken = state.enemies.find((e) => e.type === 'kraken')!;
    expect(ENEMY_DEFINITIONS.kraken.stationary).toBe(true);
    // Move every other enemy far away, then place kraken directly adjacent
    // to the player so an acting enemy would normally attack.
    state.enemies.forEach((e) => {
      if (e !== kraken) e.pos = { x: 0, y: 0 };
    });
    kraken.pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    const before = { ...kraken.pos };
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(kraken.pos).toEqual(before);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('placeholder species (cockatrice, bat, mummy) act via the generic-melee fallback: they attack when orthogonally/diagonally adjacent', () => {
    const state = buildRosterPreviewFloorState(7);
    for (const type of ['cockatrice', 'bat', 'mummy'] as const) {
      const enemy = state.enemies.find((e) => e.type === type)!;
      // Isolate this one enemy adjacent to the player; move all others away.
      state.enemies.forEach((e) => {
        if (e !== enemy) e.pos = { x: 0, y: 0 };
        e.alive = true;
        e.hp = e.maxHp;
      });
      enemy.pos = { x: state.player.pos.x + 1, y: state.player.pos.y + 1 }; // diagonal, valid for bok-style 8-dir attack
      state.player.hp = state.player.maxHp;
      state.player.alive = true;
      state.phase = 'playing';
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'wait' });
      expect(state.player.hp).toBe(hpBefore - enemy.attack);
    }
  });

  it('golem/sword/axe (now distinct melee behaviorTypes) all attack an adjacent player on their first eligible turn', () => {
    // This is a foundation-level placeholder-routing sanity check, not the
    // detailed per-species behavior test (see
    // enemy-behavior-melee-variants.test.ts for slow/fast/recovery_melee
    // specifics). Each iteration re-aligns state.turn to the enemy's own
    // spawnTurn so golem's (slow_melee) acting-phase check doesn't depend
    // on loop iteration order.
    const state = buildRosterPreviewFloorState(7);
    for (const type of ['golem', 'sword', 'axe'] as const) {
      const enemy = state.enemies.find((e) => e.type === type)!;
      state.enemies.forEach((e) => {
        if (e !== enemy) e.pos = { x: 0, y: 0 };
        e.alive = true;
        e.hp = e.maxHp;
        e.recovering = false;
      });
      enemy.pos = { x: state.player.pos.x - 1, y: state.player.pos.y - 1 };
      state.player.hp = state.player.maxHp;
      state.player.alive = true;
      state.phase = 'playing';
      state.turn = enemy.spawnTurn ?? 0; // golem's acting phase is 0 here
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'wait' });
      expect(state.player.hp).toBe(hpBefore - enemy.attack);
    }
  });
});
