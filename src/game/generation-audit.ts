import { deriveFloorSeed } from './floor';
import { bfsDistances, generateMap } from './mapgen';
import {
  getEligibleEnemySpeciesForDepth,
  getEnemyLevelBandForDepth,
  getEnemyPopulationForDepth,
} from './enemy-depth-bands';
import { advanceRunFloor, buildFloorState, createInitialState } from './state';
import type { GameState, Vec2 } from './types';

export interface GenerationAuditFloorResult {
  depth: number;
  floorVisitOrdinal: number | undefined;
  violations: string[];
}

export interface DescentGenerationAuditResult {
  runSeed: number;
  floors: GenerationAuditFloorResult[];
}

export interface AscentGenerationAuditResult {
  runSeed: number;
  floors: GenerationAuditFloorResult[];
}

const DESCENT_FLOOR_COUNT = 26;
const LONG_RUN_CONFIG = { totalFloors: DESCENT_FLOOR_COUNT, runDepthTier: 'deep' as const };

function positionKey(pos: Vec2): string {
  return `${pos.x},${pos.y}`;
}

function auditFloor(state: GameState, expectedOrdinal: number, leg: GameState['leg']): GenerationAuditFloorResult {
  const violations: string[] = [];
  const depth = state.floor;

  if (state.map.terrain.length === 0 || state.map.terrain.every((row) => row.length === 0)) {
    violations.push('map terrain is empty');
  }
  if (state.map.rooms.length === 0) {
    violations.push('map rooms are empty');
  }

  const regenerated = generateMap(deriveFloorSeed(state.runSeed, depth, leg));
  if (!regenerated.ok || regenerated.map === undefined) {
    violations.push(`depth ${depth} map regeneration failed; expected successful generation`);
  } else {
    if (JSON.stringify(regenerated.map.terrain) !== JSON.stringify(state.map.terrain)) {
      violations.push(`depth ${depth} regenerated map terrain differs; expected byte-identical terrain`);
    }
    if (JSON.stringify(regenerated.map.rooms) !== JSON.stringify(state.map.rooms)) {
      violations.push(`depth ${depth} regenerated map rooms differ; expected byte-identical rooms`);
    }
  }

  if (leg === 'ascent' && state.groundItems.length !== 0) {
    violations.push(`depth ${depth} has ${state.groundItems.length} ground items; expected none on ascent`);
  } else if (leg === 'descent' && !state.groundItems.some((item) => item.spawnSource !== 'monster_house')) {
    violations.push(`depth ${depth} has no normal ground item; expected at least one non-monster-house item`);
  }
  if (leg === 'ascent' && state.map.monsterHouse != null) {
    violations.push(`depth ${depth} has a monster house; expected none on ascent`);
  }

  const eligibleSpecies = getEligibleEnemySpeciesForDepth(depth).map(({ type }) => type);
  const eligibleSpeciesSet = new Set(eligibleSpecies);
  const initialEnemies = state.enemies
    .map((enemy, index) => ({ enemy, index }))
    .filter(({ enemy }) => enemy.spawnSource === 'normal');
  for (const { enemy, index } of initialEnemies) {
    if (!eligibleSpeciesSet.has(enemy.type)) {
      violations.push(
        `depth ${depth} enemy[${index}] type ${enemy.type} level ${enemy.level} is ineligible; expected one of ${eligibleSpecies.join(', ')}`,
      );
    }

    const levelBand = getEnemyLevelBandForDepth(enemy.type, depth);
    if (levelBand === null) {
      violations.push(
        `depth ${depth} enemy[${index}] type ${enemy.type} level ${enemy.level} has no level band; expected a non-null level band`,
      );
    } else if (levelBand.weights[enemy.level] <= 0) {
      const expectedLevels = ([1, 2, 3] as const).filter((level) => levelBand.weights[level] > 0);
      violations.push(
        `depth ${depth} enemy[${index}] type ${enemy.type} level ${enemy.level} is outside ${levelBand.band}; expected one of levels ${expectedLevels.join(', ')}`,
      );
    }
  }

  const expectedEnemyCount = getEnemyPopulationForDepth(depth).initialEnemyCount;
  if (initialEnemies.length !== expectedEnemyCount) {
    violations.push(
      `depth ${depth} initial enemy count is ${initialEnemies.length}; expected ${expectedEnemyCount}`,
    );
  }

  const distances = bfsDistances(state.map, state.player.pos);
  if (!distances.has(positionKey(state.exit))) {
    violations.push('player start cannot reach gameplay exit');
  }

  const occupants: Array<{ label: string; pos: Vec2 }> = [
    { label: 'player', pos: state.player.pos },
    { label: 'exit', pos: state.exit },
    ...state.enemies.map((enemy, index) => ({ label: `enemy[${index}]`, pos: enemy.pos })),
    ...state.groundItems.map((item, index) => ({ label: `groundItem[${index}]`, pos: item.pos })),
    ...(state.traps ?? []).map((trap, index) => ({ label: `trap[${index}]`, pos: trap.pos })),
  ];
  const occupiedTiles = new Map<string, string>();
  for (const occupant of occupants) {
    const key = positionKey(occupant.pos);
    const existing = occupiedTiles.get(key);
    if (existing !== undefined) {
      violations.push(`tile ${key} is occupied by both ${existing} and ${occupant.label}`);
    } else {
      occupiedTiles.set(key, occupant.label);
    }
  }

  if (state.floorVisitOrdinal !== expectedOrdinal) {
    violations.push(
      `floorVisitOrdinal is ${String(state.floorVisitOrdinal)}; expected ${expectedOrdinal}`,
    );
  }

  return {
    depth,
    floorVisitOrdinal: state.floorVisitOrdinal,
    violations,
  };
}

