export type Direction8 =
  | 'N'
  | 'S'
  | 'E'
  | 'W'
  | 'NE'
  | 'NW'
  | 'SE'
  | 'SW';

/** Phase 23.2: the 4 cardinal-only subset of Direction8, used by golem's charge (no diagonal charge — fixed_spec's directions list). */
export type Direction4 = 'N' | 'S' | 'E' | 'W';

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

/**
 * Phase 21.2: a floor's monster house state. `null` means this floor has
 * no monster house. When present, `roomIndex` is a valid index into the
 * floor's `GameMap.rooms` (never the start or exit room — see
 * monster-house.ts's `extractMonsterHouseCandidateRooms`), and `status`
 * tracks whether the player has triggered its discovery yet. See
 * `GameMap.monsterHouse`'s doc comment for the full lifecycle.
 */
export type MonsterHouseState = { roomIndex: number; status: 'hidden' | 'revealed' } | null;

export interface GameMap {
  width: number;
  height: number;
  // terrain[y][x]
  terrain: Tile[][];
  rooms: Room[];
  exit: Vec2;
  /**
   * Phase 17.2: index into `rooms` of this floor's single dark room, or
   * `null`/`undefined` when no eligible room exists (start/exit rooms are
   * never darkened — see dark-rooms.ts's chooseDarkRoomIndex). Optional
   * so every pre-Phase-17.2 GameMap literal (tests, fixtures) stays valid
   * without this field; a map without it behaves exactly like "no dark
   * room this floor".
   */
  darkRoomIndex?: number | null;
  /**
   * Phase 21.2: this floor's monster house state, or `null` when this
   * floor has no monster house (ineligible floor, or the occurrence roll
   * failed). Decided exactly once at floor-build time by
   * monster-house.ts's `buildMonsterHouseFloorState` (see state.ts's
   * buildFloorState, right after darkRoomIndex is set) and never
   * re-rolled afterward — not on render, entry, turn advance, or reload.
   * `roomIndex` is always a valid index into `rooms` drawn from
   * monster-house.ts's `extractMonsterHouseCandidateRooms` candidate set
   * (so never the start or exit room). `status` starts at `'hidden'`;
   * the `'hidden'` -> `'revealed'` transition on first player entry is
   * Phase 21.3's responsibility, not implemented here. Optional so every
   * pre-Phase-21.2 GameMap literal (tests, fixtures) stays valid without
   * this field; a map without it behaves exactly like "no monster house
   * this floor" — see MonsterHouseState's own doc comment in
   * monster-house.ts.
   */
  monsterHouse?: MonsterHouseState;
}

