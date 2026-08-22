import type { EnemyLevel, EnemyType } from './types';

export type InclusiveDepthRange = readonly [minDepth: number, maxDepth: number];
export type EnemyLevelBand = 'level1' | 'level2' | 'level3';
export type EnemyLevelWeights = Readonly<Record<EnemyLevel, number>>;

export interface EnemyDepthDefinition {
  readonly appearance: InclusiveDepthRange;
  readonly levelBands: Readonly<Record<EnemyLevelBand, InclusiveDepthRange>>;
}

export const ENEMY_DEPTH_DEFINITIONS: Readonly<Record<EnemyType, EnemyDepthDefinition>> = {
  bat: { appearance: [1, 6], levelBands: { level1: [1, 2], level2: [3, 4], level3: [5, 6] } },
  bok: { appearance: [1, 8], levelBands: { level1: [1, 3], level2: [4, 6], level3: [7, 8] } },
  spider: { appearance: [1, 10], levelBands: { level1: [1, 4], level2: [5, 7], level3: [8, 10] } },
  skeleton: { appearance: [3, 12], levelBands: { level1: [3, 6], level2: [7, 9], level3: [10, 12] } },
  sword: { appearance: [5, 14], levelBands: { level1: [5, 8], level2: [9, 11], level3: [12, 14] } },
  cockatrice: { appearance: [7, 16], levelBands: { level1: [7, 10], level2: [11, 13], level3: [14, 16] } },
  mummy: { appearance: [9, 18], levelBands: { level1: [9, 12], level2: [13, 15], level3: [16, 18] } },
  ghost: { appearance: [11, 22], levelBands: { level1: [11, 15], level2: [16, 19], level3: [20, 22] } },
  axe: { appearance: [13, 26], levelBands: { level1: [13, 17], level2: [18, 22], level3: [23, 26] } },
  golem: { appearance: [15, 26], levelBands: { level1: [15, 19], level2: [20, 23], level3: [24, 26] } },
  kraken: { appearance: [17, 26], levelBands: { level1: [17, 20], level2: [21, 23], level3: [24, 26] } },
  steps: { appearance: [19, 26], levelBands: { level1: [19, 21], level2: [22, 24], level3: [25, 26] } },
};

export const ENEMY_LEVEL_WEIGHTS_BY_BAND: Readonly<Record<EnemyLevelBand, EnemyLevelWeights>> = {
  level1: { 1: 100, 2: 0, 3: 0 },
  level2: { 1: 30, 2: 70, 3: 0 },
  level3: { 1: 0, 2: 70, 3: 30 },
};

export const INITIAL_ENEMY_SPECIES_WEIGHTS: Readonly<Record<EnemyType, number>> = {
  bok: 10,
  spider: 10,
  bat: 10,
  skeleton: 8,
  sword: 8,
  mummy: 8,
  cockatrice: 7,
  ghost: 6,
  golem: 6,
  axe: 6,
  kraken: 5,
  steps: 5,
};

export interface WeightedEnemySpecies {
  readonly type: EnemyType;
  /** Fraction of the eligible species' total initial weight; all results sum to 1. */
  readonly normalizedWeight: number;
}

function containsDepth(range: InclusiveDepthRange, depth: number): boolean {
  return depth >= range[0] && depth <= range[1];
}

export function getEligibleEnemySpeciesForDepth(depth: number): WeightedEnemySpecies[] {
  const eligible = (Object.keys(ENEMY_DEPTH_DEFINITIONS) as EnemyType[]).filter((type) =>
    containsDepth(ENEMY_DEPTH_DEFINITIONS[type].appearance, depth),
  );
  const totalWeight = eligible.reduce((sum, type) => sum + INITIAL_ENEMY_SPECIES_WEIGHTS[type], 0);
  return eligible.map((type) => ({
    type,
    normalizedWeight: INITIAL_ENEMY_SPECIES_WEIGHTS[type] / totalWeight,
  }));
}

export interface EnemyLevelBandSelection {
  readonly band: EnemyLevelBand;
  readonly weights: EnemyLevelWeights;
}

/** Returns null when depth is outside this species' appearance window. */
export function getEnemyLevelBandForDepth(type: EnemyType, depth: number): EnemyLevelBandSelection | null {
  const bands = ENEMY_DEPTH_DEFINITIONS[type].levelBands;
  for (const band of ['level1', 'level2', 'level3'] as const) {
    if (containsDepth(bands[band], depth)) return { band, weights: ENEMY_LEVEL_WEIGHTS_BY_BAND[band] };
  }
  return null;
}

export interface EnemyPopulationForDepth {
  readonly initialEnemyCount: number;
  readonly reinforcementIntervalTurns: number;
}

export const ENEMY_POPULATION_BY_DEPTH: Readonly<Record<number, EnemyPopulationForDepth>> = Object.fromEntries(
  Array.from({ length: 26 }, (_, index) => {
    const depth = index + 1;
    const initialEnemyCount = depth <= 5 ? 6 : depth <= 10 ? 7 : depth <= 15 ? 8 : depth <= 20 ? 9 : 10;
    const reinforcementIntervalTurns = depth <= 8 ? 100 : depth <= 17 ? 80 : 60;
    return [depth, { initialEnemyCount, reinforcementIntervalTurns }];
  }),
);

/** Looks up the canonical population values for depth 1 through 26. */
export function getEnemyPopulationForDepth(depth: number): EnemyPopulationForDepth {
  if (!Number.isInteger(depth) || depth < 1 || depth > 26) {
    throw new RangeError(`Enemy population depth must be an integer from 1 through 26; received ${depth}`);
  }
  return ENEMY_POPULATION_BY_DEPTH[depth];
}

export interface ResolvedEnemySpawn {
  readonly type: EnemyType;
  readonly level: EnemyLevel;
}

export interface EnemySpawnSetForDepth {
  readonly initialEnemyCount: number;
  readonly spawns: ResolvedEnemySpawn[];
}

/** Resolves the canonical initial enemy spawn set for a production depth. */
export function resolveEnemySpawnsForDepth(depth: number, rng: () => number): EnemySpawnSetForDepth {
  const { initialEnemyCount } = getEnemyPopulationForDepth(depth);
  const species = getEligibleEnemySpeciesForDepth(depth);
  const spawns: ResolvedEnemySpawn[] = [];

  for (let i = 0; i < initialEnemyCount; i++) {
    const speciesRoll = rng();
    let speciesCumulative = 0;
    let type = species[species.length - 1].type;
    for (const candidate of species) {
      speciesCumulative += candidate.normalizedWeight;
      if (speciesRoll < speciesCumulative) {
        type = candidate.type;
        break;
      }
    }

    const levelWeights = getEnemyLevelBandForDepth(type, depth)!.weights;
    const totalLevelWeight = (Object.values(levelWeights) as number[]).reduce((sum, weight) => sum + weight, 0);
    const levelRoll = rng() * totalLevelWeight;
    let levelCumulative = 0;
    let level: EnemyLevel = 3;
    for (const candidateLevel of [1, 2, 3] as const) {
      levelCumulative += levelWeights[candidateLevel];
      if (levelRoll < levelCumulative) {
        level = candidateLevel;
        break;
      }
    }

    spawns.push({ type, level });
  }

  return { initialEnemyCount, spawns };
}
