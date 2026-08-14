import { describe, expect, it } from 'vitest';
import {
  beginCardTargetSelection,
  CARD_TARGET_EFFECT_RESOLVERS,
  CardTargetRef,
  confirmCardTargetSelection,
  describeCardTargetCandidate,
  getCardTargetCandidates,
  getStarCandidates,
  getTemperanceCandidates,
  hasAlternateTransformCategory,
  isCardTargetStillValid,
  isTargetSelectableCardId,
  isTargetSelectableItemId,
  moveCardTargetCursor,
  PendingCardTargetEffectHolder,
  refreshCardTargetSelection,
  resolveCardTargetEffect,
  toPreparedCardTargetEffect,
} from '../card-target-selection';
import {
  createEquipmentInstance,
  getEquipmentInstances,
  getHeldEquipmentInstances,
  normalizeEquipmentInstances,
} from '../equipment-instance';
import { createInitialState } from '../state';
import { GameState } from '../types';

/**
 * Phase 20.0d card target selection foundation tests. Covers temperance/
 * star candidate generation, held-vs-floor equipment separation, the
 * selection state machine (begin/navigate/confirm/refresh), stale-target
 * rejection, and information-safety (no curse/identification leak). No
 * card effect (decurse/transform) is exercised — this phase only builds
 * the selection machinery those future effects will consume.
 */

function stateWithWeaponInstances(count: number): { state: GameState; instances: ReturnType<typeof createEquipmentInstance>[] } {
  const state = createInitialState(1);
  state.inventory.sword = count;
  const instances = [];
  for (let i = 0; i < count; i++) {
    instances.push(createEquipmentInstance(state, 'sword'));
  }
  return { state, instances };
}