export interface Actor {
  pos: Vec2;
  hp: number;
  maxHp: number;
  attack: number;
  /**
   * Flat defense subtracted from an incoming attack's power before it's
   * applied (Phase 10.2 combat stat/scale redesign) — see combat.ts's
   * computeAttackDamage/computeIncomingDamage for the exact formulas. For
   * the player this is the *base* value only (almost always 0 right now,
   * since there is no permanent source of player defense yet besides
   * equipped armor — see turn.ts's getEffectivePlayerDefense, which adds
   * getEffectiveArmorValue on top of this field). For an enemy this is
   * its full defense (enemies have no separate "equipment" layer), copied
   * from EnemyDefinition.defense at spawn time, same as attack/hp.
   */
  defense: number;
  /**
   * Integer-percent chance this actor's own attacks land, before the
   * defender's evasion and the weapon's hit modifier are applied (Phase
   * 10.3 accuracy/evasion foundation) — see combat.ts's computeHitChance
   * for the exact formula. Same base/full-value split as `defense`: base
   * only for the player (no permanent bonus source yet), full value for
   * enemies (copied from EnemyDefinition.accuracy at spawn).
   */
  accuracy: number;
  /**
   * Integer-percent reduction to an attacker's hit chance when this
   * actor is the defender (Phase 10.3) — see combat.ts's
   * computeHitChance. 0 for almost every actor; only bat carries a
   * nonzero value among the current roster (see enemy-def.ts).
   */
  evasion: number;
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
  /**
   * Set true when a cockatrice's petrifying gaze hits the player
   * (phase-06-cockatrice-petrifying-gaze). The player's very next valid
   * game action (move or wait) is entirely replaced by a forced skip that
   * still consumes the turn, then this clears. Re-hitting while already
   * true is a plain re-assignment, not a stack/extension (duration is
   * always exactly the next 1 action). Only meaningful for the player;
   * enemies never set or read this on themselves. Defaults to
   * false/absent.
   */
  petrified?: boolean;
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
  | 'kraken'
  | 'skeleton'
  | 'ghost'
  | 'steps';

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
   * Phase 24.3 corsesca (effect_timing.corsesca): number of upcoming
   * enemy-turn resolves this actor must skip (0 = not stunned). Set to 1
   * by corsesca's 10% on-hit stun roll; turn.ts's enemy-resolution step
   * decrements it and treats exactly that many resolves as a no-op
   * (still consuming the enemy's turn, matching "対象の次回resolve 1回
   * をskip") without disturbing any other in-progress state (telegraphed/
   * recovering/etc. are left untouched — only the resolve itself is
   * skipped). Never stacks beyond what a single hit sets (repeated hits
   * while already stunned re-roll independently but this field is
   * simply set back to 1, never incremented, per "同一対象へ重複発動して
   * も1回分を超えてstackしない").
   */
  corsescaStunTurns?: number;
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
  /**
   * Cockatrice-only (enemy-behavior-06/'cockatrice_gaze',
   * phase-06-cockatrice-petrifying-gaze): the fixed 8-direction line this
   * cockatrice has aimed its petrifying gaze along, or absent/undefined
   * when not aiming. Set once when a valid, unobstructed 2-5 tile line to
   * the player is found (aim turn: no movement/attack that turn); on this
   * cockatrice's next turn it fires along this exact stored direction
   * (never re-aimed at the player's possibly-new position) and the field
   * is cleared, win or miss. Deliberately its own field — distinct from
   * `retreating` (bat), `recovering` (axe), and `restingAfterMove`
   * (mummy) — since it stores a direction, not a boolean. Defaults to
   * absent (not aiming).
   */
  gazeDirection?: Direction8;
  /**
   * Cockatrice-only, display-only bookkeeping (phase-07-1-ranged-attack-telegraph-reticle-only):
   * the absolute tile the player occupied at the moment this cockatrice
   * started aiming (set alongside `gazeDirection` in the same aim turn,
   * cleared alongside it in the same fire turn). Exists purely so the
   * telegraph reticle can be drawn at a fixed tile even after the player
   * moves; it is never read by hit-detection/firing logic, which still
   * uses only `gazeDirection` plus the ray-casting distance check exactly
   * as before this field existed. Defaults to absent.
   */
  gazeTargetTile?: Vec2;
  /**
   * Kraken-only (enemy-behavior-06/'kraken_tentacle',
   * phase-06-kraken-telegraphed-tentacle-strike): the fixed world
   * coordinate this kraken has telegraphed its tentacle strike at, or
   * absent/undefined when not telegraphing. Set once when the player is
   * within Chebyshev distance 1-5 (telegraph turn: kraken never moves, on
   * any turn, for any reason); on this kraken's next turn it strikes the
   * orthogonal cross centered on this exact stored coordinate (never
   * re-centered on the player's possibly-new position) and the field is
   * cleared, hit or miss. Deliberately its own field — distinct from every
   * other species' per-enemy state — since it stores a position, not a
   * boolean or direction. Defaults to absent (not telegraphing).
   */
  tentacleTarget?: Vec2;
  /**
   * Phase 13.3b speed/action-gauge scheduler: this enemy's accumulated
   * action gauge, in the same 100=baseline units as ENEMY_BASE_SPEED/
   * PLAYER_BASE_SPEED (see turn.ts's resolveEnemiesAction and ability.ts's
   * getPlayerSpeed). Required (not optional) and always explicitly
   * initialized to 0 by createInitialEnemy — the sole production
   * EnemyActor constructor — so every enemy, from the very moment it is
   * created, has a real `0`, never `undefined`. Incremented by
   * ENEMY_BASE_SPEED once per resolveEnemiesAction pass over a living
   * enemy; each time it reaches or exceeds the player's current speed
   * (ability.ts's getPlayerSpeed), playerSpeed is subtracted and
   * resolveOneEnemy is called once — so this can trigger 0, 1, or
   * multiple actions per pass depending on relative speed. Persists
   * across player turns within the same floor (never reset merely by the
   * passage of turns); always freshly 0 when a floor (re)generates its
   * enemies (a new EnemyActor from createInitialEnemy) and whenever a
   * speed-ability allocation succeeds (see ability.ts's
   * allocateAbilityPoint) — never otherwise mutated outside
   * resolveEnemiesAction.
   */
  actionGauge: number;
  /**
   * Phase 21.4: this enemy's spawn origin. `'monster_house'` marks a
   * dedicated monster-house enemy (see monster-house.ts's
   * buildMonsterHouseEnemies); every other enemy — including every
   * pre-Phase-21.4 EnemyActor literal across the test suite, where this
   * field is simply absent — is treated as `'normal'`. Absent/undefined
   * behaves identically to `'normal'` (see turn.ts's resolveEnemiesAction
   * hidden-suppression check): only an enemy explicitly tagged
   * `'monster_house'` can ever be suppressed while its monster house is
   * hidden. Never itself read by combat, AI, or drop logic — purely an
   * origin tag.
   */
  spawnSource?: 'normal' | 'monster_house';
  /**
   * Skeleton-only (Phase 23.1 solar gun element foundation +
   * skeleton revival): which of the two forms this skeleton is
   * currently in. Absent/undefined is equivalent to `'body'` (every
   * pre-Phase-23.1 EnemyActor literal across the test suite, and every
   * freshly spawned skeleton, has no explicit value here) — `'head'` is
   * only ever set once a body-form skeleton is defeated by an attack
   * that did not activate any element (see turn.ts's
   * defeatEnemyIfNeeded). A head-form skeleton stays `alive: true`
   * (it is never fully defeated — see EnemyActor doc above) and simply
   * sits at its own position doing nothing (no movement, no attack, no
   * AI dispatch — see turn.ts's resolveOneEnemy) until it either
   * reverts to `'body'` (skeletonReviveAtTurn reached, tile unoccupied)
   * or is fully defeated by any element hitting the head. Irrelevant
   * for every other species. No schemaVersion bump: purely an optional
   * addition, defaulting exactly as before this phase for every
   * existing fixture.
   */
  skeletonForm?: 'body' | 'head';
  /**
   * Skeleton-only (Phase 23.1): the exact GameState.turn value (world
   * turn count, not this enemy's own action-gauge activations) at or
   * after which a head-form skeleton becomes eligible to revert to
   * 'body' — set to `state.turn + SKELETON_HEAD_REVIVE_TURNS` the
   * instant this skeleton becomes a head (turn.ts's
   * defeatEnemyIfNeeded), and cleared (set back to undefined) the
   * instant it actually revives (turn.ts's resolveSkeletonRevivals).
   * Revival additionally requires this skeleton's own tile to be free
   * of the player and any other living body-form actor — an occupied
   * tile simply leaves this field untouched and re-checks the
   * following world turn; the revival position itself never moves (no
   * RNG is ever consumed by this field's use). Irrelevant/absent for
   * every other species and for a body-form skeleton.
   */
  skeletonReviveAtTurn?: number;
  /**
   * Golem-only (Phase 23.2 charge redesign, replacing 'slow_melee'):
   * this golem's current charge-cycle phase. Absent/undefined is
   * equivalent to `'idle'` (every pre-Phase-23.2 EnemyActor literal, and
   * every freshly spawned golem, has no explicit value here) — see
   * turn.ts's resolveGolemChargeEnemy for the full idle -> telegraphed
   * -> recovering -> idle cycle. No schemaVersion bump: purely an
   * optional addition, defaulting exactly as before this phase for
   * every existing fixture. Irrelevant for every other species.
   */
  golemChargeState?: 'idle' | 'telegraphed' | 'recovering';
  /**
   * Golem-only (Phase 23.2): the fixed cardinal direction this golem
   * will charge along, set once when it enters 'telegraphed' and
   * cleared the same turn it actually charges. Never re-derived from
   * the player's possibly-new position (fixed_spec's "プレイヤーの現在
   * 位置へ方向補正しない"). Irrelevant/absent outside 'telegraphed'.
   */
  golemChargeDirection?: Direction4;
  /**
   * Golem-only (Phase 23.2), display-only bookkeeping mirroring
   * cockatrice's gazeTargetTile / kraken's tentacleTarget: the tile the
   * player occupied at the moment this golem started telegraphing,
   * fixed for the reticle's sake — never read by the charge's own
   * collision/movement resolution, which relies solely on
   * golemChargeDirection. Cleared alongside golemChargeDirection the
   * same turn the charge resolves.
   */
  golemChargeTargetTile?: Vec2;
  /**
   * Steps-only (Phase 23.4): this individual's hidden/telegraphed/
   * revealed combat state. Absent/undefined is equivalent to `'hidden'`
   * (every freshly spawned steps has no explicit value here) — see
   * turn.ts's resolveStepsEnemy for the full state machine (hidden ->
   * telegraphed on Chebyshev-distance-1 detection -> revealed after the
   * spike attack executes -> back to hidden once
   * stepsRevealTurnsRemaining reaches 0). Purely a combat-state field —
   * display eligibility for steps_see.png is decided separately by
   * shouldDisplayStepsBody (src/game/steps.ts), which also considers
   * clairvoyance independent of this field. No schemaVersion bump:
   * purely an optional addition, defaulting exactly as before this
   * phase for every existing fixture. Irrelevant for every other
   * species.
   */
  stepsState?: 'hidden' | 'telegraphed' | 'revealed';
  /**
   * Steps-only (Phase 23.4): the fixed 3x3 attack center — this steps'
   * own coordinate at the exact moment detection occurred — set once
   * when it enters 'telegraphed' and cleared the same turn the spike
   * attack actually executes. Never re-derived from this steps' own
   * possibly-new position (it never moves while telegraphed) or the
   * player's position. Irrelevant/absent outside 'telegraphed'.
   */
  stepsTelegraphCenter?: Vec2;
  /**
   * Steps-only (Phase 23.4): world-turn-independent countdown of this
   * steps' own remaining *actions* (not world turns) still owed at
   * 'revealed' visibility after a spike attack executes — set to 3 the
   * instant the attack resolves, decremented by 1 after each of this
   * steps' own subsequent ordinary ground actions, and reverting
   * stepsState to 'hidden' (and this field to undefined) the instant it
   * would reach 0. Irrelevant/absent outside 'revealed'.
   */
  stepsRevealTurnsRemaining?: number;
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

/**
 * Which kind of trap a TrapTile is (Phase 12.3 extension of Phase 12.2's
 * slow_trap). A discriminated field, not inferred from array position,
 * placement order, or which effect id happens to be active — every call
 * site that needs to distinguish trap behavior switches on this field
 * explicitly.
 */
export type TrapType = 'slow_trap' | 'poison_trap';

/**
 * A hidden floor trap (Phase 12.2 slow trap, extended in Phase 12.3 with
 * `trapType` to support poison_trap alongside it; Phase 18.1 adds the
 * `revealed` discovery state described below): a fixture (per Fixture's
 * 'trap' literal, reserved since Phase 02 but never backed by real data
 * until Phase 12.2), not an actor or ground item. `id` is stable
 * per-floor (unique across all traps on a floor regardless of type —
 * slow_trap and poison_trap share one id sequence via a single
 * GameState.traps array, per implementation_policy's "鈍足罠と毒罠で別々
 * のGameState配列を作る"禁止).
 *
 * Phase 18.1 three-state discovery model, expressed with two independent
 * booleans rather than a string enum (keeps `triggered`'s existing
 * meaning and every existing read site — turn.ts's trigger loop,
 * main.ts's old triggered-only rendering check — valid unchanged):
 *   - hidden:               revealed=false, triggered=false
 *   - revealed_untriggered: revealed=true,  triggered=false
 *   - triggered_inactive:   revealed=true,  triggered=true
 * Invariant: `triggered=true` implies `revealed=true` — a trap is never
 * constructed or updated into `triggered=true, revealed=false`. There is
 * no save/load mechanism in this codebase, so no legacy-data migration
 * path exists or is needed for old `triggered`-only data.
 *
 * `revealed` starts false (hidden; renders identically to plain floor,
 * per Phase 18.1's "未発見罠の座標、種別、存在を画面へ漏らさない") and is
 * set true the instant the player's own successful move lands on this
 * trap's tile (this phase's only discovery path — a future phase may add
 * others, e.g. a clairvoyance item, without touching this field's
 * semantics). `triggered` still starts false and becomes true on that
 * exact same step (Phase 18.1 does not yet introduce a discovery path
 * that reveals a trap without also triggering it) — a triggered trap is
 * permanently inert (one_shot), stays in the array (so it keeps
 * rendering its "revealed and inactive" symbol) and never fires again.
 */
export interface TrapTile {
  id: number;
  pos: Vec2;
  revealed: boolean;
  triggered: boolean;
  trapType: TrapType;
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
  /**
   * Items lying on this floor's ground (Phase 08.2 inventory foundation).
   * Always reset per floor/restart, like webs. Never embedded into
   * map.terrain; a tile can hold at most one ground item by construction
   * (placement excludes existing ground item tiles).
   */
  groundItems: GroundItem[];
  /** Monotonically increasing counter used to assign each new GroundItem's id; always reset to 0 on a new floor/restart. */
  nextGroundItemId: number;
  /**
   * This floor's hidden traps (Phase 12.2 slow_trap, extended in Phase
   * 12.3 with poison_trap sharing this same array — see TrapTile's
   * `trapType` field), at most one of each TrapType per floor per
   * fixed_specification.trap.placement's count_per_floor: 1 (per type).
   * Always freshly built per floor/restart by buildFloorState (like
   * webs/groundItems) — never carried over across floor transitions;
   * each new floor gets its own independently (possibly containing fewer
   * than 2 traps, see chooseTrapPosition's null-candidate fallback)
   * placed traps. Optional (unlike webs/groundItems, which are required)
   * purely so existing GameState object literals across the test suite
   * predating this phase remain valid without every one of them being
   * updated — see turn.ts's trap-trigger logic and effects.ts's
   * getActiveEffects for the same `?? []` pattern used elsewhere for
   * this reason.
   */
  traps?: TrapTile[];
  /**
   * Steps-only (Phase 23.4): whether clairvoyance_fruit has been used on
   * *this floor* — display-only, independent of every steps individual's
   * own hidden/telegraphed/revealed combat state (stepsState). Always
   * freshly built per floor/restart (like traps/webs/groundItems) —
   * buildFloorState never carries this over from the previous floor, so
   * using clairvoyance on one floor never leaks into the next. Optional
   * for the same reason `traps` is: existing GameState object literals
   * across the test suite remain valid without every one of them being
   * updated. No schemaVersion bump: purely an optional addition.
   */
  stepsClairvoyanceActive?: boolean;
  /**
   * The player's stacked item counts. Persists across floor transitions
   * (carried over by advanceToNextFloor) and resets to empty on a brand
   * new run (createInitialState).
   */
  inventory: Inventory;
  /**
   * Whether the inventory overlay is currently open (Phase 08.2). Toggled
   * by Tab, closed by Escape or a successful item use. While true, normal
   * move/wait player actions are rejected by processTurn (no turn
   * consumed) — see applyPlayerAction's inventoryOpen guard.
   */
  inventoryOpen: boolean;
  /** Index into the current non-zero inventory entries (display order = ITEM_IDS_IN_ORDER), used by ArrowUp/ArrowDown navigation. Resets to 0 whenever the inventory opens. */
  selectedItemIndex: number;
  /**
   * Phase 11.2: the itemId a discard confirmation prompt is currently
   * pending for, or null/undefined when no confirmation is showing. Set
   * when the discard key is pressed on the selected item, cleared on
   * cancel or on a successful discard. Optional (rather than a required
   * boolean+id pair) so existing GameState object literals across the
   * test suite remain valid without every one of them being updated to
   * include it; treated as "no confirmation pending" whenever absent.
   * Never persisted across floor transitions or restarts (always cleared,
   * like inventoryOpen).
   */
  discardConfirmItemId?: ItemId | null;
  /**
   * Phase 24.1: which specific EquipmentInstance a pending discard
   * confirmation targets, when discardConfirmItemId is a weapon/armor
   * itemId and the player selected a particular individual (docs/
   * history/phase-24-0-equipment-readiness-audit.md's known_problem —
   * discardConfirmItemId alone can't distinguish two held individuals of
   * the same species). Undefined/null for a consumable confirmation
   * (itemId alone is unambiguous there) or for a legacy caller that never
   * set it. Cleared together with discardConfirmItemId on cancel, on a
   * successful discard, and whenever the inventory overlay closes — never
   * survives independently of it. handleMenuConfirm's discard branch
   * re-validates this instanceId against live state (still owned, still
   * matching the same definitionId, not the equipped one) before
   * dispatching, exactly like every other Phase 24.1 instance reference.
   */
  discardConfirmEquipmentInstanceId?: string | null;
  /**
   * Phase 11.3 hunger: current hunger (0..HUNGER_MAX, default HUNGER_MAX
   * when absent — see hunger.ts's getHunger). Run-wide state, persists
   * across floor transitions (carried by advanceToNextFloor's
   * CarryOverStats), resets to HUNGER_MAX on a brand new run or a
   * post-death retry. Optional for the same reason
   * discardConfirmItemId is: existing GameState object literals across
   * the test suite remain valid without every one of them being updated.
   */
  hunger?: number;
  /**
   * Phase 11.3 hunger: progress toward the next 1-point hunger decrease
   * (0..HUNGER_DECREASE_INTERVAL-1, default 0 when absent). Incremented
   * by exactly 1 per successfully consumed player turn while hunger >= 1;
   * reset to 0 whenever it triggers a decrease. Persists across floor
   * transitions like `hunger`; resets to 0 on a new run/retry.
   */
  hungerDecreaseProgress?: number;
  /**
   * Phase 11.3 hunger: progress toward the next starvation damage tick
   * (0..STARVATION_INTERVAL-1, default 0 when absent). Only increments
   * while hunger is exactly 0; reset to 0 the moment hunger becomes >= 1
   * again (and also when it triggers damage). Persists across floor
   * transitions like `hunger`; resets to 0 on a new run/retry.
   */
  starvationProgress?: number;
  /**
   * Phase 15.2 recovery/satiety/status rebalance: progress toward the
   * next poison damage tick (0..POISON_TICK_INTERVAL-1, default 0 when
   * absent) — see effects.ts's getPoisonTickProgress/POISON_TICK_INTERVAL
   * and turn.ts's applyPoisonTick. Incremented by exactly 1 per
   * successfully consumed player turn while poison is active and not the
   * grant/refresh turn itself; reset to 0 whenever it triggers a tick,
   * whenever poison is granted/refreshed, or whenever poison is not
   * currently active. Persists across floor transitions like
   * activeEffects; resets to 0 on a new run/retry (poison itself is never
   * carried into a new run/retry either).
   */
  poisonTickProgress?: number;
  /**
   * Phase 11.3 hunger: whether the "hunger reached 20 or below" warning
   * has already been shown for the current low-hunger dip (cleared once
   * hunger rises back above 20, so a later dip warns again). Optional,
   * default false when absent.
   */
  hungerLowWarned?: boolean;
  /**
   * Phase 11.3 hunger: whether the "hunger reached 0" warning has already
   * been shown for the current starvation period (cleared once hunger
   * rises back above 0). Optional, default false when absent.
   */
  hungerZeroWarned?: boolean;
  /**
   * The currently equipped weapon, or null for unarmed (Phase 08.3).
   * Equipping never removes the weapon from `inventory` (not consumable,
   * not stackable) and never changes player.attack (the permanent unarmed
   * stat) — see turn.ts's getEffectiveAttackPower for how this is applied
   * during combat. Persists across floor transitions like `inventory`;
   * resets to null on a brand new run.
   */
  equippedWeaponId: WeaponId | null;
  /**
   * Phase 20.0c equipment-instance foundation: which individual weapon
   * instance (see EquipmentInstance below) is currently equipped, or
   * null when equippedWeaponId is null or the equipped species has no
   * tracked instance yet (defensive — normalizeEquipmentInstances in
   * equipment-instance.ts backfills this on every state-construction
   * boundary, so this should be non-null whenever equippedWeaponId is
   * non-null in practice). Optional for the same reason
   * identifiedCardIds/abilities are: existing GameState fixtures across
   * the test suite predate this phase and never set it.
   */
  equippedWeaponInstanceId?: string | null;
  /**
   * The currently equipped armor, or null for unarmored (Phase 08.4).
   * Independent of equippedWeaponId — equipping one never affects the
   * other. Equipping never removes the armor from `inventory` and never
   * changes player.maxHp/hp — see turn.ts's getEffectiveArmorValue for how
   * this is applied when the player takes damage. Persists across floor
   * transitions like `inventory`/`equippedWeaponId`; resets to null on a
   * brand new run.
   */
  equippedArmorId: ArmorId | null;
  /** Phase 20.0c equipment-instance foundation: the individual armor instance currently equipped — see equippedWeaponInstanceId's identical doc comment above. */
  equippedArmorInstanceId?: string | null;
  /**
   * Whether the hammer is in recoil (Phase 08.7): set true after any
   * hammer attack via X (hit, kill, failed-knockback, or whiff) — never
   * while a different weapon is equipped. While true, pressing X with the
   * hammer equipped does not attack; it only "re-cocks" the hammer (1
   * turn consumed, no damage) and clears this flag. Cleared by any other
   * turn-consuming action (successful move, wait, an X attack while a
   * different weapon is equipped) but deliberately NOT by re-equipping —
   * see applyHammerAttack/applyWeaponEquip in turn.ts. Always false at
   * the start of a floor and at the start of a new run (per-floor state,
   * like webs/groundItems — never carried over even though equippedWeaponId
   * is).
   */
  hammerRecovery: boolean;
  /**
   * Current solar energy (Phase 09.1 foundation). Always clamped to
   * [0, maxSolarEnergy]. Persists across floor transitions like
   * inventory/equippedWeaponId; resets to 5 on a brand new run. Not yet
   * consumed by anything (no sun gun in this phase) — only sun fruit
   * (below) changes it in normal play.
   */
  solarEnergy: number;
  /**
   * Maximum solar energy (Phase 09.1 foundation). Fixed at 5 for this
   * phase; never changed by equipment or floor. Persists across floor
   * transitions; resets to 5 on a brand new run.
   */
  maxSolarEnergy: number;
  /**
   * Per-tile sunlight layer (Phase 09.3), independent of `map.terrain`:
   * `sunlight[y][x]` is true when tile (x,y) is sunlit, false otherwise
   * (every wall tile is always false, though normal play never queries a
   * wall tile's sunlight). Regenerated fresh per floor by buildFloorState
   * (like webs/groundItems) — never carried over across floor
   * transitions or into a new run. Purely a display/charge-eligibility
   * concern: never affects walkability, collision, or line-of-sight —
   * existing movement/attack/ray code never reads this field.
   */
  sunlight: boolean[][];
  /**
   * Whether the player has picked up the sol enchantment item (Phase 10.1).
   * Once true, never reverts to false. Persists across floor transitions
   * like equippedWeaponId; resets to false on a brand new run.
   */
  solUnlocked: boolean;
  /**
   * The player's currently selected melee enchantment (Phase 10.1),
   * player-common (not per-weapon) and independent of equippedWeaponId —
   * switching weapons never changes this. Toggled by the 'f' key (see
   * input.ts) while solUnlocked is true; toggling while locked is a no-op.
   * Persists across floor transitions; resets to 'none' on a brand new run.
   */
  selectedEnchantment: EnchantmentId;
  /**
   * Per-element unlock state (Phase 14.1 five-element enchantment
   * foundation), one boolean per ElementId. Purely additive alongside
   * the pre-existing solUnlocked (which remains the sole authority
   * combat code reads for sol's own activation condition — see
   * turn.ts's applyPlayerAttackToEnemy): this field's 'sol' entry is
   * kept in sync with solUnlocked at the same site solUnlocked flips to
   * true (turn.ts's ground-item pickup handling), and every other
   * element stays false forever this phase, since flame/frost/cloud/
   * earth have no pickup item or unlock path yet. Persists across floor
   * transitions like solUnlocked; a brand new run starts every element
   * false.
   */
  unlockedEnchantments: Record<ElementId, boolean>;
  /**
   * Combat RNG stream state (Phase 10.3 accuracy/evasion foundation) —
   * see rng.ts's mulberry32Step/rollPercent. A plain number (not a
   * closure) so GameState stays ordinary data; advanced by exactly one
   * step per resolved (non-whiff, non-out-of-range, non-resource-
   * blocked) attack, player or enemy. Seeded from runSeed at run start
   * (see state.ts's createInitialState) via its own XOR constant,
   * independent of every map-generation RNG stream — never perturbs
   * map/placement/species/item/sunlight determinism. Persists across
   * floor transitions like inventory/solarEnergy; a brand new run (or
   * restarting the same run seed via Enter) always re-seeds it
   * identically, so the combat roll sequence is exactly as reproducible
   * as everything else derived from runSeed.
   */
  combatRngState: number;
  /**
   * Active temporary status effects (Phase 12.1 common status-effect
   * foundation), currently only ever containing 'attack_up' (see
   * effects.ts's EFFECT_DEFINITIONS/ActiveEffect). Run-wide player state —
   * persists across floor transitions like inventory/equippedWeaponId,
   * resets to [] on a brand new run or a post-death retry. Optional (like
   * discardConfirmItemId) so existing GameState object literals across the
   * test suite remain valid without every one of them being updated;
   * treated as an empty array whenever absent (see effects.ts's
   * getActiveEffects). Deliberately a generic array rather than a
   * dedicated boolean field, so future effects (Phase 12.2+) can reuse it
   * without another GameState field per effect. Never used for slowed or
   * petrified, which stay as their own dedicated Actor fields.
   */
  activeEffects?: ActiveEffect[];
  /**
   * Phase 13.1 experience/level/ability-point progression foundation.
   * Current player level (1..99). Optional, defaulting to 1 when absent
   * (see progression.ts's getLevel) — like hunger/activeEffects, so
   * existing GameState object literals across the test suite remain
   * valid without every one of them being updated. Persists across floor
   * transitions like inventory/equippedWeaponId; resets to 1 on a brand
   * new run or a post-death retry.
   */
  level?: number;
  /**
   * Phase 13.1: current in-level experience, carried toward the next
   * level's requirement (getExperienceRequirement(level)). Optional,
   * defaulting to 0 when absent (see progression.ts's getExperience).
   * Persists across floor transitions; resets to 0 on a brand new run or
   * a post-death retry. Always reset to 0 once level reaches LEVEL_CAP
   * (99) — see progression.ts's applyExperienceGain.
   */
  experience?: number;
  /**
   * Phase 13.1: unused ability points accumulated from level-ups (1 per
   * level gained). Not yet spendable this phase (able assignment UI is
   * Phase 13.2+) — see progression.ts's doc comment. Optional, defaulting
   * to 0 when absent. Persists across floor transitions; resets to 0 on a
   * brand new run or a post-death retry.
   */
  unspentAbilityPoints?: number;
  /**
   * Phase 13.2 ability point allocation foundation. The 4 abilities'
   * current values (カラダ/ココロ/チカラ/ハヤサ). Optional, defaulting to
   * all-zero when absent (see ability.ts's getAbilities) — like
   * level/experience/unspentAbilityPoints, so existing GameState object
   * literals across the test suite remain valid without every one of
   * them being updated. Persists across floor transitions like
   * inventory/equippedWeaponId; resets to all-zero on a brand new run or
   * a post-death retry. Deliberately never read by any existing combat
   * calculation this phase (see ability.ts's module doc comment) — Phase
   * 13.3 wires in real effects.
   */
  abilities?: AbilityValues;
  /**
   * Phase 20.0b/20.3 card identification foundation: the set of card
   * species (CardId) identified so far this run — see card-def.ts's
   * CARD_DEFINITIONS. Optional, defaulting to an empty array when absent
   * (see turn.ts's getIdentifiedCardIds), following the same pattern as
   * level/experience/abilities above so existing GameState object
   * literals across the test suite remain valid without every one of
   * them being updated. Persists across floor transitions like
   * inventory/abilities; resets to empty on a brand new run or a
   * post-death retry. Identification is per-species (not per-copy): once
   * a CardId is present here, every copy of that card currently or
   * later held displays its real name/effect (see turn.ts's
   * isCardIdentified). Never contains duplicate entries or any id
   * outside CardId — see state.ts's advanceToNextFloor carry-over, which
   * normalizes both away defensively when reading a possibly-stale
   * `carry` value.
   */
  identifiedCardIds?: CardId[];
  /**
   * Phase 24.4d1 general item identification: the set of non-card ItemIds
   * (7 ordinary consumables + weapon/armor definitionIds, run-shared —
   * see item-identification.ts's module doc comment) identified so far
   * this run. Optional, defaulting to an empty array when absent (see
   * item-identification.ts's isGeneralItemIdentified), following the
   * exact same pattern as identifiedCardIds above. A completely separate
   * set from identifiedCardIds — cards keep their own existing contract
   * unchanged; the two are never merged. Persists across floor
   * transitions like identifiedCardIds; resets to empty on a brand new
   * run or a post-death retry. Never contains duplicate entries, a
   * CardId, or an always-identified id (solar_gun, the 5 one-time unlock
   * pickups) — see item-identification.ts's normalizeIdentifiedGeneralItemIds.
   */
  identifiedGeneralItemIds?: ItemId[];
  /**
   * Phase 20.0c equipment-instance foundation: every weapon/armor
   * individual currently held (equipped or not) this run — see
   * equipment-instance.ts's EquipmentInstance/CARD_DEFINITIONS-parallel
   * doc comments. Optional, defaulting to [] when absent (existing
   * GameState fixtures across the test suite predate this phase);
   * equipment-instance.ts's normalizeEquipmentInstances is the single
   * place that backfills missing instances against `inventory`'s counts
   * for weapon/armor ids. This is deliberately NOT a per-species record
   * (unlike `inventory`) since multiple simultaneously-held individuals
   * of the same species must remain distinguishable — see that field's
   * `instanceId`. Persists across floor transitions like inventory;
   * resets to [] on a brand new run.
   */
  equipmentInstances?: EquipmentInstance[];
  /**
   * Phase 20.0c: monotonically-incrementing counter used to mint each
   * new EquipmentInstance's `instanceId` (equipment-instance.ts's
   * createEquipmentInstance) — deterministic and RNG-free, mirroring the
   * existing nextWebId/nextGroundItemId counters. Optional, defaulting
   * to 0 when absent. Persists across floor transitions (never reset
   * mid-run, so instance ids never collide across floors); resets to 0
   * on a brand new run.
   */
  nextEquipmentInstanceId?: number;
  /**
   * Whether the ability allocation overlay (P) is currently open. Mutual
   * exclusion with `inventoryOpen` — opening either closes the other (see
   * ability.ts's toggleAbilityOverlay / inventory.ts's toggleInventory).
   * Never persisted across floor transitions or restarts (always false at
   * the start of a floor/run, like inventoryOpen).
   */
  abilityOverlayOpen?: boolean;
  /** Index into ABILITY_IDS for the ability overlay's current selection (Phase 13.2). Resets to 0 whenever the overlay opens. */
  selectedAbilityIndex?: number;
  /**
   * The ability a confirmation prompt is currently pending for, or
   * null/undefined when no confirmation is showing (Phase 13.2, mirrors
   * discardConfirmItemId's optional-field pattern). Cleared whenever the
   * overlay closes, a confirmation is cancelled, or a confirmation is
   * resolved (either choice).
   */
  abilityConfirmPending?: AbilityId | null;
  /** The ability confirmation's current はい/いいえ choice; always reset to 'no' when a new confirmation opens (Phase 13.2). */
  abilityConfirmChoice?: 'yes' | 'no';
}

/**
 * One species of temporary status effect's identifier (Phase 12.1 common
 * status-effect foundation) — see effects.ts's EFFECT_DEFINITIONS, the
 * single source of truth for id/displayName/strength/duration so no call
 * site (item use, combat, HUD) repeats these numbers itself.
 */
/**
 * Temporary status-effect species ids (Phase 12.1 attack_up; Phase 12.2
 * movement_slow; Phase 12.3 poison). Phase 20.0b adds `sealed` (card use
 * lockout) reusing this exact same activeEffects/duration mechanism —
 * see effects.ts's EFFECT_DEFINITIONS.sealed doc comment for why no new
 * grant source is added this phase; only its blocking check and the
 * shared decrement/expiry machinery are wired up.
 */
export type EffectId = 'attack_up' | 'movement_slow' | 'poison' | 'sealed' | 'emperor_shield';

/**
 * Phase 13.2 ability point allocation foundation: the 4 fixed-key ability
 * identifiers (see ability.ts for the display-name mapping and
 * allocation logic; defined here, not in ability.ts, for the same reason
 * EffectId lives here rather than in effects.ts — GameState needs the
 * type without creating a circular import).
 */
export type AbilityId = 'body' | 'mind' | 'power' | 'speed';

/** The 4 abilities' current values, held as one type-safe fixed-key structure. */
export interface AbilityValues {
  body: number;
  mind: number;
  power: number;
  speed: number;
}

/**
 * Every currently-implemented status ailment id (Phase 12.4 status-
 * ailment classification), spanning both activeEffects-backed ids
 * (poison, movement_slow — a subset of EffectId) and the two special-
 * status ids that live on Actor.slowed/Actor.petrified instead of
 * activeEffects (spider_web, petrification). Deliberately does NOT
 * include 'attack_up' — it's a beneficial effect, not an ailment
 * (status_ailment_model.classification's beneficial_effects vs.
 * status_ailments split; requirements' "万能薬の対象を名前の否定判定で
 * 決めない" / "解除対象を明示的な一覧または分類として定義する"). See
 * effects.ts's STATUS_AILMENT_IDS/removeStatusAilment for the runtime
 * array and the single common removal entry point that iterates it.
 */
export type StatusAilmentId = 'poison' | 'movement_slow' | 'spider_web' | 'petrification';

/**
 * One currently-active instance of a temporary status effect (Phase 12.1),
 * held in GameState.activeEffects. `strength`/`remainingTurns` are copied
 * from EFFECT_DEFINITIONS at grant/refresh time rather than looked up
 * fresh each read, so a definition change would only affect newly
 * granted/refreshed effects — not required by this phase (values never
 * change mid-run) but keeps the record self-contained.
 */
export interface ActiveEffect {
  id: EffectId;
  strength: number;
  remainingTurns: number;
}

/**
 * Item species (Phase 08.2 inventory foundation; Phase 08.3 adds 'sword';
 * Phase 08.4 adds 'armor'; Phase 08.5 adds 'spear'). 'apple' is a
 * consumable; 'sword'/'spear' are equippable weapons; 'armor' is an
 * equippable piece of armor. The type is a union (not a bare string) so
 * future items extend it in one place (see src/game/item-def.ts for each
 * item's shared display data, src/game/weapon-def.ts for weapon combat
 * data, and src/game/armor-def.ts for armor combat data).
 */
export type ItemId =
  | 'apple'
  | 'sword'
  | 'armor'
  | 'spear'
  | 'hammer'
  | 'sun_fruit'
  | 'solar_gun'
  // Phase 24.3 全装備カタログ: every additional WeaponId/ArmorId species
  // folded into ItemId the same way sword/spear/hammer/armor already
  // are, so ITEM_DEFINITIONS: Record<ItemId, ItemDefinition> stays a
  // single exhaustive map — see weapon-def.ts/armor-def.ts for each
  // species' combat data and item-def.ts for its shared display data.
  | 'short_sword'
  | 'flamberge'
  | 'magic_sword'
  | 'bushido_blade'
  | 'blood_sword'
  | 'solar_sword'
  | 'dark_sword'
  | 'gram'
  | 'glaive'
  | 'corsesca'
  | 'ice_glaive'
  | 'grand_lance'
  | 'blood_spear'
  | 'white_queen'
  | 'black_queen'
  | 'gungnir'
  | 'basic_hammer'
  | 'maul'
  | 'silver_flail'
  | 'battle_axe'
  | 'bloody_mace'
  | 'dawn'
  | 'twilight'
  | 'mjolnir'
  | 'chain_mail'
  | 'plate_mail'
  | 'samurai_armor'
  | 'mail_of_sol'
  | 'mail_of_dark'
  | 'dragon_scale'
  | 'magic_robe'
  | 'skull_suit'
  | 'poison_guard'
  | 'ninja_suit'
  | 'light_garb'
  | 'dark_garb'
  | 'spike_mail'
  | 'black_armor'
  | 'sol_enchantment'
  | 'chocolate'
  | 'banana'
  | 'antidote'
  | 'panacea'
  // Phase 18.2 clairvoyance fruit: an ordinary stacking consumable (like
  // banana/antidote/panacea) whose use effect is handled by its own
  // turn.ts function rather than healAmount/solarAmount/hungerAmount —
  // see item-def.ts's ITEM_DEFINITIONS.clairvoyance_fruit doc comment.
  | 'clairvoyance_fruit'
  // Phase 14.2 five-element acquisition: one-time unlock ground items
  // for the four non-sol elements, following the same
  // pickup-directly-unlocks-and-never-enters-inventory pattern as
  // sol_enchantment (see turn.ts's ground-item pickup handling).
  | 'flame_enchantment'
  | 'frost_enchantment'
  | 'cloud_enchantment'
  | 'earth_enchantment'
  // Phase 20.0a card definition foundation: the 17 tarot-card consumable
  // ids (see CardId below and card-def.ts's CARD_DEFINITIONS) are folded
  // directly into ItemId — same pattern as every other item id above —
  // so ITEM_DEFINITIONS: Record<ItemId, ItemDefinition> stays a single
  // exhaustive map with no parallel item type. CardId itself is the
  // single source of truth for which 17 literals these are; ItemId is
  // deliberately widened to match rather than duplicating the list.
  | CardId;

/**
 * The 17 tarot cards implemented in Phase 20 (16 manually-used cards plus
 * the automatically-triggered `judgement`; `fool` is explicitly excluded
 * per rogue-of-sun-card-effects-spec.md section 1/5). Defined here (not
 * card-def.ts) for the same reason WeaponId/ArmorId live in this file:
 * ItemId is built directly from this union (see ItemId above), and
 * GameState-adjacent types may need CardId without a circular import back
 * into card-def.ts. card-def.ts's CARD_DEFINITIONS is the per-card data
 * registry keyed by this type; this type itself is only the id list.
 */
export type CardId =
  | 'high_priestess'
  | 'empress'
  | 'emperor'
  | 'lovers'
  | 'chariot'
  | 'strength'
  | 'wheel_of_fortune'
  | 'justice'
  | 'hanged_man'
  | 'death'
  | 'temperance'
  | 'devil'
  | 'tower'
  | 'star'
  | 'moon'
  | 'sun'
  | 'judgement';

/**
 * Selectable melee enchantment (Phase 10.1 sol enchant foundation). 'none'
 * is the default/off state; 'sol' is the only registered attribute this
 * phase. Player-common (not per-weapon) — see GameState.selectedEnchantment.
 */
/**
 * Attack element identifiers (Phase 14.1 five-element enchantment
 * foundation). All five are registered as types this phase, but only
 * 'sol' is actually obtainable/selectable in play — flame/frost/cloud/
 * earth have no pickup, no selection path, and stay permanently
 * unlocked: false in GameState.unlockedEnchantments (see that field's
 * doc comment). Deliberately excludes 'luna' and any weapon/equipment
 * affinity concept, per Phase 14.1's explicitly_excluded scope.
 */
export type ElementId = 'sol' | 'flame' | 'frost' | 'cloud' | 'earth';

/**
 * Damage-affinity classification for an element against a given enemy
 * (Phase 14.1): 'weak', 'neutral', 'resist'. Phase 15.3 replaced the
 * original percent-multiplier model with a small fixed additive bonus
 * per affinity — see combat.ts's ELEMENTAL_AFFINITY_BONUS_DAMAGE for the
 * single source of truth for these values.
 */
export type ElementalAffinity = 'weak' | 'neutral' | 'resist';

/**
 * Selectable melee enchantment (Phase 10.1 sol enchant foundation;
 * Phase 14.1 five-element enchantment foundation extends the union to
 * every ElementId while keeping 'none' as the existing off/default
 * state — equivalent to "ElementId or null" but expressed with the
 * pre-existing 'none' string sentinel rather than introducing null,
 * so every existing 'none' check keeps working unchanged). Only 'sol'
 * is ever reachable in play this phase — see GameState.selectedEnchantment
 * and GameState.unlockedEnchantments. Player-common (not per-weapon).
 */
export type EnchantmentId = ElementId | 'none';

/**
 * Weapon species — Phase 08.3 registered only 'sword'; Phase 08.5 added
 * 'spear'; Phase 08.7 adds 'hammer'. Deliberately a separate union from
 * the subset of ItemId values that are equippable, rather than reusing
 * ItemId directly: not every ItemId is a weapon (e.g. 'apple'/'armor'
 * never are), and this keeps weapon-only code (equippedWeaponId,
 * WEAPON_DEFINITIONS) from silently accepting a consumable's or armor's
 * id.
 */
export type WeaponId =
  | 'sword'
  | 'spear'
  | 'hammer'
  | 'solar_gun'
  // Phase 24.3 全装備カタログ: 26 additional melee weapons (9 per family
  // — sword/spear/hammer — each with 2 C, 2 B, 2 A, 2 S, and 1 R rank
  // individual) registered alongside the 4 pre-existing species. See
  // weapon-def.ts's WEAPON_DEFINITIONS for each species' full data and
  // docs/history/phase-24-3-equipment-catalog-effects.md for the
  // complete roster/rank table.
  | 'short_sword'
  | 'flamberge'
  | 'magic_sword'
  | 'bushido_blade'
  | 'blood_sword'
  | 'solar_sword'
  | 'dark_sword'
  | 'gram'
  | 'glaive'
  | 'corsesca'
  | 'ice_glaive'
  | 'grand_lance'
  | 'blood_spear'
  | 'white_queen'
  | 'black_queen'
  | 'gungnir'
  | 'basic_hammer'
  | 'maul'
  | 'silver_flail'
  | 'battle_axe'
  | 'bloody_mace'
  | 'dawn'
  | 'twilight'
  | 'mjolnir';

/**
 * Armor species — Phase 08.4 registers only 'armor'. A separate union
 * from ItemId/WeaponId for the same reason WeaponId is separate: armor
 * occupies its own independent equipment slot (equippedArmorId), distinct
 * from the weapon slot, so the two can never be confused at the type
 * level. Phase 24.3 全装備カタログ adds 14 additional armor species (15
 * total) — see armor-def.ts's ARMOR_DEFINITIONS for each species' full
 * data.
 */
export type ArmorId =
  | 'armor'
  | 'chain_mail'
  | 'plate_mail'
  | 'samurai_armor'
  | 'mail_of_sol'
  | 'mail_of_dark'
  | 'dragon_scale'
  | 'magic_robe'
  | 'skull_suit'
  | 'poison_guard'
  | 'ninja_suit'
  | 'light_garb'
  | 'dark_garb'
  | 'spike_mail'
  | 'black_armor';

/**
 * Phase 24.1 equipment rank data foundation (rogue-of-sun-development-
 * plan_.md Phase 24.1's "equipment rankとDPをどの段階で追加するか" ->
 * rank only, data-plumbing scope). Fixed order C < B < A < S < R,
 * mirroring official_phase_24_sequence's normal_floor_drop/excluded_
 * from_normal_floor_drop sets (docs/history/phase-24-0-equipment-
 * readiness-audit.md). Every currently-registered weapon/armor
 * (sword/spear/hammer/solar_gun/armor) is 'C' this phase — no rank
 * selection/weighting/combat/generation logic reads this value yet (that
 * is Phase 24.2+'s job); this phase only establishes the type, per-
 * species default, per-individual field, and normalize/carry-over
 * contract so later phases have a real field to build on instead of
 * inventing one under time pressure.
 */
export type EquipmentRank = 'C' | 'B' | 'A' | 'S' | 'R';

/**
 * Phase 20.0c equipment-instance foundation: one individual weapon or
 * armor's persistent identity and per-copy attributes, distinct from the
 * species-level WEAPON_DEFINITIONS/ARMOR_DEFINITIONS tables (which stay
 * per-species, unchanged) and from `Inventory`'s per-species counts
 * (which stay a plain count — `equipmentInstances` is the parallel
 * per-individual structure, not a replacement). `instanceId` and
 * `definitionId` are deliberately separate fields (never overloading
 * WeaponId/ArmorId's existing `id`-shaped usage as an instance
 * identifier) so a definitionId lookup into WEAPON_DEFINITIONS/
 * ARMOR_DEFINITIONS is always unambiguous, and so two held individuals
 * of the same species remain distinguishable. See
 * equipment-instance.ts's module doc comment for creation/normalization.
 */
export interface EquipmentInstance {
  /** Stable, run-unique identifier for this individual (never reused, never shared with any other instance or with any WeaponId/ArmorId/ItemId/CardId). */
  instanceId: string;
  /** Which species (WEAPON_DEFINITIONS/ARMOR_DEFINITIONS key) this individual is. */
  definitionId: WeaponId | ArmorId;
  /** Non-negative integer strengthening level, 0 for a freshly-created instance. Phase 20.0c does not itself apply this to damage/defense calculations or allow any card to change it (deferred to Phase 20.5b's Moon/Sun). */
  refineLevel: number;
  /** Whether this individual is cursed. Independent of curseRevealed — see that field's own doc comment. */
  cursed: boolean;
  /** Whether this individual's curse status has been discovered (equipping a cursed instance sets this true — see turn.ts's applyWeaponEquip/applyArmorEquip). Never true while cursed is false (normalizeEquipmentInstances corrects that combination if ever encountered — see its own doc comment). */
  curseRevealed: boolean;
  /**
   * Phase 24.1 equipment rank data foundation: this individual's rank,
   * set from its species' WEAPON_DEFINITIONS/ARMOR_DEFINITIONS `rank` at
   * mint time and never re-rolled afterward (equipment-instance.ts's
   * mintEquipmentInstance/normalizeEquipmentInstances). Not applied to
   * combat, generation weight, or AI — display/data only this phase. See
   * EquipmentRank's own doc comment for the full scope note.
   */
  rank: EquipmentRank;
  /**
   * Phase 24.3 装備効果 effectState: per-individual counters/accumulators
   * a handful of B/A/S/R weapon and armor effects need (blood weapons'
   * "1フロア2回まで" cap, battle_axe's per-floor defeated-species memory,
   * magic_robe's SOL-spend remainder, black_armor's equipped-turn
   * counter). Optional/absent on every pre-24.3 fixture and on any
   * individual whose species has no effect needing it — normalizeEquipmentInstances
   * backfills a valid default (see equipment-instance.ts) rather than
   * requiring every call site to null-check. Never shared between
   * individuals of the same definitionId (each instance's effectState is
   * its own).
   */
  effectState?: EquipmentEffectState;
}

/**
 * Phase 24.3 装備効果: the 4 per-individual effect counters/accumulators
 * documented in rogue-of-sun-development-plan_.md's effect_state
 * decision. `floorTriggerUses`/`defeatedEnemyTypes` reset to their
 * defaults (0/[]) on every floor transition (advanceToNextFloor);
 * `solSpentRemainder`/`equippedTurnCounter` persist across floors.
 */
export interface EquipmentEffectState {
  /** Times this individual's blood-defeat effect (blood_sword/blood_spear/bloody_mace) has fired this floor. Capped at 2 (curse_rules-independent, effect_timing's own "個体ごと・1フロア2回" cap) — see equipment-effects.ts. */
  floorTriggerUses: number;
  /** Total SOL actually spent while this magic_robe individual was equipped, minus whatever's already been refunded (magic_robe's own "累計5ごとにSOL1還元"). Always 0 for every non-magic_robe individual. */
  solSpentRemainder: number;
  /** World turns completed while this black_armor individual was equipped, since the last LIFE-1 tick (or since mint). Always 0 for every non-black_armor individual. */
  equippedTurnCounter: number;
  /** EnemyTypes this individual (battle_axe) has fully defeated so far this floor — never duplicated. Always [] for every non-battle_axe individual. */
  defeatedEnemyTypes: EnemyType[];
}

/** Stacked item counts held by the player; never negative, absent/0 entries are not shown in UI. */
export type Inventory = Record<ItemId, number>;

/**
 * A single item lying on the floor. `id` is a stable per-floor identifier
 * (assigned from GameState.nextGroundItemId, like WebTile.id), independent
 * of array order. Never embedded into map.terrain; kept as its own list
 * alongside actors and fixtures per design_policy.
 */
export interface GroundItem {
  id: number;
  itemId: ItemId;
  pos: Vec2;
  /**
   * Phase 20.0c equipment-instance foundation: which EquipmentInstance
   * this ground item already is, for a floor-generated weapon/armor —
   * set at floor-generation time (state.ts's buildFloorState, where the
   * curse roll also happens) so the individual's identity/curse result
   * is fixed while it's still on the floor, never re-rolled at pickup.
   * Absent for every non-equipment item (consumables, cards) and for any
   * ground item that isn't itself the origin of a floor-generated
   * equipment individual (e.g. one placed back down via place_item —
   * see turn.ts's applyPlaceItem, which now threads the same
   * equipmentInstanceId through rather than creating a fresh one).
   */
  equipmentInstanceId?: string;
  /**
   * Phase 21.5: this ground item's spawn origin. `'monster_house'` marks
   * a dedicated monster-house reward (see state.ts's buildFloorState,
   * generated after every normal ground item); every other ground item —
   * including every pre-Phase-21.5 GroundItem literal across the test
   * suite, where this field is simply absent — is treated as `'normal'`.
   * Absent/undefined behaves identically to `'normal'`. Never itself read
   * by pickup/inventory/equipment logic — purely an origin tag, mirroring
   * EnemyActor.spawnSource's Phase 21.4 pattern.
   */
  spawnSource?: 'normal' | 'monster_house';
}

export type PlayerAction =
  | { type: 'move'; direction: Direction8 }
  | { type: 'face'; direction: Direction8 }
  | { type: 'wait' }
  | { type: 'action' }
  | { type: 'use_item'; itemId: ItemId }
  // Phase 20.5a: temperance/star use a confirmed target (already
  // selected/re-validated via card-target-selection.ts's UI-layer flow
  // in main.ts) rather than the plain 'use_item' action every other card
  // uses — the target itself must travel with the action since
  // processTurn resolves in a single call with no cross-turn selection
  // state of its own. `target` is whatever confirmCardTargetSelection
  // last returned; processTurn re-validates it again itself (never
  // trusts the caller) before applying any effect.
  | { type: 'use_targeted_card'; cardId: 'temperance' | 'star'; target: import('./card-target-selection').CardTargetRef }
  // Phase 24.1: an optional equipmentInstanceId lets the caller pin down
  // exactly which held individual to act on (docs/history/phase-24-0-
  // equipment-readiness-audit.md's D1/D2/D3, resolved by phase-24-1-
  // equipment-instance-actions.md) — production UI always supplies it for
  // weapon/armor items; the plain weaponId/armorId/itemId-only shape
  // remains valid for legacy callers/fixtures and falls back to the
  // pre-24.1 "first available individual" selection in equipment-
  // instance.ts. A present-but-invalid/unowned/wrong-definition
  // equipmentInstanceId is rejected outright — turn.ts never silently
  // falls back to a different individual once one was explicitly named.
  | { type: 'equip_weapon'; weaponId: WeaponId; equipmentInstanceId?: string }
  | { type: 'equip_armor'; armorId: ArmorId; equipmentInstanceId?: string }
  // Phase 24.1: no such action existed before this phase — equipping a
  // different weapon/armor was the only way to change equippedWeaponId/
  // equippedArmorId. equipmentInstanceId is required (not optional) here:
  // an unequip always targets a specific already-equipped individual,
  // never "whichever is equipped" implicitly, so a stale UI selection
  // (the player switched floors/items between opening the menu and
  // confirming) is rejected rather than silently unequipping whatever
  // happens to be equipped now.
  | { type: 'unequip_weapon'; equipmentInstanceId: string }
  | { type: 'unequip_armor'; equipmentInstanceId: string }
  | { type: 'toggle_enchantment' }
  | { type: 'place_item'; itemId: ItemId; equipmentInstanceId?: string }
  | { type: 'discard_item'; itemId: ItemId; equipmentInstanceId?: string }
  // Phase 24.2: 太陽鍛冶コア. `materialInstanceIds` names exactly the 2
  // held weapon EquipmentInstances to consume (order-independent — see
  // solar-forge.ts's buildForgeRecipeKey). Never an ItemId-only shape:
  // the whole point of this action is identity-precise material
  // selection (development_plan's action_boundary "素材instanceIdを2つ
  // 保持する"). turn.ts's applySolarForge re-validates ownership,
  // curse-lock, and recipe existence itself before applying anything —
  // never trusts a stale caller-side selection.
  | { type: 'solar_forge'; materialInstanceIds: [string, string] };
