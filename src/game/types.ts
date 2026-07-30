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
  /**
   * Set true when the player steps onto a spider's web tile (enemy-behavior-02).
   * Only meaningful for the player (target: player_only per design); enemies
   * never read or set this on themselves. When true, the player's next
   * 'move' input fails (no position change) but still consumes a world
   * turn, then this clears. 'wait' and non-gameplay inputs (Enter/N) never
   * consume it. Defaults to false/absent for every other Actor.
   */
  slowed?: boolean;
}

/**
 * Enemy species. 'bok' chases in 8 directions; 'spider' chases in 4
 * directions only. The other 7 species are registered as of Phase 06
 * (enemy-roster-foundation) but do not yet have finished signature AI; see
 * src/game/enemy-def.ts for each species' provisional stats and the
 * temporary behavior it is routed to.
 */
export type EnemyType =
  | 'bok'
  | 'cockatrice'
  | 'spider'
  | 'bat'
  | 'mummy'
  | 'golem'
  | 'sword'
  | 'axe'
  | 'kraken';

/** An enemy Actor tagged with its species; used for AI branching and sprite/texture selection. */
export interface EnemyActor extends Actor {
  type: EnemyType;
  /**
   * World turn count (GameState.turn) at the moment this enemy was
   * created; used only by 'slow_melee' (golem) to derive its act/wait
   * phase as `(state.turn - spawnTurn) % 2` without needing a second,
   * independent tick counter — it reuses the existing turn counter and
   * simply anchors it per-enemy so the phase resets correctly whenever a
   * floor (re)generates enemies, regardless of the cumulative turn count
   * carried over from a previous floor. Defaults to 0; irrelevant for
   * every other behaviorType.
   */
  spawnTurn?: number;
  /**
   * Set by 'recovery_melee' (axe) immediately after it attacks; on its
   * next enemy turn it forces a wait (no movement, no attack) and clears
   * this flag, then returns to normal behavior. Irrelevant for every
   * other behaviorType.
   */
  recovering?: boolean;
  /**
   * Stable per-floor identifier (its index in state.enemies at creation
   * time), used only to tag WebTile.ownerEnemyId so a spider's own webs
   * can be identified regardless of position changes. Irrelevant for
   * every other behaviorType. Defaults to 0.
   */
  id?: number;
  /**
   * Spider-only web placement cooldown, in units of this spider's own
   * enemy turns (not world turns): 0 means eligible to place a web this
   * turn. Placing a web sets this to 3; each of this spider's own
   * following turns (whatever action it actually takes) decrements it by
   * 1 until it reaches 0 again, at which point placing is eligible again.
   * Other enemies acting does not affect it. Irrelevant for every other
   * behaviorType. Defaults to 0.
   */
  webCooldown?: number;
  /**
   * Bat-only (enemy-behavior-06/'bat_retreat'): set true immediately after
   * this bat lands a successful melee attack. On this bat's next enemy
   * turn, it tries to step to an adjacent tile that strictly increases its
   * Chebyshev distance to the player instead of acting normally, then
   * clears regardless of whether the retreat step succeeded. Irrelevant
   * for every other behaviorType. Defaults to false/absent.
   */
  retreating?: boolean;
  /**
   * Mummy-only (enemy-behavior-06/'mummy_shamble', phase-06-mummy-shambling-movement):
   * set true immediately after this mummy successfully takes a chase step
   * (moves one tile). On this mummy's next enemy turn, it rests in place
   * instead of acting normally (no movement, no attack, even if adjacent
   * to the player), then the flag clears regardless. A successful melee
   * attack never sets or is affected by this flag. Distinct from
   * `retreating` (bat) and `recovering` (axe) — deliberately a separate
   * field rather than a shared generic name, per-species semantics differ.
   * Irrelevant for every other behaviorType. Defaults to false/absent.
   */
  restingAfterMove?: boolean;
}

// 'floor_cleared' is a transient signal set for a single processTurn call
// when the player reaches an unlocked (enemy-defeated) staircase on a
// non-final floor; the caller regenerates the next floor immediately and
// the phase returns to 'playing' before any further input is handled.
export type GamePhase = 'playing' | 'floor_cleared' | 'gameover' | 'victory';

/**
 * A spider's web, a floor-set fixture (not an actor — it never blocks
 * movement, occupancy checks, or line of sight). `id` is also its creation
 * order (assigned from GameState.nextWebId, monotonically increasing), used
 * to deterministically find "the oldest web this spider owns" without
 * depending on array order or Math.random. `ownerEnemyId` matches the
 * placing spider's EnemyActor.id. `placedTurn` is the GameState.turn value
 * at the moment of placement; a web is removed once
 * `state.turn >= placedTurn + WEB_DURATION_WORLD_TURNS` (see web.ts).
 */
export interface WebTile {
  id: number;
  pos: Vec2;
  ownerEnemyId: number;
  placedTurn: number;
}

export interface GameState {
  map: GameMap;
  player: Actor;
  /** Fixed-order list of this floor's enemies (index 0 = bok, index 1 = spider); dead enemies stay in the array with alive=false. */
  enemies: EnemyActor[];
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
  /** Active spider webs on this floor (enemy-behavior-02); always reset to [] on a new floor/restart. */
  webs: WebTile[];
  /** Monotonically increasing counter used to assign each new WebTile's id (also its creation order); always reset to 0 on a new floor/restart. */
  nextWebId: number;
}

export type PlayerAction =
  | { type: 'move'; direction: Direction8 }
  | { type: 'wait' };