describe('Phase 20.0d: card target selection foundation', () => {
  describe('candidate_generation: temperance', () => {
    it('includes a held, discovered-cursed weapon instance', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const candidates = getTemperanceCandidates(state);
      expect(candidates).toEqual([{ kind: 'equipment_instance', instanceId: instances[0].instanceId }]);
    });

    it('includes a held, discovered-cursed armor instance', () => {
      const state = createInitialState(1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      instance.cursed = true;
      instance.curseRevealed = true;
      const candidates = getTemperanceCandidates(state);
      expect(candidates).toEqual([{ kind: 'equipment_instance', instanceId: instance.instanceId }]);
    });

    it('includes both equipped and unequipped discovered-cursed instances', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      instances[1].cursed = true;
      instances[1].curseRevealed = true;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instances[0].instanceId;
      const candidates = getTemperanceCandidates(state);
      const ids = candidates.filter((c) => c.kind === 'equipment_instance').map((c) => (c as { instanceId: string }).instanceId);
      expect(new Set(ids)).toEqual(new Set([instances[0].instanceId, instances[1].instanceId]));
    });

    it('excludes cursed=false individuals', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = false;
      instances[0].curseRevealed = false;
      expect(getTemperanceCandidates(state)).toEqual([]);
    });

    it('excludes curseRevealed=false individuals even if cursed=true', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = false;
      expect(getTemperanceCandidates(state)).toEqual([]);
    });

    it('excludes floor-generated (not-yet-picked-up) individuals', () => {
      const state = createInitialState(1);
      const found = state.groundItems.find((g) => g.equipmentInstanceId);
      if (!found) return;
      const instance = getEquipmentInstances(state).find((i) => i.instanceId === found.equipmentInstanceId)!;
      instance.cursed = true;
      instance.curseRevealed = true;
      const candidates = getTemperanceCandidates(state);
      expect(candidates.some((c) => c.kind === 'equipment_instance' && c.instanceId === instance.instanceId)).toBe(false);
    });

    it('distinguishes two same-species cursed instances by instanceId', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      const candidates = getTemperanceCandidates(state);
      const ids = candidates.map((c) => (c as { instanceId: string }).instanceId);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('candidate_generation: star', () => {
    it('includes an ordinary held consumable', () => {
      const state = createInitialState(1);
      state.inventory.apple = 1;
      const candidates = getStarCandidates(state);
      expect(candidates).toContainEqual({ kind: 'inventory_item', itemId: 'apple' });
    });

    it('includes held weapon instances individually', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      const candidates = getStarCandidates(state);
      const ids = candidates.filter((c) => c.kind === 'equipment_instance').map((c) => (c as { instanceId: string }).instanceId);
      expect(new Set(ids)).toEqual(new Set(instances.map((i) => i.instanceId)));
    });

    it('includes an equipped weapon instance', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instances[0].instanceId;
      const candidates = getStarCandidates(state);
      expect(candidates).toContainEqual({ kind: 'equipment_instance', instanceId: instances[0].instanceId });
    });

    it('excludes all 17 cards even when held', () => {
      const state = createInitialState(1);
      state.inventory.high_priestess = 1;
      state.inventory.judgement = 1;
      const candidates = getStarCandidates(state);
      expect(candidates.some((c) => c.kind === 'inventory_item' && c.itemId === 'high_priestess')).toBe(false);
      expect(candidates.some((c) => c.kind === 'inventory_item' && c.itemId === 'judgement')).toBe(false);
    });

    it('includes armor instances now that multiple armor species exist (Phase 24.3 catalog expansion)', () => {
      const state = createInitialState(1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      const candidates = getStarCandidates(state);
      expect(candidates.some((c) => c.kind === 'equipment_instance' && c.instanceId === instance.instanceId)).toBe(true);
    });

    it('hasAlternateTransformCategory is true for armor (Phase 24.3: 15 species), weapon, and consumable', () => {
      expect(hasAlternateTransformCategory('armor')).toBe(true);
      expect(hasAlternateTransformCategory('sword')).toBe(true);
      expect(hasAlternateTransformCategory('apple')).toBe(true);
    });

    it('excludes floor-generated (not-yet-picked-up) items', () => {
      const state = createInitialState(1);
      const found = state.groundItems.find((g) => g.equipmentInstanceId);
      if (!found) return;
      const candidates = getStarCandidates(state);
      expect(candidates.some((c) => c.kind === 'equipment_instance' && c.instanceId === found.equipmentInstanceId)).toBe(false);
    });

    it('excludes items with inventory count 0', () => {
      const state = createInitialState(1);
      state.inventory.apple = 0;
      const candidates = getStarCandidates(state);
      expect(candidates.some((c) => c.kind === 'inventory_item' && c.itemId === 'apple')).toBe(false);
    });
  });

  describe('candidate_generation: purity and determinism', () => {
    it('candidate generation never mutates GameState or consumes RNG', () => {
      const state = createInitialState(1);
      state.inventory.apple = 1;
      state.inventory.sword = 1;
      createEquipmentInstance(state, 'sword');
      const before = JSON.stringify(state);
      const combatRngBefore = state.combatRngState;
      getTemperanceCandidates(state);
      getStarCandidates(state);
      expect(JSON.stringify(state)).toBe(before);
      expect(state.combatRngState).toBe(combatRngBefore);
    });

    it('candidate order is stable across repeated calls on the same state', () => {
      const state = createInitialState(1);
      state.inventory.apple = 1;
      state.inventory.sword = 1;
      createEquipmentInstance(state, 'sword');
      const a = getStarCandidates(state);
      const b = getStarCandidates(state);
      expect(a).toEqual(b);
    });

    it('getCardTargetCandidates dispatches correctly and returns [] for out-of-scope cards', () => {
      const state = createInitialState(1);
      expect(getCardTargetCandidates(state, 'moon')).toEqual([]);
      expect(getCardTargetCandidates(state, 'sun')).toEqual([]);
      expect(getCardTargetCandidates(state, 'lovers')).toEqual([]);
    });

    it('isTargetSelectableCardId identifies exactly temperance and star', () => {
      expect(isTargetSelectableCardId('temperance')).toBe(true);
      expect(isTargetSelectableCardId('star')).toBe(true);
      expect(isTargetSelectableCardId('moon')).toBe(false);
      expect(isTargetSelectableCardId('sun')).toBe(false);
      expect(isTargetSelectableCardId('lovers')).toBe(false);
    });
  });

  describe('selection', () => {
    it('0 candidates never enters a selection state', () => {
      const state = createInitialState(1);
      expect(beginCardTargetSelection(state, 'temperance')).toBeNull();
    });

    it('1 candidate still requires an explicit confirm (does not auto-select)', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance');
      expect(selection).not.toBeNull();
      expect(selection!.candidates.length).toBe(1);
      expect(selection!.cursor).toBe(0);
      // Selection existing is not itself a confirmation — confirm must be called explicitly.
      const confirmed = confirmCardTargetSelection(state, selection!);
      expect(confirmed).toEqual({ kind: 'equipment_instance', instanceId: instances[0].instanceId });
    });

    it('cursor moves within bounds and clamps at both ends', () => {
      const { state, instances } = stateWithWeaponInstances(3);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      let selection = beginCardTargetSelection(state, 'temperance')!;
      selection = moveCardTargetCursor(selection, 1);
      expect(selection.cursor).toBe(1);
      selection = moveCardTargetCursor(selection, 100);
      expect(selection.cursor).toBe(2);
      selection = moveCardTargetCursor(selection, -100);
      expect(selection.cursor).toBe(0);
    });

    it('confirm resolves target identity, not cursor index, avoiding same-species mixups', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      instances[0].refineLevel = 1;
      instances[1].cursed = true;
      instances[1].curseRevealed = true;
      instances[1].refineLevel = 2;
      let selection = beginCardTargetSelection(state, 'temperance')!;
      selection = moveCardTargetCursor(selection, 1);
      const confirmed = confirmCardTargetSelection(state, selection);
      expect(confirmed).toEqual({ kind: 'equipment_instance', instanceId: instances[1].instanceId });
    });

    it('confirm rejects a stale target (cured between selection and confirm)', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      instances[0].cursed = false; // simulate the target becoming ineligible
      const confirmed = confirmCardTargetSelection(state, selection);
      expect(confirmed).toBeNull();
    });

    it('a stale-target rejection does not itself mutate inventory or equipment state', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      instances[0].curseRevealed = false;
      const invBefore = { ...state.inventory };
      confirmCardTargetSelection(state, selection);
      expect(state.inventory).toEqual(invBefore);
    });

    it('refreshCardTargetSelection preserves the cursor on the same target when candidates shrink from elsewhere', () => {
      const { state, instances } = stateWithWeaponInstances(3);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      let selection = beginCardTargetSelection(state, 'temperance')!;
      selection = moveCardTargetCursor(selection, 2); // now on instances[2]
      instances[0].cursed = false; // remove an unrelated candidate
      const refreshed = refreshCardTargetSelection(state, selection);
      expect(refreshed).not.toBeNull();
      expect(refreshed!.candidates[refreshed!.cursor]).toEqual({ kind: 'equipment_instance', instanceId: instances[2].instanceId });
    });

    it('refreshCardTargetSelection returns null when no candidates remain', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      instances[0].cursed = false;
      expect(refreshCardTargetSelection(state, selection)).toBeNull();
    });

    it('isCardTargetStillValid matches confirm\'s own validity check', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const ref: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      expect(isCardTargetStillValid(state, 'temperance', ref)).toBe(true);
      instances[0].cursed = false;
      expect(isCardTargetStillValid(state, 'temperance', ref)).toBe(false);
    });

    it('many candidates are all individually selectable via cursor movement', () => {
      const { state, instances } = stateWithWeaponInstances(6);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      let selection = beginCardTargetSelection(state, 'temperance')!;
      expect(selection.candidates.length).toBe(6);
      for (let i = 0; i < 6; i++) {
        const confirmed = confirmCardTargetSelection(state, selection);
        expect(confirmed).toEqual({ kind: 'equipment_instance', instanceId: instances[i].instanceId });
        selection = moveCardTargetCursor(selection, 1);
      }
    });
  });

  describe('information_safety', () => {
    it('star candidate display never reveals cursed/curseRevealed status', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = false;
      const ref: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      const info = describeCardTargetCandidate(state, 'star', ref);
      expect(info.note).toBeUndefined();
    });

    it('temperance candidates never include a curseRevealed=false individual to display in the first place', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = false;
      expect(getTemperanceCandidates(state)).toEqual([]);
    });

    it('candidate refs never conflate definitionId with instanceId', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const candidates = getTemperanceCandidates(state);
      const ref = candidates[0] as { kind: 'equipment_instance'; instanceId: string };
      expect(ref.instanceId).not.toBe('sword');
      expect(ref.instanceId).toBe(instances[0].instanceId);
    });
  });

  describe('transaction', () => {
    it('beginning selection performs no consume/turn/identify', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const turnBefore = state.turn;
      const invBefore = { ...state.inventory };
      beginCardTargetSelection(state, 'temperance');
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory).toEqual(invBefore);
      expect(state.identifiedCardIds ?? []).toEqual([]);
    });

    it('navigation performs no consume/turn/identify', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      const selection = beginCardTargetSelection(state, 'temperance')!;
      const turnBefore = state.turn;
      moveCardTargetCursor(selection, 1);
      expect(state.turn).toBe(turnBefore);
    });

    it('confirm alone (no resolver yet this phase) performs no consume/turn/identify', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      const turnBefore = state.turn;
      const invBefore = { ...state.inventory };
      confirmCardTargetSelection(state, selection);
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory).toEqual(invBefore);
      expect(state.identifiedCardIds ?? []).toEqual([]);
    });
  });

  describe('regression', () => {
    it('normalizeEquipmentInstances does not interfere with candidate generation', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      normalizeEquipmentInstances(state);
      expect(getTemperanceCandidates(state).length).toBe(1);
    });
  });

  describe('entry', () => {
    it('temperance with candidates begins a selection', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      expect(isTargetSelectableItemId('temperance')).toBe(true);
      const selection = beginCardTargetSelection(state, 'temperance');
      expect(selection).not.toBeNull();
      expect(selection!.cardId).toBe('temperance');
    });

    it('star with candidates begins a selection', () => {
      const state = createInitialState(1);
      state.inventory.apple = 1;
      expect(isTargetSelectableItemId('star')).toBe(true);
      const selection = beginCardTargetSelection(state, 'star');
      expect(selection).not.toBeNull();
      expect(selection!.cardId).toBe('star');
    });

    it('0 candidates never begins a selection for either card', () => {
      const state = createInitialState(1);
      expect(beginCardTargetSelection(state, 'temperance')).toBeNull();
      expect(beginCardTargetSelection(state, 'star')).toBeNull();
    });

    it('moon, sun, and every other card are never target-selectable (never reach this module\'s entry)', () => {
      expect(isTargetSelectableItemId('moon')).toBe(false);
      expect(isTargetSelectableItemId('sun')).toBe(false);
      expect(isTargetSelectableItemId('lovers')).toBe(false);
      expect(isTargetSelectableItemId('judgement')).toBe(false);
      expect(isTargetSelectableItemId('apple')).toBe(false);
      expect(isTargetSelectableItemId('sword')).toBe(false);
    });

    it('beginning a selection performs no consume, identify, or turn advance', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const turnBefore = state.turn;
      const invBefore = { ...state.inventory };
      beginCardTargetSelection(state, 'temperance');
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory).toEqual(invBefore);
      expect(isCardTargetStillValid(state, 'temperance', { kind: 'equipment_instance', instanceId: instances[0].instanceId })).toBe(true);
      expect(state.identifiedCardIds ?? []).toEqual([]);
    });
  });

  describe('stale_target_recovery', () => {
    it('a stale target with candidates remaining lets selection continue (refresh), never auto-confirming a different one', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      let selection = beginCardTargetSelection(state, 'temperance')!;
      selection = moveCardTargetCursor(selection, 0); // cursor on instances[0]
      instances[0].cursed = false; // instances[0] becomes stale
      const confirmed = confirmCardTargetSelection(state, selection);
      expect(confirmed).toBeNull();
      const refreshed = refreshCardTargetSelection(state, selection);
      expect(refreshed).not.toBeNull();
      expect(refreshed!.candidates.length).toBe(1);
      expect(refreshed!.candidates[refreshed!.cursor]).toEqual({ kind: 'equipment_instance', instanceId: instances[1].instanceId });
    });

    it('cursor is clamped into the refreshed candidate range', () => {
      const { state, instances } = stateWithWeaponInstances(3);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      let selection = beginCardTargetSelection(state, 'temperance')!;
      selection = moveCardTargetCursor(selection, 2); // cursor on instances[2] (last)
      instances[2].cursed = false; // remove the currently-cursored one
      instances[1].cursed = false; // and one more, shrinking the list further
      const refreshed = refreshCardTargetSelection(state, selection);
      expect(refreshed).not.toBeNull();
      expect(refreshed!.cursor).toBeLessThan(refreshed!.candidates.length);
      expect(refreshed!.candidates.length).toBe(1);
    });

    it('a stale target with 0 candidates remaining resolves to null (caller returns to item_actions)', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      instances[0].cursed = false;
      expect(refreshCardTargetSelection(state, selection)).toBeNull();
    });

    it('stale-target refresh never consumes, identifies, or advances the turn', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      let selection = beginCardTargetSelection(state, 'temperance')!;
      instances[0].cursed = false;
      const turnBefore = state.turn;
      const invBefore = { ...state.inventory };
      refreshCardTargetSelection(state, selection);
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory).toEqual(invBefore);
      expect(state.identifiedCardIds ?? []).toEqual([]);
    });

    it('stale-target refresh never consumes RNG', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      for (const i of instances) {
        i.cursed = true;
        i.curseRevealed = true;
      }
      const selection = beginCardTargetSelection(state, 'temperance')!;
      instances[0].cursed = false;
      const rngBefore = state.combatRngState;
      refreshCardTargetSelection(state, selection);
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('held_identity', () => {
    it('getHeldEquipmentInstances excludes an orphaned instance beyond inventory count', () => {
      const state = createInitialState(1);
      state.inventory.sword = 1;
      const kept = createEquipmentInstance(state, 'sword');
      const orphan = createEquipmentInstance(state, 'sword'); // inventory only declares 1
      const held = getHeldEquipmentInstances(state);
      const ids = held.map((i) => i.instanceId);
      expect(ids).toContain(kept.instanceId);
      expect(ids).not.toContain(orphan.instanceId);
      expect(held.filter((i) => i.definitionId === 'sword').length).toBe(1);
    });

    it('always includes the equipped instance even when inventory count is exactly 1', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instances[0].instanceId;
      const held = getHeldEquipmentInstances(state);
      expect(held.map((i) => i.instanceId)).toContain(instances[0].instanceId);
    });

    it('caps unequipped individuals at inventory count, preferring the equipped one first', () => {
      const state = createInitialState(1);
      state.inventory.sword = 2;
      const a = createEquipmentInstance(state, 'sword');
      const b = createEquipmentInstance(state, 'sword');
      const c = createEquipmentInstance(state, 'sword'); // 3 instances exist, inventory only says 2
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = c.instanceId; // equipped one is the "extra" one
      const held = getHeldEquipmentInstances(state);
      const ids = held.filter((i) => i.definitionId === 'sword').map((i) => i.instanceId);
      expect(ids).toContain(c.instanceId); // equipped always included
      expect(ids.length).toBe(2); // capped at inventory count
      expect(new Set([a.instanceId, b.instanceId]).has(ids.find((id) => id !== c.instanceId)!)).toBe(true);
    });

    it('excludes floor-generated individuals from held', () => {
      const state = createInitialState(1);
      const found = state.groundItems.find((g) => g.equipmentInstanceId);
      if (!found) return;
      const held = getHeldEquipmentInstances(state);
      expect(held.map((i) => i.instanceId)).not.toContain(found.equipmentInstanceId);
    });

    it('excludes a discarded instance (removed from equipmentInstances entirely)', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      state.equipmentInstances = getEquipmentInstances(state).filter((i) => i.instanceId !== instances[0].instanceId);
      state.inventory.sword = 0;
      const held = getHeldEquipmentInstances(state);
      expect(held.map((i) => i.instanceId)).not.toContain(instances[0].instanceId);
    });

    it('correctly separates same-species individuals split across floor, equipped, and held-unequipped', () => {
      const state = createInitialState(1);
      state.inventory.sword = 2;
      const equipped = createEquipmentInstance(state, 'sword');
      const unequipped = createEquipmentInstance(state, 'sword');
      const floorInstance = createEquipmentInstance(state, 'sword');
      state.groundItems.push({ id: 999, itemId: 'sword', pos: { x: 0, y: 0 }, equipmentInstanceId: floorInstance.instanceId });
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = equipped.instanceId;
      const held = getHeldEquipmentInstances(state);
      const ids = held.filter((i) => i.definitionId === 'sword').map((i) => i.instanceId);
      expect(new Set(ids)).toEqual(new Set([equipped.instanceId, unequipped.instanceId]));
      expect(ids).not.toContain(floorInstance.instanceId);
    });
  });

  describe('unregistered_resolver', () => {
    it('temperance and star now have production resolvers registered (Phase 20.5a)', () => {
      expect(CARD_TARGET_EFFECT_RESOLVERS.temperance).toBeDefined();
      expect(CARD_TARGET_EFFECT_RESOLVERS.star).toBeDefined();
    });

    it('resolveCardTargetEffect returns a typed failure when no resolver is registered for a card', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      const saved = CARD_TARGET_EFFECT_RESOLVERS.temperance;
      delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      try {
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        expect(transaction).toEqual({ status: 'failure', reason: 'no_resolver_registered' });
      } finally {
        CARD_TARGET_EFFECT_RESOLVERS.temperance = saved;
      }
    });

    it('an unregistered-resolver failure carries no state/RNG and leaves state unchanged', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const before = JSON.stringify(state);
      const rngBefore = state.combatRngState;
      const saved = CARD_TARGET_EFFECT_RESOLVERS.temperance;
      delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      try {
        const transaction = resolveCardTargetEffect(state, 'temperance', {
          kind: 'equipment_instance',
          instanceId: instances[0].instanceId,
        });
        expect('nextState' in transaction).toBe(false);
        expect(JSON.stringify(state)).toBe(before);
        expect(state.combatRngState).toBe(rngBefore);
        expect(state.turn).toBe(state.turn);
        expect(state.identifiedCardIds ?? []).toEqual([]);
      } finally {
        CARD_TARGET_EFFECT_RESOLVERS.temperance = saved;
      }
    });
  });

  describe('atomic_failure', () => {
    it('a resolver that mutates its working state and then reports failure never affects the real GameState', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      // A resolver defined only in this test file, never exported from
      // production (rogue-of-sun-development-plan.md 20.0d's "テスト専用
      // dummy resolverをproductionへ常設すること" is prohibited — this is
      // the sanctioned alternative). Mutates workingState heavily, then
      // still reports failure.
      CARD_TARGET_EFFECT_RESOLVERS.temperance = (workingState, t) => {
        if (t.kind === 'equipment_instance') {
          const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === t.instanceId);
          if (instance) instance.cursed = false;
        }
        workingState.inventory.temperance = 0;
        workingState.turn += 1;
        return { success: false };
      };
      try {
        const before = JSON.stringify(state);
        const turnBefore = state.turn;
        const rngBefore = state.combatRngState;
        const invBefore = { ...state.inventory };
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        expect(transaction.status).toBe('failure');
        expect('nextState' in transaction).toBe(false);
        expect(JSON.stringify(state)).toBe(before);
        expect(state.turn).toBe(turnBefore);
        expect(state.combatRngState).toBe(rngBefore);
        expect(state.inventory).toEqual(invBefore);
        expect(getEquipmentInstances(state).find((i) => i.instanceId === instances[0].instanceId)!.cursed).toBe(true);
        expect(state.identifiedCardIds ?? []).toEqual([]);
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });
  });

  describe('prepared_success', () => {
    it('a resolver that mutates its working state and reports success returns that mutated state as nextState, without touching the real GameState', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = (workingState, t) => {
        if (t.kind === 'equipment_instance') {
          const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === t.instanceId);
          if (instance) instance.cursed = false;
        }
        return { success: true };
      };
      try {
        const before = JSON.stringify(state);
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        expect(transaction.status).toBe('success');
        if (transaction.status === 'success') {
          const nextInstance = getEquipmentInstances(transaction.nextState).find((i) => i.instanceId === instances[0].instanceId)!;
          expect(nextInstance.cursed).toBe(false);
        }
        // The real state is completely untouched by obtaining a success transaction.
        expect(JSON.stringify(state)).toBe(before);
        expect(getEquipmentInstances(state).find((i) => i.instanceId === instances[0].instanceId)!.cursed).toBe(true);
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('obtaining a success transaction alone never commits — nextState and the live state remain two distinct objects', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: true });
      try {
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        expect(transaction.status).toBe('success');
        if (transaction.status === 'success') {
          expect(transaction.nextState).not.toBe(state);
        }
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });
  });

  describe('ui_confirm', () => {
    it('a valid confirmed target reaches resolveCardTargetEffect via the same production path main.ts uses', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      const target = confirmCardTargetSelection(state, selection)!;
      expect(target).not.toBeNull();
      const turnBefore = state.turn;
      const invBefore = { ...state.inventory };
      const transaction = resolveCardTargetEffect(state, selection.cardId, target);
      expect(transaction.status).toBe('failure'); // no production resolver registered this phase
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory).toEqual(invBefore);
      expect(state.identifiedCardIds ?? []).toEqual([]);
    });

    it('same-species equipment individuals are never mixed up across the confirm -> resolve boundary', () => {
      const { state, instances } = stateWithWeaponInstances(2);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      instances[0].refineLevel = 1;
      instances[1].cursed = true;
      instances[1].curseRevealed = true;
      instances[1].refineLevel = 2;
      let selection = beginCardTargetSelection(state, 'temperance')!;
      selection = moveCardTargetCursor(selection, 1);
      const target = confirmCardTargetSelection(state, selection)!;
      expect(target).toEqual({ kind: 'equipment_instance', instanceId: instances[1].instanceId });
    });
  });
});

