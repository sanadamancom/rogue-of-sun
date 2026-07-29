export type Direction8 =
  | 'N'
  | 'S'
  | 'E'
  | 'W'
  | 'NE'
  | 'NW'
  | 'SE'
  | 'SW';

export interface Vec2 {
  x: number;
  y: number;
}

export const DIRECTION_VECTORS: Record<Direction8, Vec2> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
  NE: { x: 1, y: -1 },
  NW: { x: -1, y: -1 },
  SE: { x: 1, y: 1 },
  SW: { x: -1, y: 1 },
};

export const ALL_DIRECTIONS: Direction8[] = [
  'N',
  'S',
  'E',
  'W',
  'NE',
  'NW',
  'SE',
  'SW',
];

export type Tile = 'floor' | 'wall';

// Fixture values placed on top of terrain. Only 'exit' is used in Phase 02;
// 'trap' and 'chest' are reserved for future phases and are not generated.
export type Fixture = 'exit' | 'trap' | 'chest';

export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameMap {
  width: number;
  height: number;
  // terrain[y][x]
  terrain: Tile[][];
  rooms: Room[];
  exit: Vec2;
}

export interface Actor {
  pos: Vec2;
  hp: number;
  maxHp: number;
  attack: number;
  facing: Direction8;
  alive: boolean;
}

// 'floor_cleared' is a transient signal set for a single processTurn call
// when the player reaches an unlocked (enemy-defeated) staircase on a
// non-final floor; the caller regenerates the next floor immediately and
// the phase returns to 'playing' before any further input is handled.
export type GamePhase = 'playing' | 'floor_cleared' | 'gameover' | 'victory';

export interface GameState {
  map: GameMap;
  player: Actor;
  /** Fixed-order list of this floor's enemies; dead enemies stay in the array with alive=false. */
  enemies: Actor[];
  turn: number;
  phase: GamePhase;
  /** Seed used to generate this floor's map (derived from runSeed + floor). */
  seed: number;
  /** Seed identifying the whole run; the same runSeed always yields the same 3 floors. */
  runSeed: number;
  /** Current floor number, 1-indexed. */
  floor: number;
  /** Total floors in this run. */
  totalFloors: number;
  exit: Vec2;
  /** Consumed-turn counter toward the player's next natural HP regeneration tick (0..REGEN_TURNS_PER_HP-1). */
  regenProgress: number;
}

export type PlayerAction =
  | { type: 'move'; direction: Direction8 }
  | { type: 'wait' };
