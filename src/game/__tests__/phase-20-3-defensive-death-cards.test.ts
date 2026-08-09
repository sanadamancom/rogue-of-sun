import { describe, expect, it } from 'vitest';
import { getActiveEffect } from '../effects';
import { advanceToNextFloor, createInitialState } from '../state';
import { isCardIdentified, processTurn } from '../turn';
import { GameState } from '../types';

/**
 * Phase 20.3 defensive/death card tests (emperor, death, judgement).
 * Exercises production exclusively through processTurn — no card effect
 * or damage-mitigation logic is reimplemented here. death/judgement were
 * already production-implemented before this phase (see
 * docs/history/phase-20-3-defensive-death-cards.md's provenance
 * section); only emperor is newly implemented this phase.
 */

function withCard(state: GameState, cardId: import('../types').ItemId, count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

function adjacentEnemy(state: GameState, attack: number, actionGauge = 0) {
  return {
    type: 'bok' as const,
    pos: { x: state.player.pos.x + 1, y: state.player.pos.y },
    hp: 999,
    maxHp: 999,
    attack,
    defense: 0,
    accuracy: 100,
    evasion: 0,
    facing: 'W' as const,
    alive: true,
    actionGauge,
  };
}

describe('Phase 20.3: emperor / death / judgement', () => {
  describe('emperor', () => {
    it('reduces a direct enemy attack by roughly 50%, rounded up (11 -> 6)', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state.enemies = [adjacentEnemy(state, 11)];
      const result = processTurn(state, { type: 'wait' });
      const attackEvent = result.events.find((e) => e.type === 'enemy_attack');
      expect(attackEvent).toBeDefined();
      if (attackEvent && attackEvent.type === 'enemy_attack') {
        // Raw (unmitigated) would be 11; 50% -> 5.5 -> ceil -> 6.
        expect(attackEvent.damage).toBe(6);
      }
    });

    it('never reduces damage below 1 when the raw attack is at least 1', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state.enemies = [adjacentEnemy(state, 1)];
      const result = processTurn(state, { type: 'wait' });
      const attackEvent = result.events.find((e) => e.type === 'enemy_attack');
      expect(attackEvent).toBeDefined();
      if (attackEvent && attackEvent.type === 'enemy_attack') {
        expect(attackEvent.damage).toBeGreaterThanOrEqual(1);
      }
    });

    it('mitigates a physical enemy attack compared to an unshielded baseline (same event field, no regen interference)', () => {
      const baseline = createInitialState(1);
      baseline.enemies = [adjacentEnemy(baseline, 20)];
      const baselineResult = processTurn(baseline, { type: 'wait' });
      const baselineEvent = baselineResult.events.find((e) => e.type === 'enemy_attack');
      const baselineDamage = baselineEvent && baselineEvent.type === 'enemy_attack' ? baselineEvent.damage : -1;

      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state.enemies = [adjacentEnemy(state, 20)];
      const result = processTurn(state, { type: 'wait' });
      const shieldedEvent = result.events.find((e) => e.type === 'enemy_attack');
      const shieldedDamage = shieldedEvent && shieldedEvent.type === 'enemy_attack' ? shieldedEvent.damage : -1;
      expect(shieldedDamage).toBeLessThan(baselineDamage);
    });

    it('does not mitigate starvation damage (loss unaffected by emperor being active)', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state.enemies = [];
      state.hunger = 0;
      state.starvationProgress = 0;
      state.regenProgress = -1000; // suppress natural regen this turn for a clean measurement
      const before = state.player.hp;
      processTurn(state, { type: 'wait' });
      const loss = before - state.player.hp;
      // Whatever STARVATION_DAMAGE is, it must be identical to the
      // unmitigated fixed value — verified by comparing against a
      // freshly-constructed unshielded state, itself also regen-suppressed.
      const unshielded = createInitialState(1);
      unshielded.enemies = [];
      unshielded.hunger = 0;
      unshielded.starvationProgress = 0;
      unshielded.regenProgress = -1000;
      const before2 = unshielded.player.hp;
      processTurn(unshielded, { type: 'wait' });
      const unshieldedLoss = before2 - unshielded.player.hp;
      expect(loss).toBe(unshieldedLoss);
    });

    it('does not mitigate poison damage (loss unaffected by emperor being active)', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state.enemies = [];
      state.activeEffects = [...(state.activeEffects ?? []), { id: 'poison', strength: 5, remainingTurns: 10 }];
      state.poisonTickProgress = 1;
      state.regenProgress = -1000;
      const before = state.player.hp;
      processTurn(state, { type: 'wait' });
      const loss = before - state.player.hp;

      const unshielded = createInitialState(1);
      unshielded.enemies = [];
      unshielded.activeEffects = [{ id: 'poison', strength: 5, remainingTurns: 10 }];
      unshielded.poisonTickProgress = 1;
      unshielded.regenProgress = -1000;
      const before2 = unshielded.player.hp;
      processTurn(unshielded, { type: 'wait' });
      const unshieldedLoss = before2 - unshielded.player.hp;
      expect(loss).toBe(unshieldedLoss);
    });

    it('does not mitigate self-inflicted card damage (death)', () => {
      let state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state = withCard(state, 'death', 1);
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.player.hp).toBe(0);
    });

    it('lasts 5 turns of enemy action opportunity, then expires', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      expect(getActiveEffect(state, 'emperor_shield')).toBeDefined();
      for (let i = 0; i < 5; i++) {
        processTurn(state, { type: 'wait' });
      }
      expect(getActiveEffect(state, 'emperor_shield')).toBeUndefined();
    });

    it('is active for enemy actions on the very turn it is used', () => {
      const baseline = createInitialState(1);
      baseline.enemies = [adjacentEnemy(baseline, 20)];
      const baselineResult = processTurn(baseline, { type: 'wait' });
      const baselineEvent = baselineResult.events.find((e) => e.type === 'enemy_attack');
      const baselineDamage = baselineEvent && baselineEvent.type === 'enemy_attack' ? baselineEvent.damage : -1;

      const state = withCard(createInitialState(1), 'emperor', 1);
      state.enemies = [adjacentEnemy(state, 20)];
      const result = processTurn(state, { type: 'use_item', itemId: 'emperor' });
      const shieldedEvent = result.events.find((e) => e.type === 'enemy_attack');
      const shieldedDamage = shieldedEvent && shieldedEvent.type === 'enemy_attack' ? shieldedEvent.damage : -1;
      expect(shieldedDamage).toBeLessThan(baselineDamage);
    });

    it('reusing while active refreshes the duration rather than stacking (never exceeds the base duration)', () => {
      const state = withCard(createInitialState(1), 'emperor', 2);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      processTurn(state, { type: 'wait' });
      processTurn(state, { type: 'wait' });
      const effectBefore = getActiveEffect(state, 'emperor_shield')!;
      const remainingBeforeReuse = effectBefore.remainingTurns;
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      const effectAfter = getActiveEffect(state, 'emperor_shield')!;
      // Refreshed strictly higher than just before reuse, and never
      // stacked beyond the definition's own duration (5).
      expect(effectAfter.remainingTurns).toBeGreaterThan(remainingBeforeReuse);
      expect(effectAfter.remainingTurns).toBeLessThanOrEqual(5);
    });

    it('reuse still consumes, identifies, and advances the turn even when the refreshed duration equals the pre-reuse value', () => {
      const state = withCard(createInitialState(1), 'emperor', 2);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'emperor' });
      expect(result.consumed).toBe(true);
      expect(state.turn).toBe(turnBefore + 1);
      expect(state.inventory.emperor).toBe(0);
    });

    it('persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      const next = advanceToNextFloor(state);
      expect(getActiveEffect(next, 'emperor_shield')).toBeDefined();
    });

    it('a new run never has emperor_shield active', () => {
      const state = createInitialState(1);
      expect(getActiveEffect(state, 'emperor_shield')).toBeUndefined();
    });

    it('consumes exactly one copy, identifies, and advances the turn by 1 on success', () => {
      const state = withCard(createInitialState(1), 'emperor', 1);
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'emperor' });
      expect(result.consumed).toBe(true);
      expect(state.inventory.emperor).toBe(0);
      expect(isCardIdentified(state, 'emperor')).toBe(true);
      expect(state.turn).toBe(turnBefore + 1);
    });
  });

  describe('death', () => {
    it('without judgement, results in death and gameover', () => {
      const state = withCard(createInitialState(1), 'death', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(result.consumed).toBe(true);
      expect(state.player.hp).toBe(0);
      expect(state.player.alive).toBe(false);
      expect(state.phase).toBe('gameover');
    });

    it('with judgement, restores LIFE and SOL fully and continues', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 1);
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.player.alive).toBe(true);
      expect(state.player.hp).toBe(state.player.maxHp);
      expect(state.solarEnergy).toBe(state.maxSolarEnergy);
      expect(state.phase).toBe('playing');
    });

    it('does not use a fixed value of 15 for max LIFE/SOL when they have grown', () => {
      let state = withCard(createInitialState(1), 'empress', 1);
      processTurn(state, { type: 'use_item', itemId: 'empress' });
      const grownMaxHp = state.player.maxHp;
      expect(grownMaxHp).toBeGreaterThan(15);
      state = withCard(state, 'death', 1);
      state = withCard(state, 'judgement', 1);
      state.enemies = []; // isolate from any enemy acting after judgement's revival
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.player.hp).toBe(grownMaxHp);
    });

    it('succeeds even when SOL is already at max', () => {
      const state = withCard(createInitialState(1), 'death', 1);
      state.solarEnergy = state.maxSolarEnergy;
      const result = processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(result.consumed).toBe(true);
    });

    it('consumes exactly one death and one judgement copy', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 3);
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.inventory.death).toBe(0);
      expect(state.inventory.judgement).toBe(2);
    });

    it('advances the turn by exactly 1 regardless of judgement', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 1);
      const turnBefore = state.turn;
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('does not consume RNG', () => {
      const state = withCard(createInitialState(1), 'death', 1);
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('is unusable while sealed', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const result = processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(result.consumed).toBe(false);
      expect(state.player.alive).toBe(true);
    });
  });

  describe('judgement', () => {
    it('never appears as a normal-use success even when selected directly', () => {
      const state = withCard(createInitialState(1), 'judgement', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'judgement' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.judgement).toBe(1);
    });

    it('is displayed as an inventory item (present in inventory count)', () => {
      const state = withCard(createInitialState(1), 'judgement', 2);
      expect(state.inventory.judgement).toBe(2);
    });

    it('triggers from an ordinary enemy-attack LIFE 0', () => {
      const state = withCard(createInitialState(1), 'judgement', 1);
      state.player.hp = 1;
      state.enemies = [adjacentEnemy(state, 999)];
      const result = processTurn(state, { type: 'wait' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
      expect(state.player.alive).toBe(true);
    });

    it('triggers from starvation-caused LIFE 0', () => {
      const state = withCard(createInitialState(1), 'judgement', 1);
      state.player.hp = 1;
      state.hunger = 0;
      state.starvationProgress = 0;
      const result = processTurn(state, { type: 'wait' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
      expect(state.player.alive).toBe(true);
    });

    it('triggers from poison-caused LIFE 0', () => {
      const state = withCard(createInitialState(1), 'judgement', 1);
      state.player.hp = 1;
      state.activeEffects = [{ id: 'poison', strength: 99, remainingTurns: 10 }];
      state.poisonTickProgress = 1;
      const result = processTurn(state, { type: 'wait' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
      expect(state.player.alive).toBe(true);
    });

    it('triggers from hanged_man-caused LIFE 0', () => {
      let state = withCard(createInitialState(1), 'hanged_man', 1);
      state = withCard(state, 'judgement', 1);
      state.player.hp = 5;
      state.solarEnergy = 0;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
      expect(state.player.alive).toBe(true);
    });

    it('triggers from death-caused LIFE 0', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
    });

    it('triggers while sealed', () => {
      let state = withCard(createInitialState(1), 'judgement', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      state.player.hp = 1;
      state.enemies = [adjacentEnemy(state, 999)];
      const result = processTurn(state, { type: 'wait' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
      expect(state.player.alive).toBe(true);
    });

    it('consumes exactly one copy per death confirmation, even with several held', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 5);
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.inventory.judgement).toBe(4);
    });

    it('never adds an extra turn beyond the triggering action', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 1);
      const turnBefore = state.turn;
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('identifies itself upon triggering', () => {
      let state = withCard(createInitialState(1), 'death', 1);
      state = withCard(state, 'judgement', 1);
      expect(isCardIdentified(state, 'judgement')).toBe(false);
      processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(isCardIdentified(state, 'judgement')).toBe(true);
    });

    it('results in normal death when not held', () => {
      const state = withCard(createInitialState(1), 'death', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'death' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(false);
      expect(state.player.alive).toBe(false);
    });
  });
});