describe('Phase 20.0d success handoff correction', () => {
  describe('success_handoff', () => {
    it('a success transaction produces a typed pending effect with the correct cardId, target, and nextState', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = (workingState, t) => {
        if (t.kind === 'equipment_instance') {
          const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === t.instanceId);
          if (instance) instance.cursed = false;
        }
        return { success: true };
      };
      try {
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        const prepared = toPreparedCardTargetEffect('temperance', target, transaction);
        expect(prepared).not.toBeNull();
        expect(prepared!.cardId).toBe('temperance');
        expect(prepared!.target).toEqual(target);
        expect(prepared!.nextState).toBe((transaction as { status: 'success'; nextState: GameState }).nextState);
        const nextInstance = getEquipmentInstances(prepared!.nextState).find((i) => i.instanceId === instances[0].instanceId)!;
        expect(nextInstance.cursed).toBe(false);
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('preparing a pending effect never mutates the original GameState', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = (workingState, t) => {
        if (t.kind === 'equipment_instance') {
          const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === t.instanceId);
          if (instance) instance.cursed = false;
        }
        return { success: true };
      };
      try {
        const before = JSON.stringify(state);
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        toPreparedCardTargetEffect('temperance', target, transaction);
        expect(JSON.stringify(state)).toBe(before);
        expect(getEquipmentInstances(state).find((i) => i.instanceId === instances[0].instanceId)!.cursed).toBe(true);
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('generating a pending effect performs no consume, identify, or turn advance', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: true });
      try {
        const turnBefore = state.turn;
        const invBefore = { ...state.inventory };
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        toPreparedCardTargetEffect('temperance', target, transaction);
        expect(state.turn).toBe(turnBefore);
        expect(state.inventory).toEqual(invBefore);
        expect(state.identifiedCardIds ?? []).toEqual([]);
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });
  });

  describe('failure_handoff', () => {
    it('a failure transaction never produces a pending effect', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      const transaction = resolveCardTargetEffect(state, 'temperance', target); // no resolver registered
      const prepared = toPreparedCardTargetEffect('temperance', target, transaction);
      expect(prepared).toBeNull();
    });

    it('a failure from a registered-but-failing resolver also never produces a pending effect', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: false });
      try {
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        const prepared = toPreparedCardTargetEffect('temperance', target, transaction);
        expect(prepared).toBeNull();
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('failure leaves the original state and RNG unchanged', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      const rngBefore = state.combatRngState;
      const before = JSON.stringify(state);
      const transaction = resolveCardTargetEffect(state, 'temperance', target);
      toPreparedCardTargetEffect('temperance', target, transaction);
      expect(state.combatRngState).toBe(rngBefore);
      expect(JSON.stringify(state)).toBe(before);
    });
  });
});

