import { SolarForgeRecipe } from './solar-forge';

/**
 * Phase 24.2 太陽鍛冶コア: production's actual recipe table. Deliberately
 * empty — every registered weapon (WEAPON_DEFINITIONS) is still rank 'C'
 * with no higher-rank species to name as an output yet
 * (current_content's "Phase 24.2ではproduction武器定義を追加しない" /
 * "productionレシピが0件のため、現行通常プレイでは合成成功しない状態で
 * よい"). Phase 24.3 populates this once the B/A/S/R weapon roster
 * exists; getSolarForgeCandidates/applySolarForge already read this
 * array directly, so adding entries here is the only change Phase 24.3
 * needs to make real recipes reachable through the existing UI/action
 * boundary.
 */
export const SOLAR_FORGE_RECIPES: SolarForgeRecipe[] = [];
