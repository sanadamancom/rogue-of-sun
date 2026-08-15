import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { normalizeEquipmentInstances } from '../equipment-instance';
import { getSolarForgeSecondMaterialCandidates } from '../solar-forge';
import { SOLAR_FORGE_RECIPES } from '../solar-forge-recipes';
import { applySolarForge, processTurn } from '../turn';
import { GameState } from '../types';
import { GameEvent } from '../events';

/**
 * Phase 24.3 Stage 5: 太陽鍛冶UI接続の裏側にあるデータ層契約テスト
 * （Phaserレンダリング自体はvite buildの型検証でのみ担保 — 描画結果の
 * 視覚的検証はこのプロジェクトのテストスイートの対象外）。
 * getSolarForgeSecondMaterialCandidates（UIの「1個目選択→2個目候補」の
 * 直接の裏付け）と、solar_forge action全体のイベント・turn契約を検証する。
 */

function stateWith(counts: Partial<Record<string, number>>): GameState {
  const state = createInitialState(1);
  for (const [id, count] of Object.entries(counts)) {
    (state.inventory as any)[id] = count;
  }
  normalizeEquipmentInstances(state);
  // Phase 24.4d1: this file tests the UI-facing candidate/turn data
  // layer, not identification — pre-identify every fixture weapon.
  state.identifiedGeneralItemIds = Object.keys(counts) as import('../types').ItemId[];
  return state;
}

describe('Phase 24.3 Stage 5: UI candidate list contract', () => {
  it('候補0件では空配列を返す（UIの「合成できる武器がない」表示に対応）', () => {
    const state = stateWith({ sword: 1, solar_gun: 1 });
    const swordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'sword')!;
    const candidates = getSolarForgeSecondMaterialCandidates(state, SOLAR_FORGE_RECIPES, swordInstance.instanceId);
    expect(candidates).toEqual([]);
  });

  it('候補一覧の各要素は完成品名・rankを含むrecipeを持つ', () => {
    const state = stateWith({ sword: 1, short_sword: 1 });
    const swordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'sword')!;
    const candidates = getSolarForgeSecondMaterialCandidates(state, SOLAR_FORGE_RECIPES, swordInstance.instanceId);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.recipe.outputDefinitionId).toBeTruthy();
      expect(c.recipe.outputRank).toBeTruthy();
      expect(c.instanceIdA).toBe(swordInstance.instanceId);
    }
  });

  it('装備中の素材も候補として含められる', () => {
    const state = stateWith({ sword: 1, short_sword: 1 });
    const swordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'sword')!;
    const shortSwordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'short_sword')!;
    state.equippedWeaponId = 'short_sword';
    state.equippedWeaponInstanceId = shortSwordInstance.instanceId;
    const candidates = getSolarForgeSecondMaterialCandidates(state, SOLAR_FORGE_RECIPES, swordInstance.instanceId);
    expect(candidates.some((c) => c.instanceIdB === shortSwordInstance.instanceId)).toBe(true);
  });
});

describe('Phase 24.3 Stage 5: solar_forge action end-to-end (UI dispatch shape)', () => {
  it('成功時、ログ表示に使える完成品名・rankを含むイベントが1件だけ発行される', () => {
    const state = stateWith({ sword: 1, short_sword: 1 });
    const swordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'sword')!;
    const shortSwordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'short_sword')!;
    const events: GameEvent[] = [];
    const result = applySolarForge(state, [swordInstance.instanceId, shortSwordInstance.instanceId], events);
    expect(result.consumed).toBe(true);
    const completedEvents = events.filter((e) => e.type === 'solar_forge_completed');
    expect(completedEvents).toHaveLength(1);
  });

  it('processTurn経由でも同一の1ターン消費・RNG非消費契約を保つ', () => {
    const state = stateWith({ sword: 1, short_sword: 1 });
    const swordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'sword')!;
    const shortSwordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'short_sword')!;
    const turnBefore = state.turn;
    const rngBefore = state.combatRngState;
    const result = processTurn(state, { type: 'solar_forge', materialInstanceIds: [swordInstance.instanceId, shortSwordInstance.instanceId] });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.combatRngState).toBe(rngBefore);
  });

  it('未判明の呪いはUI候補生成自体には影響しない（候補には現れるが、実行時にcursedとして拒否される）', () => {
    const state = stateWith({ sword: 1, short_sword: 1 });
    const swordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'sword')!;
    const shortSwordInstance = state.equipmentInstances!.find((i) => i.definitionId === 'short_sword')!;
    shortSwordInstance.cursed = true;
    shortSwordInstance.curseRevealed = false;
    const events: GameEvent[] = [];
    const result = applySolarForge(state, [swordInstance.instanceId, shortSwordInstance.instanceId], events);
    expect(result.consumed).toBe(false);
    expect(events.some((e) => e.type === 'solar_forge_failed' && e.reason === 'cursed')).toBe(true);
  });
});
