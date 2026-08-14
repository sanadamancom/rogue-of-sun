import { SolarForgeRecipe } from './solar-forge';

/**
 * Phase 24.3 太陽鍛冶レシピ (forge_lineage decision): production's actual
 * recipe table now holds only the 3 fixed, order-independent S->R pairs
 * — gram (太陽の剣+暗黒の剣), gungnir (ホワイトクイーン+ブラッククイーン),
 * mjolnir (あかつき+たそがれ). The 18 C->B/B->A/A->S transitions are
 * deliberately NOT enumerated here as literal SolarForgeRecipe entries:
 * per the superseding forge_lineage instruction ("同一武器系統かつ同rank
 * の異なる2個体を素材にできる／definitionIdの完全一致は要求しない／第1
 * 素材の系譜を完成品へ引き継ぐ"), that tier is resolved programmatically
 * from each species' own WeaponDefinition.forgeNextId (weapon-def.ts) via
 * solar-forge.ts's resolveLineageForgeOutput/validateForgeMaterialsWithLineage
 * — a fixed exact-id-pair registry entry per species couldn't express the
 * "first material's own lineage, second material only needs matching
 * family+rank" resolution rule (buildForgeRecipeKey's sorted, order-
 * independent key can only ever encode one output per unordered id pair).
 * Together, the 3 registered S->R recipes plus the 18 lineage-resolved
 * C/B/A transitions cover the full 21 太陽鍛冶レシピ roster (see
 * docs/history/phase-24-3-equipment-catalog-effects.md for the complete
 * input/output table and the decision not to adopt the original "同一
 * definitionId 2個" draft).
 */
export const SOLAR_FORGE_RECIPES: SolarForgeRecipe[] = [
  {
    id: 'gram',
    inputDefinitionIds: ['solar_sword', 'dark_sword'],
    inputRank: 'S',
    outputDefinitionId: 'gram',
    outputRank: 'R',
  },
  {
    id: 'gungnir',
    inputDefinitionIds: ['white_queen', 'black_queen'],
    inputRank: 'S',
    outputDefinitionId: 'gungnir',
    outputRank: 'R',
  },
  {
    id: 'mjolnir',
    inputDefinitionIds: ['dawn', 'twilight'],
    inputRank: 'S',
    outputDefinitionId: 'mjolnir',
    outputRank: 'R',
  },
];
