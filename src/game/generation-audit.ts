import { bfsDistances } from './mapgen';
import { advanceRunFloor, createInitialState } from './state';
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

const DESCENT_FLOOR_COUNT = 26;
const LONG_RUN_CONFIG = { totalFloors: DESCENT_FLOOR_COUNT, runDepthTier: 'deep' as const };

function positionKey(pos: Vec2): string {
  return `${pos.x},${pos.y}`;
}

function auditFloor(state: GameState, expectedOrdinal: number): GenerationAuditFloorResult {
  const violations: string[] = [];

  if (state.map.terrain.length === 0 || state.map.terrain.every((row) => row.length === 0)) {
    violations.push('map terrain is empty');
  }
  if (state.map.rooms.length === 0) {
    violations.push('map rooms are empty');
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
    depth: state.floor,
    floorVisitOrdinal: state.floorVisitOrdinal,
    violations,
  };
}

/** Audits the production-generated descent route from depth 1 through depth 26. */
export function runDescentGenerationAudit(runSeed: number): DescentGenerationAuditResult {
  let state = createInitialState(runSeed, LONG_RUN_CONFIG);
  const floors: GenerationAuditFloorResult[] = [];

  for (let expectedOrdinal = 1; expectedOrdinal <= DESCENT_FLOOR_COUNT; expectedOrdinal++) {
    floors.push(auditFloor(state, expectedOrdinal));
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
