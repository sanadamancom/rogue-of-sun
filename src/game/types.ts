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
 * `trapType` to support poison_trap alongside it): a fixture (per
 * Fixture's 'trap' literal, reserved since Phase 02 but never backed by
 * real data until Phase 12.2), not an actor or ground item. `id` is
 * stable per-floor (unique across all traps on a floor regardless of
 * type — slow_trap and poison_trap share one id sequence via a single
 * GameState.traps array, per implementation_policy's "鈍足罠と毒罠で別々
 * のGameState配列を作る"禁止). `triggered` starts false (hidden, dormant,
 * renders identically to plain floor) and becomes true the instant the
 * player's own successful move lands on its tile — a triggered trap is
 * revealed but permanently inert (one_shot), stays in the array (so it
 * keeps rendering its "revealed and inactive" symbol) and never fires
 * again.
 */
export interface TrapTile {
  id: number;
  pos: Vec2;
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
   * The currently equipped armor, or null for unarmored (Phase 08.4).
   * Independent of equippedWeaponId — equipping one never affects the
   * other. Equipping never removes the armor from `inventory` and never
   * changes player.maxHp/hp — see turn.ts's getEffectiveArmorValue for how
   * this is applied when the player takes damage. Persists across floor
   * transitions like `inventory`/`equippedWeaponId`; resets to null on a
   * brand new run.
   */
  equippedArmorId: ArmorId | null;
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
export type EffectId = 'attack_up' | 'movement_slow' | 'poison';

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
  | 'sol_enchantment'
  | 'chocolate'
  | 'banana'
  | 'antidote'
  | 'panacea'
  // Phase 14.2 five-element acquisition: one-time unlock ground items
  // for the four non-sol elements, following the same
  // pickup-directly-unlocks-and-never-enters-inventory pattern as
  // sol_enchantment (see turn.ts's ground-item pickup handling).
  | 'flame_enchantment'
  | 'frost_enchantment'
  | 'cloud_enchantment'
  | 'earth_enchantment';

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
 * Integer-percent multiplier applied to an element's base damage
 * (Phase 14.1): 'weak' (150%), 'neutral' (100%, the only value any
 * current EnemyDefinition uses — see enemy-def.ts), 'resist' (50%).
 * See combat.ts's ELEMENTAL_AFFINITY_PERCENT for the single source of
 * truth for these percentages.
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
export type WeaponId = 'sword' | 'spear' | 'hammer' | 'solar_gun';

/**
 * Armor species — Phase 08.4 registers only 'armor'. A separate union
 * from ItemId/WeaponId for the same reason WeaponId is separate: armor
 * occupies its own independent equipment slot (equippedArmorId), distinct
 * from the weapon slot, so the two can never be confused at the type
 * level.
 */
export type ArmorId = 'armor';

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
}

export type PlayerAction =
  | { type: 'move'; direction: Direction8 }
  | { type: 'face'; direction: Direction8 }
  | { type: 'wait' }
  | { type: 'action' }
  | { type: 'use_item'; itemId: ItemId }
  | { type: 'equip_weapon'; weaponId: WeaponId }
  | { type: 'equip_armor'; armorId: ArmorId }
  | { type: 'toggle_enchantment' }
  | { type: 'place_item'; itemId: ItemId }
  | { type: 'discard_item'; itemId: ItemId };