/** Audits the production-generated descent route from depth 1 through depth 26. */
export function runDescentGenerationAudit(runSeed: number): DescentGenerationAuditResult {
  let state = createInitialState(runSeed, LONG_RUN_CONFIG);
  const floors: GenerationAuditFloorResult[] = [];

  for (let expectedOrdinal = 1; expectedOrdinal <= DESCENT_FLOOR_COUNT; expectedOrdinal++) {
    floors.push(auditFloor(state, expectedOrdinal, 'descent'));
    if (expectedOrdinal === DESCENT_FLOOR_COUNT) break;

    const nextState = advanceRunFloor(state);
    if (nextState === 'runComplete') {
      floors[floors.length - 1].violations.push('descent route completed before depth 26');
      break;
    }
    state = nextState;
  }

  return { runSeed, floors };
}

/** Audits the production-generated ascent route from depth 25 through depth 1. */
export function runAscentGenerationAudit(runSeed: number): AscentGenerationAuditResult {
  let state = buildFloorState(
    runSeed,
    DESCENT_FLOOR_COUNT - 1,
    0,
    DESCENT_FLOOR_COUNT + 1,
    LONG_RUN_CONFIG,
    undefined,
    undefined,
    undefined,
    'ascent',
    'depth',
  );
  const floors: GenerationAuditFloorResult[] = [];

  for (let depth = DESCENT_FLOOR_COUNT - 1; depth >= 1; depth--) {
    const expectedOrdinal = 2 * DESCENT_FLOOR_COUNT - depth;
    floors.push(auditFloor(state, expectedOrdinal, 'ascent'));

    const nextState = advanceRunFloor(state);
    if (depth === 1) {
      if (nextState !== 'runComplete') {
        floors[floors.length - 1].violations.push('ascent route did not complete after depth 1');
      }
      break;
    }
    if (nextState === 'runComplete') {
      floors[floors.length - 1].violations.push('ascent route completed before depth 1');
      break;
    }
    state = nextState;
  }

  return { runSeed, floors };
}
