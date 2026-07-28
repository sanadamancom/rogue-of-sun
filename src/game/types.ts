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

export type GamePhase = 'playing' | 'gameover' | 'victory' | 'floor_reached';

export interface GameState {
  map: GameMap;
  player: Actor;
  enemy: Actor;
  turn: number;
  phase: GamePhase;
  seed: number;
  exit: Vec2;
}

export type PlayerAction =
  | { type: 'move'; direction: Direction8 }
  | { type: 'wait' };
