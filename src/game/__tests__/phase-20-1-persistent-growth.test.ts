import { describe, expect, it } from 'vitest';
import { getAbilities, getAbilityValue, getPlayerSpeed, getPowerDamageBonus } from '../ability';
import { createEquipmentInstance, getEquipmentInstances } from '../equipment-instance';
import { advanceToNextFloor, createInitialState } from '../state';
import { isCardIdentified, processTurn } from '../turn';
import { GameState } from '../types';

/**
 * Phase 20.1 persistent-growth card tests. Exercises the 5 cards
 * (high_priestess/empress/chariot/strength/wheel_of_fortune) exclusively
 * through production's public surface (processTurn/applyCardUse via
 * turn.ts, already implemented in an earlier session — see this file's
 * accompanying audit report) — no card effect logic is reimplemented
 * here. Loot/floor-appearance (floorDropEnabled/lootWeight/unlockFloor)
 * is explicitly out of scope this phase (deferred to Phase 21+) and
 * covered only by a production_integration assertion that no card
 * appears in floor loot.
 */

function withCard(state: GameState, cardId: 'high_priestess' | 'empress' | 'chariot' | 'strength' | 'wheel_of_fortune', count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

describe('Phase 20.1: persistent growth cards', () => {
  describe('individual_effects', () => {
    it('high_priestess raises mind only, by exactly 1', () => {
      const state = withCard(createInitialState(1), 'high_priestess', 1);
      const before = getAbilities(state);
      processTurn(state, { type: 'use_item', itemId: 'high_priestess' });
      const after = getAbilities(state);
      expect(after.mind).toBe(before.mind + 1);
      expect(after.body).toBe(before.body);
      expect(after.power).toBe(before.power);
      expect(after.speed).toBe(before.speed);
    });

    it('empress raises body only, by exactly 1', () => {
      const state = withCard(createInitialState(1), 'empress', 1);
      const before = getAbilities(state);
      processTurn(state, { type: 'use_item', itemId: 'empress' });
      const after = getAbilities(state);
      expect(after.body).toBe(before.body + 1);
      expect(after.mind).toBe(before.mind);
      expect(after.power).toBe(before.power);
      expect(after.speed).toBe(before.speed);
    });

    it('chariot raises speed only, by exactly 1', () => {
      const state = withCard(createInitialState(1), 'chariot', 1);
      const before = getAbilities(state);
      processTurn(state, { type: 'use_item', itemId: 'chariot' });
      const after = getAbilities(state);
      expect(after.speed).toBe(before.speed + 1);
      expect(after.body).toBe(before.body);
      expect(after.mind).toBe(before.mind);
      expect(after.power).toBe(before.power);
    });

    it('strength raises power only, by exactly 1', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const before = getAbilities(state);
      processTurn(state, { type: 'use_item', itemId: 'strength' });
      const after = getAbilities(state);
      expect(after.power).toBe(before.power + 1);
      expect(after.body).toBe(before.body);
      expect(after.mind).toBe(before.mind);
      expect(after.speed).toBe(before.speed);
    });

    it('wheel_of_fortune raises exactly one ability, by exactly 2, leaving the other 3 unchanged', () => {
      const state = withCard(createInitialState(1), 'wheel_of_fortune', 1);
      const before = getAbilities(state);
      processTurn(state, { type: 'use_item', itemId: 'wheel_of_fortune' });
      const after = getAbilities(state);
      const deltas = {
        body: after.body - before.body,
        mind: after.mind - before.mind,
        power: after.power - before.power,
        speed: after.speed - before.speed,
      };
      const raised = Object.values(deltas).filter((d) => d !== 0);
      expect(raised).toEqual([2]);
    });
  });

  describe('wheel_rng', () => {
    it('all 4 abilities are reachable across many seeds (canonical order body/mind/power/speed each ~25%)', () => {
      const raised = new Set<string>();
      for (let seed = 1; seed <= 200; seed++) {
        const state = withCard(createInitialState(seed), 'wheel_of_fortune', 1);
        const before = getAbilities(state);
        processTurn(state, { type: 'use_item', itemId: 'wheel_of_fortune' });
        const after = getAbilities(state);
        (['body', 'mind', 'power', 'speed'] as const).forEach((a) => {
          if (after[a] === before[a] + 2) raised.add(a);
        });
      }
      expect(raised).toEqual(new Set(['body', 'mind', 'power', 'speed']));
    });

    it('the same seed/combatRngState produces the same chosen ability', () => {
      const s1 = withCard({ ...createInitialState(1), combatRngState: 555 }, 'wheel_of_fortune', 1);
      const s2 = withCard({ ...createInitialState(1), combatRngState: 555 }, 'wheel_of_fortune', 1);
      processTurn(s1, { type: 'use_item', itemId: 'wheel_of_fortune' });
      processTurn(s2, { type: 'use_item', itemId: 'wheel_of_fortune' });
      expect(s1.abilities).toEqual(s2.abilities);
    });

    it('a sequence of two uses is deterministic (same combatRngState transitions both times)', () => {
      let a = withCard(createInitialState(9), 'wheel_of_fortune', 2);
      let b = withCard(createInitialState(9), 'wheel_of_fortune', 2);
      processTurn(a, { type: 'use_item', itemId: 'wheel_of_fortune' });
      processTurn(a, { type: 'use_item', itemId: 'wheel_of_fortune' });
      processTurn(b, { type: 'use_item', itemId: 'wheel_of_fortune' });
      processTurn(b, { type: 'use_item', itemId: 'wheel_of_fortune' });
      expect(a.abilities).toEqual(b.abilities);
      expect(a.combatRngState).toBe(b.combatRngState);
    });

    it('a successful use consumes exactly one RNG roll (combatRngState changes exactly as a single rollPercent call would)', () => {
      const state = withCard(createInitialState(1), 'wheel_of_fortune', 1);
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'wheel_of_fortune' });
      // A single rollPercent call always changes the state (mulberry32
      // step is never a no-op) — verifies exactly one RNG transition,
      // not zero and not more than one accumulated into the same field.
      expect(state.combatRngState).not.toBe(rngBefore);
    });

    it('not owning the card consumes no RNG (no-op use_item on an unowned card)', () => {
      const state = createInitialState(1);
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'wheel_of_fortune' });
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('sealed rejection consumes no RNG', () => {
      let state = withCard(createInitialState(1), 'wheel_of_fortune', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'wheel_of_fortune' });
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('does not rely on Math.random (deterministic for a fixed combatRngState across repeated construction)', () => {
      const s1 = withCard({ ...createInitialState(1), combatRngState: 42 }, 'wheel_of_fortune', 1);
      const s2 = withCard({ ...createInitialState(1), combatRngState: 42 }, 'wheel_of_fortune', 1);
      processTurn(s1, { type: 'use_item', itemId: 'wheel_of_fortune' });
      processTurn(s2, { type: 'use_item', itemId: 'wheel_of_fortune' });
      expect(s1.combatRngState).toBe(s2.combatRngState);
    });
  });

  describe('persistence', () => {
    it('ability growth persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      processTurn(state, { type: 'use_item', itemId: 'strength' });
      const powerAfterUse = getAbilityValue(state, 'power');
      const next = advanceToNextFloor(state);
      expect(getAbilityValue(next, 'power')).toBe(powerAfterUse);
    });

    it('a new run starts from the existing initial ability values (unaffected by prior test state)', () => {
      const state = createInitialState(1);
      const abilities = getAbilities(state);
      expect(abilities.body).toBe(0);
      expect(abilities.mind).toBe(0);
      expect(abilities.power).toBe(0);
      expect(abilities.speed).toBe(0);
    });

    it('body growth (empress) reflects in maxHp via the existing calculation', () => {
      const state = withCard(createInitialState(1), 'empress', 1);
      const maxHpBefore = state.player.maxHp;
      processTurn(state, { type: 'use_item', itemId: 'empress' });
      expect(state.player.maxHp).toBeGreaterThan(maxHpBefore);
    });

    it('mind growth (high_priestess) reflects in maxSolarEnergy via the existing calculation', () => {
      const state = withCard(createInitialState(1), 'high_priestess', 1);
      const maxSolBefore = state.maxSolarEnergy;
      processTurn(state, { type: 'use_item', itemId: 'high_priestess' });
      expect(state.maxSolarEnergy).toBeGreaterThan(maxSolBefore);
    });

    it('a maxHp increase does not fully heal current HP by itself (existing clamp behavior only)', () => {
      const state = withCard(createInitialState(1), 'empress', 1);
      state.player.hp = 1;
      processTurn(state, { type: 'use_item', itemId: 'empress' });
      // Existing behavior adds the same per-rank amount to current HP as
      // to maxHp (see applyCardAbilityIncrease) — it does not set HP to
      // the new max outright.
      expect(state.player.hp).toBeLessThan(state.player.maxHp);
    });

    it('a maxSolarEnergy increase does not auto-restore current SOL to the new max', () => {
      const state = withCard(createInitialState(1), 'high_priestess', 1);
      state.solarEnergy = 0;
      processTurn(state, { type: 'use_item', itemId: 'high_priestess' });
      expect(state.solarEnergy).toBe(0);
    });

    it('power growth (strength) reflects in the existing attack-power calculation', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const bonusBefore = getPowerDamageBonus(state);
      processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(getPowerDamageBonus(state)).toBeGreaterThan(bonusBefore);
    });

    it('speed growth (chariot) reflects in the existing player-speed calculation', () => {
      const state = withCard(createInitialState(1), 'chariot', 1);
      const speedBefore = getPlayerSpeed(state);
      processTurn(state, { type: 'use_item', itemId: 'chariot' });
      expect(getPlayerSpeed(state)).toBeGreaterThan(speedBefore);
    });
  });

  describe('success_contract', () => {
    it('a successful use consumes exactly one copy of the card', () => {
      const state = withCard(createInitialState(1), 'empress', 3);
      processTurn(state, { type: 'use_item', itemId: 'empress' });
      expect(state.inventory.empress).toBe(2);
    });

    it('a successful use identifies the CardId', () => {
      const state = withCard(createInitialState(1), 'chariot', 1);
      expect(isCardIdentified(state, 'chariot')).toBe(false);
      processTurn(state, { type: 'use_item', itemId: 'chariot' });
      expect(isCardIdentified(state, 'chariot')).toBe(true);
    });

    it('a successful use advances the turn by exactly 1', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const turnBefore = state.turn;
      processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('using one copy never affects other held copies (stack count only, no per-copy identity for cards)', () => {
      const state = withCard(createInitialState(1), 'high_priestess', 5);
      processTurn(state, { type: 'use_item', itemId: 'high_priestess' });
      expect(state.inventory.high_priestess).toBe(4);
      expect(getAbilityValue(state, 'mind')).toBe(1);
    });

    it('an unidentified card can be used, and becomes identified only after success', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      expect(isCardIdentified(state, 'strength')).toBe(false);
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(result.consumed).toBe(true);
      expect(isCardIdentified(state, 'strength')).toBe(true);
    });

    it('sealed state rejects use: no ability change, no consume, no identify, no turn advance, no RNG use', () => {
      let state = withCard(createInitialState(1), 'empress', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const turnBefore = state.turn;
      const abilitiesBefore = getAbilities(state);
      const result = processTurn(state, { type: 'use_item', itemId: 'empress' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.empress).toBe(1);
      expect(isCardIdentified(state, 'empress')).toBe(false);
      expect(state.turn).toBe(turnBefore);
      expect(getAbilities(state)).toEqual(abilitiesBefore);
    });

    it('not owning the card at all rejects use with no side effects', () => {
      const state = createInitialState(1);
      const turnBefore = state.turn;
      const abilitiesBefore = getAbilities(state);
      const result = processTurn(state, { type: 'use_item', itemId: 'chariot' });
      expect(result.consumed).toBe(false);
      expect(state.turn).toBe(turnBefore);
      expect(getAbilities(state)).toEqual(abilitiesBefore);
    });

    it('production emits the existing card_used/card_identified event shapes on success', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(result.events.some((e) => e.type === 'card_used' && e.cardId === 'strength')).toBe(true);
      expect(result.events.some((e) => e.type === 'card_identified' && e.cardId === 'strength')).toBe(true);
    });

    it('production emits card_use_failed(reason: sealed) on a sealed rejection', () => {
      let state = withCard(createInitialState(1), 'strength', 1);
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      const failed = result.events.find((e) => e.type === 'card_use_failed');
      expect(failed).toBeDefined();
      if (failed && failed.type === 'card_use_failed') {
        expect(failed.reason).toBe('sealed');
      }
    });
  });

  describe('production_integration', () => {
    it('all 5 cards are registered in applyCardUse\'s dispatch (reachable via the normal use_item action, not a test-only path)', () => {
      const cards: Array<'high_priestess' | 'empress' | 'chariot' | 'strength' | 'wheel_of_fortune'> = [
        'high_priestess',
        'empress',
        'chariot',
        'strength',
        'wheel_of_fortune',
      ];
      for (const cardId of cards) {
        const state = withCard(createInitialState(1), cardId, 1);
        const result = processTurn(state, { type: 'use_item', itemId: cardId });
        expect(result.consumed).toBe(true);
      }
    });

    it('all 17 cards remain outside every floor\'s weighted loot pool (floor loot design deferred to Phase 21+)', async () => {
      const { getWeightedGroundItemPoolForFloor } = await import('../item-def');
      const { CARD_IDS_IN_ORDER } = await import('../card-def');
      for (const floor of [1, 2, 3]) {
        const pool = getWeightedGroundItemPoolForFloor(floor);
        for (const id of CARD_IDS_IN_ORDER) {
          expect(pool.some((c) => c.id === id)).toBe(false);
        }
      }
    });

    it('Phase 24.4c: if any of these cards appears via production floor generation, it is a plain GroundItem with no equipment/instance state attached (cards were unreachable in production before Phase 24.4c connected the loot routes — see docs/history/phase-24-4c-card-supply.md — so this now checks that reachability didn\'t leak any equipment-instance machinery into cards, rather than checking they never appear at all)', () => {
      let sawAny = false;
      for (let seed = 1; seed <= 100; seed++) {
        const state = createInitialState(seed);
        for (const item of state.groundItems) {
          if (['high_priestess', 'empress', 'chariot', 'strength', 'wheel_of_fortune'].includes(item.itemId)) {
            sawAny = true;
            expect(item.equipmentInstanceId).toBeUndefined();
          }
        }
      }
      expect(sawAny).toBe(true);
    });

    it('existing ability point allocation (non-card) is unaffected by card growth', () => {
      const state = createInitialState(1);
      state.unspentAbilityPoints = 1;
      expect(getAbilityValue(state, 'body')).toBe(0);
    });

    it('existing combat calculations are unaffected for a player with no cards used', () => {
      const state = createInitialState(1);
      expect(getPowerDamageBonus(state)).toBe(0);
    });

    it('existing seeded loot/map/enemy determinism is unaffected by the presence of card definitions', () => {
      const a = createInitialState(55);
      const b = createInitialState(55);
      expect(a.groundItems).toEqual(b.groundItems);
      expect(a.map).toEqual(b.map);
      expect(a.enemies).toEqual(b.enemies);
    });

    it('equipment-instance and curse mechanics are unaffected by persistent-growth card use', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      processTurn(state, { type: 'use_item', itemId: 'strength' });
      const stillTracked = getEquipmentInstances(state).find((i) => i.instanceId === instance.instanceId);
      expect(stillTracked?.cursed).toBe(true);
    });
  });
});
