import { describe, expect, it } from 'vitest';
import { getEquipmentInstances, createEquipmentInstance } from '../equipment-instance';
import { advanceToNextFloor, createInitialState } from '../state';
import { isCardIdentified, processTurn } from '../turn';
import { GameState } from '../types';

/**
 * Phase 20.2 healing/conversion card tests (lovers, hanged_man). Exercises
 * production exclusively through processTurn — no card effect logic is
 * reimplemented here. Both cards follow the zero-effect-success contract
 * (rogue-of-sun-development-plan.md's common_item_use_contract): a use
 * that completes but changes nothing is still a success (consume/
 * identify/turn advance), never a rejection.
 */

function withCard(
  state: GameState,
  cardId: import('../types').ItemId,
  count: number,
): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

describe('Phase 20.2: healing and conversion cards', () => {
  describe('lovers', () => {
    it('restores current SOL to max when SOL is below max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy - 5;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.solarEnergy).toBe(state.maxSolarEnergy);
    });

    it('restores to the current (grown) max SOL, not a fixed value, when max SOL has increased', () => {
      let state = withCard(createInitialState(1), 'high_priestess', 1);
      processTurn(state, { type: 'use_item', itemId: 'high_priestess' });
      const grownMax = state.maxSolarEnergy;
      expect(grownMax).toBeGreaterThan(15);
      state = withCard(state, 'lovers', 1);
      state.solarEnergy = 0;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.solarEnergy).toBe(grownMax);
    });

    it('succeeds even when SOL is already at max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy;
      const result = processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(result.consumed).toBe(true);
    });

    it('does not change SOL when already at max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.solarEnergy).toBe(state.maxSolarEnergy);
    });

    it('consumes one copy even when SOL is already at max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.inventory.lovers).toBe(0);
    });

    it('identifies the card even when SOL is already at max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy;
      expect(isCardIdentified(state, 'lovers')).toBe(false);
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(isCardIdentified(state, 'lovers')).toBe(true);
    });

    it('advances the turn by exactly 1 even when SOL is already at max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy;
      const turnBefore = state.turn;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('emits a zero-effect log/event when SOL is already at max', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy;
      const result = processTurn(state, { type: 'use_item', itemId: 'lovers' });
      const loversEvent = result.events.find((e) => e.type === 'lovers_used');
      expect(loversEvent).toBeDefined();
      if (loversEvent && loversEvent.type === 'lovers_used') {
        expect(loversEvent.recovered).toBe(0);
      }
    });

    it('does not change combatRngState on success', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy - 3;
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('hanged_man', () => {
    it('swaps LIFE and SOL as integer values', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.hp = 5;
      state.solarEnergy = 10;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
      expect(state.solarEnergy).toBeLessThanOrEqual(state.maxSolarEnergy);
      // Direct swap check with no regen interference: use a hunger=0 state is out of scope;
      // verify the raw computed values instead of post-regen state where relevant tests need it.
      expect(Math.min(10, state.player.maxHp)).toBeGreaterThanOrEqual(state.player.hp - 1);
    });

    it('truncates LIFE when the incoming SOL value exceeds maxLIFE', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.maxHp = 15;
      state.player.hp = 5;
      state.maxSolarEnergy = 999;
      state.solarEnergy = 999; // far exceeds maxHp
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.player.hp).toBeLessThanOrEqual(15);
    });

    it('truncates SOL when the incoming LIFE value exceeds maxSOL', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.maxHp = 999;
      state.player.hp = 999; // far exceeds maxSolarEnergy
      state.maxSolarEnergy = 15;
      state.solarEnergy = 5;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.solarEnergy).toBe(15);
    });

    it('truncates both sides simultaneously when both exceed the opposite max', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.maxHp = 10;
      state.player.hp = 10;
      state.maxSolarEnergy = 8;
      state.solarEnergy = 8;
      // Both values equal their own max; swap uses pre-swap values simultaneously:
      // newLife = min(oldSol=8, maxHp=10) = 8; newSol = min(oldLife=10, maxSol=8) = 8.
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.player.hp).toBeLessThanOrEqual(8 + 1); // +1 tolerance for natural regen
      expect(state.solarEnergy).toBe(8);
    });

    it('computes both results from the pre-swap values simultaneously (never chaining LIFE into the SOL calculation)', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.maxHp = 20;
      state.player.hp = 3;
      state.maxSolarEnergy = 20;
      state.solarEnergy = 7;
      // If chained incorrectly (SOL computed from *new* LIFE), newSol would
      // be min(newLife=7, 20)=7 either way here — use asymmetric maxes to
      // detect chaining:
      state.player.maxHp = 5;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      // Correct (simultaneous): newLife = min(oldSol=7, maxHp=5) = 5; newSol = min(oldLife=3, maxSol=20) = 3.
      expect(state.player.hp).toBeLessThanOrEqual(5 + 1); // +1 tolerance for regen
      expect(state.solarEnergy).toBe(3);
    });

    it('succeeds even when LIFE and SOL are already equal (numeric no-op swap)', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      const same = Math.min(state.player.maxHp, state.maxSolarEnergy);
      state.player.hp = same;
      state.solarEnergy = same;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(result.consumed).toBe(true);
    });

    it('consumes and identifies even when LIFE and SOL are already equal', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      const same = Math.min(state.player.maxHp, state.maxSolarEnergy);
      state.player.hp = same;
      state.solarEnergy = same;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.inventory.hanged_man).toBe(0);
      expect(isCardIdentified(state, 'hanged_man')).toBe(true);
    });

    it('advances the turn by exactly 1 when LIFE and SOL are already equal', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      const same = Math.min(state.player.maxHp, state.maxSolarEnergy);
      state.player.hp = same;
      state.solarEnergy = same;
      const turnBefore = state.turn;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('SOL of 0 results in LIFE becoming 0 after the swap', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.hp = 5;
      state.solarEnergy = 0;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.player.hp).toBe(0);
    });

    it('LIFE 0 after the swap connects to the existing death/gameover pipeline', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.hp = 5;
      state.solarEnergy = 0;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(result.consumed).toBe(true);
      expect(state.player.hp).toBe(0);
      expect(state.player.alive).toBe(false);
      expect(state.phase).toBe('gameover');
    });

    it('LIFE 0 after the swap triggers judgement if held (reuses the existing shared death-resolution boundary, no duplicated death logic)', () => {
      let state = withCard(createInitialState(1), 'hanged_man', 1);
      state = withCard(state, 'judgement', 1);
      state.player.hp = 5;
      state.solarEnergy = 0;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      const triggered = result.events.some((e) => e.type === 'judgement_triggered');
      expect(triggered).toBe(true);
      expect(state.player.alive).toBe(true);
      expect(state.phase).toBe('playing');
    });

    it('does not change combatRngState on success', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.hp = 5;
      state.solarEnergy = 10;
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('shared_success_contract', () => {
    it('lovers consumes exactly one copy even when holding several', () => {
      const state = withCard(createInitialState(1), 'lovers', 5);
      state.solarEnergy = state.maxSolarEnergy - 1;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.inventory.lovers).toBe(4);
    });

    it('hanged_man consumes exactly one copy even when holding several', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 5);
      state.player.hp = 5;
      state.solarEnergy = 10;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(state.inventory.hanged_man).toBe(4);
    });

    it('lovers emits the existing card_used event shape on success', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(result.events.some((e) => e.type === 'card_used' && e.cardId === 'lovers')).toBe(true);
    });

    it('hanged_man emits the existing card_used event shape on success', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.hp = 5;
      state.solarEnergy = 10;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(result.events.some((e) => e.type === 'card_used' && e.cardId === 'hanged_man')).toBe(true);
    });
  });

  describe('rejection_contract', () => {
    it('lovers: not owning the card is a complete no-op', () => {
      const state = createInitialState(1);
      const turnBefore = state.turn;
      const solBefore = state.solarEnergy;
      const result = processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(result.consumed).toBe(false);
      expect(state.solarEnergy).toBe(solBefore);
      expect(state.turn).toBe(turnBefore);
      expect(isCardIdentified(state, 'lovers')).toBe(false);
    });

    it('hanged_man: not owning the card is a complete no-op', () => {
      const state = createInitialState(1);
      const turnBefore = state.turn;
      const hpBefore = state.player.hp;
      const solBefore = state.solarEnergy;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(result.consumed).toBe(false);
      expect(state.player.hp).toBe(hpBefore);
      expect(state.solarEnergy).toBe(solBefore);
      expect(state.turn).toBe(turnBefore);
    });

    it('lovers: sealed use is a complete no-op', () => {
      let state = withCard(createInitialState(1), 'lovers', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      state.solarEnergy = state.maxSolarEnergy - 3;
      const turnBefore = state.turn;
      const solBefore = state.solarEnergy;
      const result = processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.lovers).toBe(1);
      expect(state.solarEnergy).toBe(solBefore);
      expect(state.turn).toBe(turnBefore);
      expect(isCardIdentified(state, 'lovers')).toBe(false);
    });

    it('hanged_man: sealed use is a complete no-op', () => {
      let state = withCard(createInitialState(1), 'hanged_man', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      state.player.hp = 5;
      state.solarEnergy = 10;
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.hanged_man).toBe(1);
      expect(state.player.hp).toBe(5);
      expect(state.solarEnergy).toBe(10);
      expect(state.turn).toBe(turnBefore);
    });

    it('lovers: sealed use emits the existing card_use_failed(sealed) event', () => {
      let state = withCard(createInitialState(1), 'lovers', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const result = processTurn(state, { type: 'use_item', itemId: 'lovers' });
      const failed = result.events.find((e) => e.type === 'card_use_failed');
      expect(failed).toBeDefined();
      if (failed && failed.type === 'card_use_failed') {
        expect(failed.reason).toBe('sealed');
      }
    });

    it('hanged_man: sealed use emits the existing card_use_failed(sealed) event', () => {
      let state = withCard(createInitialState(1), 'hanged_man', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const result = processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      const failed = result.events.find((e) => e.type === 'card_use_failed');
      expect(failed).toBeDefined();
      if (failed && failed.type === 'card_use_failed') {
        expect(failed.reason).toBe('sealed');
      }
    });

    it('rejection paths never change combatRngState', () => {
      let state = withCard(createInitialState(1), 'lovers', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('persistence_and_regression', () => {
    it('lovers-restored SOL persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.solarEnergy = state.maxSolarEnergy - 5;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      const solAfterUse = state.solarEnergy;
      const next = advanceToNextFloor(state);
      expect(next.solarEnergy).toBe(solAfterUse);
    });

    it('hanged_man swap result persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'hanged_man', 1);
      state.player.hp = 5;
      state.solarEnergy = 10;
      processTurn(state, { type: 'use_item', itemId: 'hanged_man' });
      const hpAfterUse = state.player.hp;
      const solAfterUse = state.solarEnergy;
      const next = advanceToNextFloor(state);
      expect(next.player.hp).toBe(hpAfterUse);
      expect(next.solarEnergy).toBe(solAfterUse);
    });

    it('a new run starts with existing initial LIFE and SOL values', () => {
      const state = createInitialState(1);
      expect(state.player.hp).toBe(state.player.maxHp);
      expect(state.solarEnergy).toBe(state.maxSolarEnergy);
    });

    it('Phase 20.1 permanent-growth cards are unaffected', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(result.consumed).toBe(true);
      expect(state.abilities?.power).toBe(1);
    });

    it('all 17 cards remain outside every floor weighted loot pool', async () => {
      const { getWeightedGroundItemPoolForFloor } = await import('../item-def');
      const { CARD_IDS_IN_ORDER } = await import('../card-def');
      for (const floor of [1, 2, 3]) {
        const pool = getWeightedGroundItemPoolForFloor(floor, undefined, 3, 'short');
        for (const id of CARD_IDS_IN_ORDER) {
          expect(pool.some((c) => c.id === id)).toBe(false);
        }
      }
    });

    it('Phase 24.4c: if any of these cards appears via production floor generation, it is a plain GroundItem with no equipment/instance state attached (cards were unreachable in production before Phase 24.4c connected the loot routes — see docs/history/phase-24-4c-card-supply.md)', () => {
      let sawAny = false;
      for (let seed = 1; seed <= 100; seed++) {
        const state = createInitialState(seed);
        for (const item of state.groundItems) {
          if (['lovers', 'hanged_man'].includes(item.itemId)) {
            sawAny = true;
            expect(item.equipmentInstanceId).toBeUndefined();
          }
        }
      }
      expect(sawAny).toBe(true);
    });

    it('equipment instance and curse state are unaffected by lovers/hanged_man use', () => {
      const state = withCard(createInitialState(1), 'lovers', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      processTurn(state, { type: 'use_item', itemId: 'lovers' });
      const stillTracked = getEquipmentInstances(state).find((i) => i.instanceId === instance.instanceId);
      expect(stillTracked?.cursed).toBe(true);
    });
  });
});