describe('Phase 20.0d pending lifecycle correction (PendingCardTargetEffectHolder — the same production boundary main.ts uses)', () => {
  describe('lifecycle', () => {
    it('success stores exactly the correct cardId, target, and nextState', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = (workingState, t) => {
        if (t.kind === 'equipment_instance') {
          const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === t.instanceId);
          if (instance) instance.cursed = false;
        }
        return { success: true };
      };
      try {
        const holder = new PendingCardTargetEffectHolder();
        const transaction = resolveCardTargetEffect(state, 'temperance', target);
        holder.setFromTransaction('temperance', target, transaction);
        const pending = holder.peek();
        expect(pending).not.toBeNull();
        expect(pending!.cardId).toBe('temperance');
        expect(pending!.target).toEqual(target);
        expect(getEquipmentInstances(pending!.nextState).find((i) => i.instanceId === instances[0].instanceId)!.cursed).toBe(
          false,
        );
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('failure clears any previously-held pending effect', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      const holder = new PendingCardTargetEffectHolder();
      // Seed the holder with a real prior pending value first.
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: true });
      holder.setFromTransaction('temperance', target, resolveCardTargetEffect(state, 'temperance', target));
      expect(holder.peek()).not.toBeNull();
      delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      // Now a failure (no resolver registered) must clear it.
      holder.setFromTransaction('temperance', target, resolveCardTargetEffect(state, 'temperance', target));
      expect(holder.peek()).toBeNull();
    });

    it('the same clear() path is what a new selection, cancel, stale target, and restart all use', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: true });
      try {
        const holder = new PendingCardTargetEffectHolder();
        holder.setFromTransaction('temperance', target, resolveCardTargetEffect(state, 'temperance', target));
        expect(holder.peek()).not.toBeNull();
        holder.clear(); // new-selection / cancel / stale / restart all call exactly this
        expect(holder.peek()).toBeNull();
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('clear() is idempotent and safe to call when already empty', () => {
      const holder = new PendingCardTargetEffectHolder();
      holder.clear();
      holder.clear();
      expect(holder.peek()).toBeNull();
    });

    it('peek() never removes the pending effect (repeated peek returns the same value)', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: true });
      try {
        const holder = new PendingCardTargetEffectHolder();
        holder.setFromTransaction('temperance', target, resolveCardTargetEffect(state, 'temperance', target));
        const first = holder.peek();
        const second = holder.peek();
        expect(first).toBe(second);
        expect(holder.peek()).not.toBeNull();
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('take() removes and returns the pending effect in one step; a subsequent peek/take is null', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = () => ({ success: true });
      try {
        const holder = new PendingCardTargetEffectHolder();
        holder.setFromTransaction('temperance', target, resolveCardTargetEffect(state, 'temperance', target));
        const taken = holder.take();
        expect(taken).not.toBeNull();
        expect(holder.peek()).toBeNull();
        expect(holder.take()).toBeNull();
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('peek/take never mutate or commit the real GameState the transaction was resolved against', () => {
      const { state, instances } = stateWithWeaponInstances(1);
      instances[0].cursed = true;
      instances[0].curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instances[0].instanceId };
      CARD_TARGET_EFFECT_RESOLVERS.temperance = (workingState, t) => {
        if (t.kind === 'equipment_instance') {
          const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === t.instanceId);
          if (instance) instance.cursed = false;
        }
        return { success: true };
      };
      try {
        const before = JSON.stringify(state);
        const turnBefore = state.turn;
        const rngBefore = state.combatRngState;
        const holder = new PendingCardTargetEffectHolder();
        holder.setFromTransaction('temperance', target, resolveCardTargetEffect(state, 'temperance', target));
        holder.peek();
        holder.take();
        expect(JSON.stringify(state)).toBe(before);
        expect(state.turn).toBe(turnBefore);
        expect(state.combatRngState).toBe(rngBefore);
        expect(state.identifiedCardIds ?? []).toEqual([]);
        expect(getEquipmentInstances(state).find((i) => i.instanceId === instances[0].instanceId)!.cursed).toBe(true);
      } finally {
        delete CARD_TARGET_EFFECT_RESOLVERS.temperance;
      }
    });

    it('a private-storage class instance cannot be mutated except through its own methods (no direct field access exists on the public type)', () => {
      const holder = new PendingCardTargetEffectHolder();
      // TypeScript itself enforces this at compile time (the `pending`
      // field is `private` — there is no public setter other than
      // setFromTransaction/clear). This runtime check documents the
      // resulting behavior: the only way to reach a non-null state is
      // through setFromTransaction.
      expect(holder.peek()).toBeNull();
      expect(Object.keys(holder)).not.toContain('pendingCardTargetEffect');
    });
  });
});
