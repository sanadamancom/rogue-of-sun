import { directionBetweenAdjacent, isAdjacent, isOrthogonallyAdjacent } from './direction';
import { canMove, destinationOf, isInBounds, isWalkable } from './map';
import { ENEMY_DEFINITIONS } from './enemy-def';
import { ITEM_DEFINITIONS } from './item-def';
import { WEAPON_DEFINITIONS } from './weapon-def';
import { ARMOR_DEFINITIONS } from './armor-def';
import { canPlaceWebNow, expireWebs, placeWeb } from './web';
import { isSunlitAt } from './sunlight';
import { GameEvent } from './events';
import {
  Actor,
  ALL_DIRECTIONS,
  Direction8,
  DIRECTION_VECTORS,
  EnemyActor,
  EnemyType,
  GameState,
  PlayerAction,
  Vec2,
} from './types';

/** Consumed player actions required for one natural HP tick (Phase 04 initial setting). */
export const REGEN_TURNS_PER_HP = 5;

/**
 * The attack power the player's next adjacent-tile attack will deal
 * (Phase 08.3 weapon/equipment foundation): the equipped weapon's
 * attackPower if one is equipped, otherwise the permanent unarmed
 * player.attack stat. The weapon's power replaces the unarmed value; it is
 * never added on top of it, and equipping/unequipping never mutates
 * player.attack itself.
 */
export function getEffectiveAttackPower(state: GameState): number {
  if (state.equippedWeaponId) {
    return WEAPON_DEFINITIONS[state.equippedWeaponId].attackPower;
  }
  return state.player.attack;
}

/**
 * The player's current armor value (Phase 08.4 armor/defense foundation):
 * the equipped armor's armorValue if one is equipped, otherwise 0
 * (unarmored). Never added to any permanent player stat.
 */
export function getEffectiveArmorValue(state: GameState): number {
  if (state.equippedArmorId) {
    return ARMOR_DEFINITIONS[state.equippedArmorId].armorValue;
  }
  return 0;
}

/**
 * The final damage an incoming attack of `attackPower` deals to the
 * player, after armor reduction: `max(0, attackPower - armorValue)`. Per
 * design (shonen-mystery-dungeon-style, not a "minimum 1 damage" model),
 * this can reach exactly 0 — no special-cased pierce/minimum-damage
 * exists for any attacker. Every site that applies enemy damage to the
 * player's HP must route through this (see tryMeleeAttack,
 * resolveSpiderEnemy, resolveKrakenEnemy) so armor is applied uniformly.
 */
export function getIncomingDamage(state: GameState, attackPower: number): number {
  return Math.max(0, attackPower - getEffectiveArmorValue(state));
}

/**
 * Applies the player's current effective attack power to `target`,
 * pushes the resulting player_attack/enemy_defeated events, and returns
 * whether the enemy was defeated. Shared by every player-attack site
 * (adjacent melee and Phase 08.5's reach-2 spear attack) so defeat
 * handling — and any future on-hit logic — is never duplicated per
 * weapon. Never itself resolves enemy actions.
 */
function applyPlayerAttackToEnemy(state: GameState, target: EnemyActor, events: GameEvent[]): boolean {
  const damage = getEffectiveAttackPower(state);
  target.hp = Math.max(0, target.hp - damage);
  const defeated = target.hp === 0;
  events.push(
    state.equippedWeaponId
      ? { type: 'player_attack', enemyType: target.type, damage, weaponId: state.equippedWeaponId }
      : { type: 'player_attack', enemyType: target.type, damage },
  );
  if (defeated) {
    target.alive = false;
    events.push({ type: 'enemy_defeated', enemyType: target.type });
  }
  return defeated;
}

export interface TurnResult {
  /** Whether the input actually consumed a turn (false for blocked moves). */
  consumed: boolean;
  /** Whether the player attacked this turn. */
  playerAttacked: boolean;
  /** Whether the player defeated any enemy this turn. */
  enemyDefeated: boolean;
  /** Whether at least one enemy acted this turn. */
  enemyActed: boolean;
  /** Whether at least one enemy attacked the player this turn. */
  enemyAttacked: boolean;
  /** Whether the player died this turn. */
  playerDefeated: boolean;
  /** Whether the player's natural HP regeneration triggered this turn. */
  playerRegenerated: boolean;
  /**
   * Typed events produced while resolving this turn, in the exact order
   * the underlying actions occurred (player action first, then each
   * living enemy's action in state.enemies array order). Empty for
   * unconsumed/blocked inputs and for actions with nothing worth
   * announcing (e.g. a normal move or wait). See src/game/events.ts and
   * src/game/message-log.ts for the event shapes and their formatting.
   */
  events: GameEvent[];
}

function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { player, enemies, map } = state;

  // Petrified (phase-06-cockatrice-petrifying-gaze): takes priority over
  // everything else below, including the 'wait' fast path — any valid
  // input (move or wait) while petrified is entirely replaced by a forced
  // skip that still consumes the turn, then this clears. Only the very
  // next action is affected (not stacked/extended by repeat hits).
  if (player.petrified) {
    player.petrified = false;
    events.push({ type: 'player_petrified_skip' });
    return { consumed: true, attacked: false, defeated: false };
  }

  // Inventory item use (Phase 08.2): resolved before the move/wait guard
  // below so it works whether or not the inventory overlay's own
  // move/wait rejection (see processTurn) is in effect. Never itself
  // re-implements enemy AI — a successful use returns consumed: true and
  // processTurn's normal post-player-action pipeline (enemy actions,
  // regen, floor check, turn increment) runs exactly as for any other
  // consumed action.
  if (action.type === 'use_item') {
    return applyItemUse(state, action.itemId, events);
  }

  if (action.type === 'equip_weapon') {
    return applyWeaponEquip(state, action.weaponId, events);
  }

  if (action.type === 'equip_armor') {
    return applyArmorEquip(state, action.armorId, events);
  }

  // Sunlight solar charge (Phase 09.3a): folded into normal 'wait' rather
  // than a dedicated action (superseding Phase 09.3's V-only 'charge').
  // Recovers 1 SOL as a side effect of waiting on a sunlit tile below
  // maxSolarEnergy; every other wait behaves exactly as before this
  // phase. See isSunlitAt for the sunlight-layer read.
  if (action.type === 'wait') {
    state.hammerRecovery = false;
    if (isSunlitAt(state.sunlight, state.player.pos) && state.solarEnergy < state.maxSolarEnergy) {
      state.solarEnergy = Math.min(state.maxSolarEnergy, state.solarEnergy + 1);
      events.push({ type: 'solar_charge_used', recovered: 1 });
    }
    return { consumed: true, attacked: false, defeated: false };
  }

  // Facing-only input (Phase 08.6, Shift+direction): updates player.facing
  // and nothing else — no movement, no turn consumed, no enemy action.
  if (action.type === 'face') {
    player.facing = action.direction;
    return { consumed: false, attacked: false, defeated: false };
  }

  // X action (Phase 08.6): resolves an attack in the player's *current*
  // facing direction — movement input no longer attacks at all (see
  // below). Reuses the exact same adjacent/reach-2/whiff resolution used
  // to be inlined in the move branch prior to this phase.
  if (action.type === 'action') {
    // Hammer recoil (Phase 08.7): while the hammer is equipped and
    // recovering, X only "re-cocks" it — no target resolution, no
    // damage, no knockback. Still a full, turn-consuming action, and the
    // caller's normal enemy-action pipeline still runs afterward.
    if (state.equippedWeaponId === 'hammer' && state.hammerRecovery) {
      state.hammerRecovery = false;
      events.push({ type: 'hammer_recover' });
      return { consumed: true, attacked: false, defeated: false };
    }

    const result = resolveFacingAttack(state, player.facing, events);

    // Recoil bookkeeping: every hammer attack via X (hit, kill,
    // failed-knockback, or whiff) enters recoil. Attacking with any other
    // weapon (or unarmed) clears it — recoil only has meaning while the
    // hammer is the equipped weapon. Equip-switching itself never touches
    // this flag (see applyWeaponEquip): re-equipping the hammer later
    // does not implicitly clear a recoil left over from before it was
    // switched away. Phase 09.2: this only runs when the action actually
    // consumed a turn — an insufficient-SOL solar gun attempt (consumed:
    // false) must leave hammerRecovery exactly as it was (fixed_spec's
    // "SOL不足による不発ではhammerRecoveryを解除しない"), whereas every
    // melee resolution (including a whiff) always consumes, so this is a
    // no-op change for sword/spear/hammer.
    if (result.consumed) {
      state.hammerRecovery = state.equippedWeaponId === 'hammer';
    }

    return result;
  }

  // From here on, action.type === 'move'. Per fixed_decisions.movement,
  // facing always updates to the input direction — even if the move
  // itself ends up failing for any reason (wall, enemy-occupied tile, map
  // edge, or being slowed) — so this happens unconditionally before any
  // of the failure paths below.
  player.facing = action.direction;

  // Slowed (enemy-behavior-02, spider web): any 'move' input fails
  // outright (no position change) while still consuming this world turn,
  // then clears the slow. Phase 08.6 removed the "moving into an enemy
  // attacks" path entirely, so this no longer needs to reason about
  // attack-vs-step — every move is just a step attempt now.
  if (player.slowed) {
    player.slowed = false;
    state.hammerRecovery = false;
    events.push({ type: 'slowed_move_cancelled' });
    return { consumed: true, attacked: false, defeated: false };
  }

  const destination: Vec2 = destinationOf(player.pos, action.direction);

  // Phase 08.6: movement input never attacks. Stepping toward a living
  // enemy's tile is simply a blocked move (no HP change, no turn
  // consumed) — the only way to attack is the 'action' (X) input above,
  // which reads the already-updated player.facing.
  const occupiedByEnemy = enemies.some(
    (enemy) => enemy.alive && enemy.pos.x === destination.x && enemy.pos.y === destination.y,
  );
  if (occupiedByEnemy) {
    return { consumed: false, attacked: false, defeated: false };
  }

  // Otherwise, attempt a normal move.
  if (canMove(map, player.pos, action.direction)) {
    player.pos = destination;
    state.hammerRecovery = false;
    // Stepping onto a web tile slows the player (does not trigger merely
    // from a web being newly placed on the player's current tile, since
    // that never goes through this move branch). Not stacked/refreshed if
    // already slowed (can't happen here since a slowed player's move was
    // already intercepted above, but kept as a plain assignment — not an
    // increment — for clarity and safety either way).
    if (state.webs.some((web) => web.pos.x === destination.x && web.pos.y === destination.y)) {
      player.slowed = true;
      events.push({ type: 'player_webbed' });
    }
    // Auto-pickup (Phase 08.2): stepping onto a ground item tile collects
    // it as part of this same move — no extra turn, and enemies still act
    // this turn exactly as for any other normal move.
    const itemIndex = state.groundItems.findIndex(
      (item) => item.pos.x === destination.x && item.pos.y === destination.y,
    );
    if (itemIndex !== -1) {
      const item = state.groundItems[itemIndex];
      state.groundItems.splice(itemIndex, 1);
      state.inventory[item.itemId] = (state.inventory[item.itemId] ?? 0) + 1;
      events.push({ type: 'item_picked_up', itemId: item.itemId });
    }
    return { consumed: true, attacked: false, defeated: false };
  }

  // Blocked movement (wall or out of bounds): does not consume a turn.
  return { consumed: false, attacked: false, defeated: false };
}

/**
 * Resolves an attack in `direction` from the player's current position
 * (Phase 08.6 X action): checks the adjacent tile first, then — only if
 * the equipped weapon's reach is 2 or more (currently just spear) and the
 * adjacent tile was empty — the tile 2 steps away, subject to the same
 * wall/diagonal-corner-cut legality check as normal movement for each of
 * the two segments independently. If nothing is found within reach, this
 * resolves as a whiff: still a full, turn-consuming action (per
 * fixed_decisions.action), just with no damage dealt. Never moves the
 * player and never changes player.facing (the X action always attacks in
 * whatever direction the player was already facing).
 */
function resolveFacingAttack(
  state: GameState,
  direction: Direction8,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { player, enemies, map } = state;

  // Solar gun (Phase 09.2): a ranged, SOL-consuming weapon entirely
  // distinct from the adjacent/reach-2 melee resolution below — routed
  // out first so melee logic never has to reason about ray distance or
  // solar cost.
  if (state.equippedWeaponId && WEAPON_DEFINITIONS[state.equippedWeaponId].solarCost) {
    return resolveSolarGunAttack(state, direction, events);
  }

  const destination: Vec2 = destinationOf(player.pos, direction);

  const target = enemies.find(
    (enemy) => enemy.alive && enemy.pos.x === destination.x && enemy.pos.y === destination.y,
  );
  if (target) {
    const defeated = applyPlayerAttackToEnemy(state, target, events);
    if (!defeated) {
      tryKnockback(state, target, direction, events);
    }
    return { consumed: true, attacked: true, defeated };
  }

  // Reach-2 attack (Phase 08.5 spear, carried over unchanged into the X
  // action): only when the adjacent tile is empty of a living enemy
  // (handled above) — adjacent targets always take priority, never both
  // an adjacent and a 2-tile attack in the same action.
  const reach = state.equippedWeaponId ? WEAPON_DEFINITIONS[state.equippedWeaponId].reach : 1;
  if (reach >= 2) {
    // Segment 1 (player -> intervening tile) must be a legal, non-corner
    // -cutting step; canMove already encodes wall/bounds + the existing
    // diagonal corner-cut rule.
    if (canMove(map, player.pos, direction)) {
      // Segment 2 (intervening tile -> far tile) re-applies the same
      // legality check independently.
      if (canMove(map, destination, direction)) {
        const farTile = destinationOf(destination, direction);
        const farTarget = enemies.find(
          (enemy) => enemy.alive && enemy.pos.x === farTile.x && enemy.pos.y === farTile.y,
        );
        if (farTarget) {
          const defeated = applyPlayerAttackToEnemy(state, farTarget, events);
          if (!defeated) {
            tryKnockback(state, farTarget, direction, events);
          }
          return { consumed: true, attacked: true, defeated };
        }
      }
    }
  }

  // Whiff: nothing within reach in the facing direction. Still a full,
  // turn-consuming action — the caller's normal post-action pipeline
  // (enemy actions, regen, floor check, turn increment) still runs.
  events.push(
    state.equippedWeaponId
      ? { type: 'player_whiff', weaponId: state.equippedWeaponId }
      : { type: 'player_whiff' },
  );
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves the equipped weapon's knockback (Phase 08.7 hammer), if any,
 * against a surviving `target` that was just hit in `direction`. A no-op
 * for weapons with knockbackDistance 0 (sword, spear) and for immune
 * species (golem, kraken — checked explicitly here rather than by
 * changing their AI or normal movement capability). The destination tile
 * must be a legal single step from the target's current position — reusing
 * canMove applies the same wall/bounds/diagonal-corner-cut rule as normal
 * movement — and must not already be occupied by the player or another
 * living enemy; ground items and the exit tile never block it. Never
 * chains (only the directly-hit target can be pushed), never moves the
 * player, and never adds extra damage on knockback failure — a blocked
 * knockback simply leaves the target where it is, having already taken
 * the attack's normal damage.
 */
function tryKnockback(state: GameState, target: EnemyActor, direction: Direction8, events: GameEvent[]): void {
  const weaponDef = state.equippedWeaponId ? WEAPON_DEFINITIONS[state.equippedWeaponId] : null;
  if (!weaponDef || weaponDef.knockbackDistance <= 0) return;
  if (target.type === 'golem' || target.type === 'kraken') return; // immune: heavy/fixed-type

  const dest = destinationOf(target.pos, direction);
  if (!canMove(state.map, target.pos, direction)) return; // wall, bounds, or diagonal corner-cut

  const occupied =
    (state.player.pos.x === dest.x && state.player.pos.y === dest.y) ||
    state.enemies.some((e) => e !== target && e.alive && e.pos.x === dest.x && e.pos.y === dest.y);
  if (occupied) return;

  target.pos = dest;
  events.push({ type: 'enemy_knocked_back', enemyType: target.type });
}

/**
 * Resolves an X-action attack with the solar gun equipped (Phase 09.2): a
 * ranged, SOL-consuming weapon entirely separate from the melee
 * adjacent/reach-2 path in resolveFacingAttack. Checks solarEnergy first
 * — if below the weapon's solarCost, nothing happens at all (no damage,
 * no ray, no turn consumed, no SOL change), matching the fixed_spec's
 * "SOLが不足している場合は攻撃、ダメージ、ターン消費、敵行動を発生させ
 * ない" / "SOL不足時に値を負数にしない" requirements. Otherwise consumes
 * solarCost SOL unconditionally (hit, whiff, or immediate wall) and walks
 * a ray via the existing castGazeRay (reused as-is: wall/bounds/diagonal
 * corner-cut aware, terrain-only blocking — ground items and the exit
 * never obstruct it), hitting only the first living enemy found, for
 * exactly 1 damage via the shared applyPlayerAttackToEnemy path (so
 * defeat handling/events match every other weapon). Never knocks back
 * (the solar gun's knockbackDistance is 0, so tryKnockback would be a
 * no-op anyway; not called here to keep this branch self-contained).
 * Always returns consumed: true when SOL was sufficient — even a whiff
 * or an immediately-blocked ray still spends the turn and the SOL, per
 * fixed_spec.solar_consumption.
 */
function resolveSolarGunAttack(
  state: GameState,
  direction: Direction8,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const weaponId = state.equippedWeaponId as import('./types').WeaponId;
  const weaponDef = WEAPON_DEFINITIONS[weaponId];
  const solarCost = weaponDef.solarCost ?? 0;

  if (state.solarEnergy < solarCost) {
    events.push({ type: 'solar_gun_insufficient_solar' });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.solarEnergy -= solarCost;

  const reached = castGazeRay(state.map, state.player.pos, direction, weaponDef.reach);
  // Walk the ray tiles in near-to-far order (castGazeRay's return order)
  // so the closest living enemy on the line is always hit first,
  // regardless of state.enemies' array order — a naive find-over-enemies
  // would not guarantee this.
  let target: EnemyActor | undefined;
  for (const tile of reached) {
    target = state.enemies.find((enemy) => enemy.alive && enemy.pos.x === tile.x && enemy.pos.y === tile.y);
    if (target) break;
  }

  if (target) {
    const defeated = applyPlayerAttackToEnemy(state, target, events);
    return { consumed: true, attacked: true, defeated };
  }

  events.push({ type: 'player_whiff', weaponId });
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves a 'use_item' action (Phase 08.2). Only 'apple' is registered as
 * of this phase, so this only implements the healing-item path; a future
 * non-healing item would need its own branch here without touching this
 * one. Never moves the player, never itself resolves enemy actions —
 * successful uses return consumed: true and the caller (processTurn) runs
 * the normal enemy-resolution/regen/floor-check pipeline exactly as for
 * any other consumed action, so item use never reimplements enemy AI.
 */
function applyItemUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { player } = state;
  const def = ITEM_DEFINITIONS[itemId];
  const owned = state.inventory[itemId] ?? 0;

  // Guard against a stale/invalid selection (e.g. an item the player does
  // not actually have); the inventory UI only ever offers items with a
  // positive count, so this should not occur via normal play, but this
  // keeps the count invariant (never negative) even if reached directly.
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  const healAmount = def.healAmount ?? 0;
  if (healAmount > 0) {
    if (player.hp >= player.maxHp) {
      events.push({ type: 'item_use_failed', itemId, reason: 'full_hp' });
      return { consumed: false, attacked: false, defeated: false };
    }
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    const healed = player.hp - before;
    state.inventory[itemId] = owned - 1;
    events.push({ type: 'item_used', itemId, healed });
    state.inventoryOpen = false;
    return { consumed: true, attacked: false, defeated: false };
  }

  // Sun fruit (Phase 09.1): restores solar energy, never HP. Rejected
  // (no consumption, no turn) when solar energy is already at maximum —
  // mirrors apple's full_hp rejection above but on the separate solar
  // energy stat.
  const solarAmount = def.solarAmount ?? 0;
  if (solarAmount > 0) {
    if (state.solarEnergy >= state.maxSolarEnergy) {
      events.push({ type: 'sun_fruit_use_failed', itemId, reason: 'sol_full' });
      return { consumed: false, attacked: false, defeated: false };
    }
    const before = state.solarEnergy;
    state.solarEnergy = Math.min(state.maxSolarEnergy, state.solarEnergy + solarAmount);
    const recovered = state.solarEnergy - before;
    state.inventory[itemId] = owned - 1;
    events.push({ type: 'sun_fruit_used', itemId, recovered });
    state.inventoryOpen = false;
    return { consumed: true, attacked: false, defeated: false };
  }

  // No other item effect is registered yet.
  return { consumed: false, attacked: false, defeated: false };
}

/**
 * Resolves an 'equip_weapon' action (Phase 08.3). Equipping never removes
 * the weapon from the inventory (not consumable, not stackable) and never
 * touches player.attack (the permanent unarmed stat) — see
 * getEffectiveAttackPower for how equippedWeaponId is applied during
 * combat. Already-equipped is a no-op (no turn, inventory stays open);
 * an unowned weapon cannot be equipped.
 */
function applyWeaponEquip(
  state: GameState,
  weaponId: import('./types').WeaponId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[weaponId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  if (state.equippedWeaponId === weaponId) {
    events.push({ type: 'weapon_already_equipped', weaponId });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.equippedWeaponId = weaponId;
  events.push({ type: 'weapon_equipped', weaponId });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves an 'equip_armor' action (Phase 08.4). Equipping never removes
 * the armor from the inventory and never touches player.maxHp/hp, and is
 * fully independent of equippedWeaponId (equipping armor never changes
 * the equipped weapon and vice versa). Already-equipped is a no-op (no
 * turn, inventory stays open); unowned armor cannot be equipped.
 */
function applyArmorEquip(
  state: GameState,
  armorId: import('./types').ArmorId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[armorId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  if (state.equippedArmorId === armorId) {
    events.push({ type: 'armor_already_equipped', armorId });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.equippedArmorId = armorId;
  events.push({ type: 'armor_equipped', armorId });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves an attack against the player if `enemy` is adjacent to them
 * (8-direction adjacency), updating facing and player HP/alive. Returns
 * whether an attack happened. Shared by every 8-direction melee
 * behaviorType (generic_melee, slow_melee, fast_melee, recovery_melee) so
 * the attack resolution itself lives in one place.
 */
function tryMeleeAttack(state: GameState, enemy: EnemyActor, events: GameEvent[]): boolean {
  const { player } = state;
  if (!isAdjacent(enemy.pos, player.pos)) return false;
  const dir = directionBetweenAdjacent(enemy.pos, player.pos);
  if (dir) enemy.facing = dir;
  const damage = getIncomingDamage(state, enemy.attack);
  player.hp = Math.max(0, player.hp - damage);
  events.push({ type: 'enemy_attack', enemyType: enemy.type, damage });
  if (player.hp === 0) player.alive = false;
  return true;
}

/**
 * Attempts one 8-direction chase step toward the player for `enemy`,
 * against the current occupancy of the board (won't step onto the
 * player's tile or another living enemy's current tile; already-moved
 * enemies' updated positions count, dead enemies never block). Returns
 * whether a step was actually taken. Shared by every 8-direction melee
 * behaviorType.
 */
function tryChaseStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && other.alive && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  const dx = Math.sign(player.pos.x - enemy.pos.x);
  const dy = Math.sign(player.pos.y - enemy.pos.y);
  const candidateDirs = pickChaseDirections(dx, dy);
  for (const dir of candidateDirs) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    enemy.facing = dir;
    enemy.pos = dest;
    return true;
  }
  return false;
}

/**
 * Resolves one bok's action (attack or chase-move-or-wait) against the
 * current occupancy of the board. Unchanged behavior from Phase 04:
 * 8-direction adjacency and chase, now expressed via the shared
 * tryMeleeAttack/tryChaseStep helpers above instead of inline logic.
 */
function resolveBokEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy); // moves if possible; no-op (wait in place) otherwise
  return { acted: true, attacked: false };
}

/**
 * Resolves one golem's action ('slow_melee'). Golem acts every other enemy
 * turn: its phase is `(state.turn - enemy.spawnTurn) % 2`, so the very
 * first enemy turn after it's created (phase 0) is always an acting turn,
 * and every other turn thereafter alternates. On an off turn it does
 * nothing at all — no movement, and critically no attack even if already
 * adjacent to the player. On an acting turn it behaves exactly like bok
 * (attack if adjacent, otherwise one chase step).
 */
function resolveGolemEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const phase = (state.turn - (enemy.spawnTurn ?? 0)) % 2;
  if (phase !== 0) {
    // Resting turn: deliberately does not attack even if adjacent.
    events.push({ type: 'enemy_recovering', enemyType: enemy.type });
    return { acted: false, attacked: false };
  }
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/**
 * Resolves one sword's action ('fast_melee'). If already adjacent to the
 * player at the start of its turn, it attacks immediately without moving.
 * Otherwise it attempts up to 2 chase steps in the same enemy turn,
 * re-evaluating the board after each step: if it becomes adjacent after
 * the first step, it attacks and stops (no second step); if it only
 * becomes adjacent after the second step, it does not attack that turn.
 * At most one attack per enemy turn either way.
 */
function resolveSwordEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }

  const movedFirstStep = tryChaseStep(state, enemy);
  if (!movedFirstStep) {
    return { acted: true, attacked: false }; // no legal step at all; wait in place
  }
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true }; // became adjacent after step 1: attack, no step 2
  }

  // Step 2; never attacks this turn even if now adjacent. Only when this
  // second step actually happens does the movement count as the sword's
  // signature 2-tile approach worth announcing; a single successful step
  // (or none at all) is a normal move and stays silent.
  const movedSecondStep = tryChaseStep(state, enemy);
  if (movedSecondStep) {
    events.push({ type: 'sword_dash', enemyType: enemy.type });
  }
  return { acted: true, attacked: false };
}

/**
 * Resolves one axe's action ('recovery_melee'). If `enemy.recovering` is
 * set (from having attacked on its previous turn), this turn is a forced
 * wait — no movement, no attack — and the flag is cleared so the turn
 * after that is normal again. Otherwise it behaves like bok (attack if
 * adjacent, otherwise one chase step), and an attack sets `recovering` for
 * next turn. Moving without attacking never triggers recovery.
 */
function resolveAxeEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.recovering) {
    enemy.recovering = false;
    events.push({ type: 'enemy_recovering', enemyType: enemy.type });
    return { acted: false, attacked: false };
  }
  if (tryMeleeAttack(state, enemy, events)) {
    enemy.recovering = true;
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

// Fixed cardinal check order used both for the spider's move candidates and
// as the deterministic tie-break order when multiple candidates yield the
// same resulting distance to the player. Matches the N/S/E/W ordering used
// throughout ALL_DIRECTIONS.
const SPIDER_DIRECTIONS: Direction8[] = ['N', 'S', 'E', 'W'];

// Fixed diagonal check order for corner-crossing A candidate evaluation and
// tie-breaking, matching the NE/NW/SE/SW ordering used in ALL_DIRECTIONS.
const CORNER_CROSS_DIRECTIONS: Direction8[] = ['NE', 'NW', 'SE', 'SW'];

const manhattanDistance = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * True if `enemy` may use corner-crossing A to step diagonally from
 * `enemy.pos` in `dir` right now: the diagonal destination is in-bounds
 * floor with no living actor on it, and — the defining condition — *both*
 * orthogonal tiles between the current position and the diagonal
 * destination are walls (not walkable). This is the exact opposite of
 * normal diagonal-move corner-cutting (map.ts's canMove requires both
 * sides walkable); corner-crossing A requires both sides to be solid.
 */
function canCornerCross(state: GameState, enemy: EnemyActor, dir: Direction8): boolean {
  const delta = DIRECTION_VECTORS[dir];
  const from = enemy.pos;
  const dest: Vec2 = { x: from.x + delta.x, y: from.y + delta.y };

  if (!isWalkable(state.map, dest)) return false;
  if (dest.x === state.player.pos.x && dest.y === state.player.pos.y) return false;
  const occupiedByEnemy = state.enemies.some(
    (other) => other !== enemy && other.alive && other.pos.x === dest.x && other.pos.y === dest.y,
  );
  if (occupiedByEnemy) return false;

  const sideA: Vec2 = { x: from.x + delta.x, y: from.y };
  const sideB: Vec2 = { x: from.x, y: from.y + delta.y };
  // Both orthogonal sides must be solid (not walkable) — a wall corner.
  if (isWalkable(state.map, sideA) || isWalkable(state.map, sideB)) return false;

  return true;
}

/**
 * Attempts corner-crossing A for `enemy`: among the diagonal directions
 * where canCornerCross holds, picks the one whose destination minimizes
 * Manhattan distance to the player (ties broken by CORNER_CROSS_DIRECTIONS
 * order), but only actually moves if that destination is strictly closer
 * than the enemy's current position — a corner-cross that doesn't improve
 * distance to the player is never used (falls through to normal chase
 * instead). Returns whether it moved.
 */
function tryCornerCross(state: GameState, enemy: EnemyActor): boolean {
  const currentDist = manhattanDistance(enemy.pos, state.player.pos);
  let bestDir: Direction8 | null = null;
  let bestDist = Infinity;

  for (const dir of CORNER_CROSS_DIRECTIONS) {
    if (!canCornerCross(state, enemy, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    const dist = manhattanDistance(dest, state.player.pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }

  if (bestDir && bestDist < currentDist) {
    enemy.facing = bestDir;
    enemy.pos = destinationOf(enemy.pos, bestDir);
    return true;
  }
  return false;
}

/**
 * Spider's normal 4-direction-only chase step (unchanged from before
 * enemy-behavior-02): among legal cardinal move candidates, picks the one
 * minimizing Manhattan distance to the player after the move; ties are
 * broken by SPIDER_DIRECTIONS order (no RNG). Returns whether it moved.
 */
function trySpiderChaseStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && other.alive && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  let bestDir: Direction8 | null = null;
  let bestDest: Vec2 | null = null;
  let bestDist = Infinity;

  for (const dir of SPIDER_DIRECTIONS) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    const dist = manhattanDistance(dest, player.pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
      bestDest = dest;
    }
  }

  if (bestDir && bestDest) {
    enemy.facing = bestDir;
    enemy.pos = bestDest;
    return true;
  }
  return false;
}

/** Decrements webCooldown by 1 if it's currently above 0; a no-op otherwise. Never used on the same turn a web was just placed (placeWeb sets a fresh value). */
function decrementWebCooldown(enemy: EnemyActor): void {
  const current = enemy.webCooldown ?? 0;
  if (current > 0) enemy.webCooldown = current - 1;
}

/**
 * Resolves one spider's action (enemy-behavior-02), in fixed priority
 * order:
 * 1. Orthogonal-adjacency melee attack (diagonal adjacency never attacks).
 * 2. Web placement, if this spider's webCooldown is 0 and
 *    canPlaceWebNow holds (in range/line-of-sight of the player's current
 *    tile, that tile isn't already webbed). Placing consumes the whole
 *    turn — no movement or attack alongside it.
 * 3. Corner-crossing A, if it yields a strictly closer diagonal step.
 * 4. Normal cardinal (4-direction) chase.
 * 5. Wait in place if none of the above apply.
 *
 * Every branch except an actual web placement decrements this spider's own
 * webCooldown by 1 (if above 0) at the end, so "the next 3 of this
 * spider's own turns" — regardless of what action they end up taking —
 * are what its cooldown counts down across; other enemies acting never
 * affects it.
 */
function resolveSpiderEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (isOrthogonallyAdjacent(enemy.pos, state.player.pos)) {
    const dir = directionBetweenAdjacent(enemy.pos, state.player.pos);
    if (dir) enemy.facing = dir;
    const damage = getIncomingDamage(state, enemy.attack);
    state.player.hp = Math.max(0, state.player.hp - damage);
    events.push({ type: 'enemy_attack', enemyType: enemy.type, damage });
    if (state.player.hp === 0) state.player.alive = false;
    decrementWebCooldown(enemy);
    return { acted: true, attacked: true };
  }

  const eligibleToPlaceWeb = (enemy.webCooldown ?? 0) <= 0;
  if (eligibleToPlaceWeb && canPlaceWebNow(state, enemy)) {
    placeWeb(state, enemy);
    events.push({ type: 'web_placed', enemyType: enemy.type });
    return { acted: true, attacked: false };
  }

  if (tryCornerCross(state, enemy)) {
    decrementWebCooldown(enemy);
    return { acted: true, attacked: false };
  }

  trySpiderChaseStep(state, enemy); // moves if possible; no-op (wait in place) otherwise
  decrementWebCooldown(enemy);
  return { acted: true, attacked: false };
}

/** Chebyshev (8-direction) distance, matching the 8-direction move grid used by chase/retreat. */
const chebyshevDistance = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Attempts one bat retreat step (enemy-behavior-06) for `enemy`: among the
 * 8 adjacent tiles (fixed ALL_DIRECTIONS order, matching every other
 * deterministic direction scan in this file), a candidate must be a legal
 * step per canMove (in bounds, walkable, no diagonal corner-cutting), free
 * of the player and every other living enemy's current position, and
 * strictly farther from the player (Chebyshev) than the bat's current
 * position. Among candidates, picks the one with the greatest resulting
 * distance, ties broken by ALL_DIRECTIONS order. Returns whether it moved.
 */
function tryBatRetreatStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && other.alive && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  const currentDist = chebyshevDistance(enemy.pos, player.pos);
  let bestDir: Direction8 | null = null;
  let bestDest: Vec2 | null = null;
  let bestDist = -Infinity;

  for (const dir of ALL_DIRECTIONS) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    const dist = chebyshevDistance(dest, player.pos);
    if (dist <= currentDist) continue;
    if (dist > bestDist) {
      bestDist = dist;
      bestDir = dir;
      bestDest = dest;
    }
  }

  if (bestDir && bestDest) {
    enemy.facing = bestDir;
    enemy.pos = bestDest;
    return true;
  }
  return false;
}

/**
 * Resolves one bat's action ('bat_retreat', enemy-behavior-06). If this bat
 * is currently retreat-pending (set after its previous successful attack),
 * it tries tryBatRetreatStep instead of acting normally: on success it
 * consumes its whole turn (no attack/chase alongside the step) and emits
 * bat_retreat; on failure (no tile increases distance) it clears the
 * pending flag and falls through to normal bok-style behavior this same
 * turn, per spec, without emitting bat_retreat. Otherwise (not
 * retreat-pending) it behaves exactly like bok: attack if adjacent
 * (which sets retreat-pending for its next turn), else one chase step.
 */
function resolveBatEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.retreating) {
    enemy.retreating = false;
    if (tryBatRetreatStep(state, enemy)) {
      events.push({ type: 'bat_retreat', actorId: enemy.id ?? 0, enemyType: enemy.type });
      return { acted: true, attacked: false };
    }
    // No valid retreat tile: fall back to normal behavior this same turn.
  }

  if (tryMeleeAttack(state, enemy, events)) {
    enemy.retreating = true;
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/**
 * Resolves one mummy's action ('mummy_shamble', phase-06-mummy-shambling-movement).
 * If this mummy is currently rest-pending (set after its previous
 * successful chase step), it rests: no movement, no attack, even if
 * adjacent to the player, consuming its whole turn and emitting
 * mummy_shamble_rest; the pending flag is cleared and normal behavior
 * resumes on its next turn (no same-turn fallback, unlike the bat).
 * Otherwise it behaves exactly like bok: attack if adjacent (never sets
 * rest-pending), else one chase step (sets rest-pending only if the step
 * actually moved it).
 */
function resolveMummyEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.restingAfterMove) {
    enemy.restingAfterMove = false;
    events.push({ type: 'mummy_shamble_rest', actorId: enemy.id ?? 0, enemyType: enemy.type });
    return { acted: true, attacked: false };
  }

  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  if (tryChaseStep(state, enemy)) {
    enemy.restingAfterMove = true;
  }
  return { acted: true, attacked: false };
}

/** Minimum/maximum tile distance (inclusive) at which the petrifying gaze may be aimed/fired. */
const GAZE_MIN_RANGE = 2;
export const GAZE_MAX_RANGE = 5;

/**
 * If `from` and `to` lie on one of the 8 fixed lines (same row, same
 * column, or a perfect diagonal), returns that direction and the tile
 * distance along it (equal to Chebyshev distance, since alignment already
 * guarantees the line is straight). Returns null if they are not aligned
 * on any of the 8 directions (including the same-tile case).
 */
function alignedGazeDirection(from: Vec2, to: Vec2): { direction: Direction8; distance: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return { direction: dy > 0 ? 'S' : 'N', distance: Math.abs(dy) };
  if (dy === 0) return { direction: dx > 0 ? 'E' : 'W', distance: Math.abs(dx) };
  if (Math.abs(dx) !== Math.abs(dy)) return null;
  if (dx > 0 && dy < 0) return { direction: 'NE', distance: dx };
  if (dx < 0 && dy < 0) return { direction: 'NW', distance: -dx };
  if (dx > 0 && dy > 0) return { direction: 'SE', distance: dx };
  return { direction: 'SW', distance: -dx };
}

/**
 * Walks a gaze ray from `from` along `direction`, one tile at a time via
 * the existing canMove (so it stops at a wall/map edge and respects the
 * same diagonal corner-cut rule as normal movement — line of sight is
 * blocked by terrain only, never by actors), up to `maxSteps` tiles.
 * Returns every tile actually reached, in order (shorter than `maxSteps`
 * if blocked early). Exported (phase-07-1-ranged-attack-telegraph) so the
 * telegraph-rendering module can compute the exact same reachable tiles
 * used by the hit/miss check below, instead of re-deriving the range
 * logic separately for display.
 */
export function castGazeRay(map: GameState['map'], from: Vec2, direction: Direction8, maxSteps: number): Vec2[] {
  const reached: Vec2[] = [];
  let pos = from;
  for (let i = 0; i < maxSteps; i++) {
    if (!canMove(map, pos, direction)) break;
    pos = destinationOf(pos, direction);
    reached.push(pos);
  }
  return reached;
}

/**
 * Resolves one cockatrice's action ('cockatrice_gaze',
 * phase-06-cockatrice-petrifying-gaze). Priority, highest first:
 * 1. If already aimed (`gazeDirection` set from a previous turn), fires
 *    along that exact stored direction this turn — even if now adjacent
 *    to the player — so an aimed shot is never silently replaced by a
 *    melee attack (implementation_policy). Clears `gazeDirection`
 *    regardless of hit/miss.
 * 2. Otherwise, attacks normally if adjacent (never sets gazeDirection).
 * 3. Otherwise, aims if the player is on an unobstructed 2-5 tile line
 *    along one of the 8 directions: stores that fixed direction, takes no
 *    other action this turn, and never re-aims at the player's later
 *    position.
 * 4. Otherwise, falls back to a normal chase step.
 */
function resolveCockatriceEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.gazeDirection) {
    const direction = enemy.gazeDirection;
    enemy.gazeDirection = undefined;
    // Display-only bookkeeping (phase-07-1-ranged-attack-telegraph-reticle-only);
    // does not participate in the hit check below, which is unchanged.
    enemy.gazeTargetTile = undefined;
    const reached = castGazeRay(state.map, enemy.pos, direction, GAZE_MAX_RANGE);
    const hit = reached.some((tile) => tile.x === state.player.pos.x && tile.y === state.player.pos.y);
    events.push({
      type: 'cockatrice_gaze_fire',
      actorId: enemy.id ?? 0,
      enemyType: enemy.type,
      direction,
      hit,
    });
    if (hit) {
      state.player.petrified = true;
      events.push({ type: 'player_petrified', actorId: enemy.id ?? 0, enemyType: enemy.type });
    }
    return { acted: true, attacked: false };
  }

  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }

  const aligned = alignedGazeDirection(enemy.pos, state.player.pos);
  if (aligned && aligned.distance >= GAZE_MIN_RANGE && aligned.distance <= GAZE_MAX_RANGE) {
    const reached = castGazeRay(state.map, enemy.pos, aligned.direction, aligned.distance);
    if (reached.length === aligned.distance) {
      enemy.gazeDirection = aligned.direction;
      // Display-only snapshot of the aimed-at tile (phase-07-1-ranged-attack-telegraph-reticle-only);
      // hit-detection above still relies solely on gazeDirection + castGazeRay, unchanged.
      enemy.gazeTargetTile = { ...state.player.pos };
      events.push({
        type: 'cockatrice_gaze_aim',
        actorId: enemy.id ?? 0,
        enemyType: enemy.type,
        direction: aligned.direction,
      });
      return { acted: true, attacked: false };
    }
  }

  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/** Minimum/maximum Chebyshev distance (inclusive) at which the kraken may telegraph a tentacle strike. */
const KRAKEN_MIN_RANGE = 1;
const KRAKEN_MAX_RANGE = 5;

/**
 * Returns the orthogonal cross (center + N/S/W/E) centered on `center`,
 * excluding any cell outside the map. Walls are intentionally left in —
 * they only matter here as a possible (never occupiable) miss target, so
 * no special handling is needed for them. Exported
 * (phase-07-1-ranged-attack-telegraph) so the telegraph-rendering module
 * computes the exact same 5 cells used by the hit-detection below.
 */
export function tentacleCrossCells(map: GameState['map'], center: Vec2): Vec2[] {
  const candidates: Vec2[] = [
    center,
    { x: center.x, y: center.y - 1 },
    { x: center.x, y: center.y + 1 },
    { x: center.x - 1, y: center.y },
    { x: center.x + 1, y: center.y },
  ];
  return candidates.filter((pos) => isInBounds(map, pos));
}

/**
 * Resolves one kraken's action ('kraken_tentacle',
 * phase-06-kraken-telegraphed-tentacle-strike). The kraken itself never
 * moves and never makes a normal melee attack, on any turn, regardless of
 * adjacency. Priority, highest first:
 * 1. If already telegraphing (`tentacleTarget` set from a previous turn),
 *    strikes the cross centered on that exact stored coordinate this turn
 *    (never re-centered on the player's current position), clearing the
 *    field afterward win or miss. On a hit, applies damage (reusing normal
 *    HP/defeat handling) and, only if the player is still alive, attempts
 *    a deterministic 1-tile pull toward the kraken.
 * 2. Otherwise, if the player is within Chebyshev distance 1-5 (no line of
 *    sight required), telegraphs by storing the player's current
 *    coordinate (no other action that turn).
 * 3. Otherwise, waits with no event.
 */
function resolveKrakenEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const { player, map } = state;

  if (enemy.tentacleTarget) {
    const target = enemy.tentacleTarget;
    enemy.tentacleTarget = undefined;
    const area = tentacleCrossCells(map, target);
    const hit = area.some((pos) => pos.x === player.pos.x && pos.y === player.pos.y);
    const damage = hit ? getIncomingDamage(state, enemy.attack) : 0;
    events.push({
      type: 'kraken_tentacle_strike',
      enemyId: enemy.id ?? 0,
      enemyType: enemy.type,
      target,
      hit,
      damage,
    });

    if (hit) {
      player.hp = Math.max(0, player.hp - damage);
      if (player.hp === 0) player.alive = false;

      // Pull: only attempted if the player survived the hit.
      if (player.alive) {
        const dx = enemy.pos.x - player.pos.x;
        const dy = enemy.pos.y - player.pos.y;
        let moveX = 0;
        let moveY = 0;
        if (Math.abs(dx) >= Math.abs(dy)) {
          moveX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        } else {
          moveY = dy > 0 ? 1 : -1;
        }
        if (moveX !== 0 || moveY !== 0) {
          const dest: Vec2 = { x: player.pos.x + moveX, y: player.pos.y + moveY };
          const validDestination =
            isWalkable(map, dest) &&
            !(dest.x === enemy.pos.x && dest.y === enemy.pos.y) &&
            !state.enemies.some(
              (other) => other.alive && other.pos.x === dest.x && other.pos.y === dest.y,
            );
          if (validDestination) {
            const from = { ...player.pos };
            player.pos = dest;
            events.push({
              type: 'player_pulled',
              sourceEnemyId: enemy.id ?? 0,
              enemyType: enemy.type,
              from,
              to: dest,
            });
          }
        }
      }
    }

    return { acted: true, attacked: hit };
  }

  const distance = chebyshevDistance(enemy.pos, player.pos);
  if (
    player.alive &&
    distance >= KRAKEN_MIN_RANGE &&
    distance <= KRAKEN_MAX_RANGE &&
    isWalkable(map, player.pos)
  ) {
    const target: Vec2 = { ...player.pos };
    enemy.tentacleTarget = target;
    events.push({ type: 'kraken_tentacle_aim', enemyId: enemy.id ?? 0, enemyType: enemy.type, target });
    return { acted: true, attacked: false };
  }

  return { acted: false, attacked: false };
}

/**
 * Dispatches an enemy's action by its species' behaviorType (see
 * enemy-def.ts) rather than switching on species id directly, so adding a
 * finished signature AI later only requires adding a new BehaviorType case
 * here plus updating that species' definition entry.
 *
 * - 'spider_cardinal': spider's 4-direction-only chase/attack, plus web
 *   placement and corner-crossing A (enemy-behavior-02).
 * - 'slow_melee': golem's every-other-turn chase/attack (enemy-behavior-01).
 * - 'fast_melee': sword's up-to-2-steps-per-turn chase/attack
 *   (enemy-behavior-01).
 * - 'recovery_melee': axe's attack-then-forced-wait chase/attack
 *   (enemy-behavior-01).
 * - 'bat_retreat': bat's attack-then-retreat-next-turn chase/attack
 *   (enemy-behavior-06).
 * - 'mummy_shamble': mummy's move-then-rest-next-turn chase/attack
 *   (phase-06-mummy-shambling-movement).
 * - 'cockatrice_gaze': cockatrice's telegraphed-line petrifying gaze
 *   (phase-06-cockatrice-petrifying-gaze).
 * - 'kraken_tentacle': kraken's telegraphed-cross tentacle strike with pull
 *   (phase-06-kraken-telegraphed-tentacle-strike).
 * - 'generic_melee' and 'placeholder': bok's 8-direction chase/attack
 *   ('placeholder' is a reserved fallback with no current species).
 * - 'stationary': a stricter no-op fallback that never acts at all (no
 *   current species uses this).
 */
function resolveOneEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const behaviorType = ENEMY_DEFINITIONS[enemy.type].behaviorType;
  switch (behaviorType) {
    case 'spider_cardinal':
      return resolveSpiderEnemy(state, enemy, events);
    case 'slow_melee':
      return resolveGolemEnemy(state, enemy, events);
    case 'fast_melee':
      return resolveSwordEnemy(state, enemy, events);
    case 'recovery_melee':
      return resolveAxeEnemy(state, enemy, events);
    case 'bat_retreat':
      return resolveBatEnemy(state, enemy, events);
    case 'mummy_shamble':
      return resolveMummyEnemy(state, enemy, events);
    case 'cockatrice_gaze':
      return resolveCockatriceEnemy(state, enemy, events);
    case 'kraken_tentacle':
      return resolveKrakenEnemy(state, enemy, events);
    case 'stationary':
      return { acted: false, attacked: false };
    case 'generic_melee':
    case 'placeholder':
    default:
      return resolveBokEnemy(state, enemy, events);
  }
}

/**
 * Runs each living enemy's action once, in fixed array order. Stops
 * immediately once the player is defeated, so no later enemy acts against
 * an already-defeated player.
 */
function resolveEnemiesAction(
  state: GameState,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  let acted = false;
  let attacked = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const result = resolveOneEnemy(state, enemy, events);
    if (result.acted) acted = true;
    if (result.attacked) attacked = true;
    if (!state.player.alive) break;
  }

  return { acted, attacked };
}

function pickChaseDirections(dx: number, dy: number) {
  // Prefer the direct diagonal/cardinal toward the player, then fall back
  // to the pure horizontal/vertical component.
  const dirs: { x: number; y: number; name: import('./types').Direction8 }[] = [];
  const nameFor = (x: number, y: number): import('./types').Direction8 | null => {
    if (x === 0 && y === -1) return 'N';
    if (x === 0 && y === 1) return 'S';
    if (x === 1 && y === 0) return 'E';
    if (x === -1 && y === 0) return 'W';
    if (x === 1 && y === -1) return 'NE';
    if (x === -1 && y === -1) return 'NW';
    if (x === 1 && y === 1) return 'SE';
    if (x === -1 && y === 1) return 'SW';
    return null;
  };

  const primary = nameFor(dx, dy);
  if (primary) dirs.push({ x: dx, y: dy, name: primary });
  if (dx !== 0) {
    const n = nameFor(dx, 0);
    if (n) dirs.push({ x: dx, y: 0, name: n });
  }
  if (dy !== 0) {
    const n = nameFor(0, dy);
    if (n) dirs.push({ x: 0, y: dy, name: n });
  }
  return dirs.map((d) => d.name);
}

/**
 * Processes exactly one player input as a turn, per the sequence:
 * 1) resolve player action, 2) confirm result (defeat), 3) resolve each
 * living enemy's action in order (stopping early if the player dies),
 * 4) confirm player defeat, 5) process natural HP regeneration if the
 * player survived, 6) check floor progression, 7) increment turn count.
 *
 * Invalid/unused inputs and blocked moves do not consume a turn and do not
 * advance enemy actions or natural regeneration.
 */
export function processTurn(state: GameState, action: PlayerAction): TurnResult {
  if (state.phase !== 'playing') {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      events: [],
    };
  }

  // Inventory overlay open (Phase 08.2): normal move/wait/attack input is
  // rejected outright (no turn consumed) while the overlay is shown;
  // opening/closing/navigating the overlay and using an item go through
  // their own dedicated functions (see src/game/inventory.ts), not this
  // guard. 'use_item' itself is exempt so a successful use can still run
  // the full turn pipeline below.
  if (
    state.inventoryOpen &&
    action.type !== 'use_item' &&
    action.type !== 'equip_weapon' &&
    action.type !== 'equip_armor'
  ) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      events: [],
    };
  }

  const events: GameEvent[] = [];
  const { consumed, attacked, defeated } = applyPlayerAction(state, action, events);

  if (!consumed) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      // Blocked moves push nothing (events stays []), but an unconsumed
      // item-use failure (e.g. full HP) still pushes an explanatory event
      // (Phase 08.2 apple_use.full_hp requirement: "使用できない理由を表
      // 示する") — so this reflects whatever applyPlayerAction actually
      // pushed rather than always discarding it.
      events,
    };
  }

  const { acted: enemyActed, attacked: enemyAttacked } = resolveEnemiesAction(state, events);

  const playerDefeated = !state.player.alive;
  if (playerDefeated) {
    events.push({ type: 'player_defeated' });
  }

  let playerRegenerated = false;
  if (state.player.alive) {
    if (state.player.hp < state.player.maxHp) {
      state.regenProgress += 1;
      if (state.regenProgress >= REGEN_TURNS_PER_HP) {
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
        state.regenProgress = 0;
        playerRegenerated = true;
      }
    } else {
      state.regenProgress = 0;
    }
  }

  const reachedExit = state.player.pos.x === state.exit.x && state.player.pos.y === state.exit.y;
  // The staircase only unlocks once every enemy on this floor has been
  // defeated (this turn or earlier); reaching it while any enemy is alive
  // does not advance the floor.
  const stairsUnlocked = state.enemies.every((enemy) => !enemy.alive);

  state.turn += 1;
  // Web lifetime update comes last in the per-turn sequence (player
  // action -> enemy actions -> death/regen/floor checks -> turn increment
  // -> web lifetime), and uses the just-incremented turn count so a web
  // placed on turn T survives turns T..T+5 (6 total, including the
  // placement turn) and is removed starting turn T+6.
  expireWebs(state);

  if (playerDefeated) {
    state.phase = 'gameover';
  } else if (reachedExit && stairsUnlocked) {
    state.phase = state.floor >= state.totalFloors ? 'victory' : 'floor_cleared';
  }

  return {
    consumed: true,
    playerAttacked: attacked,
    enemyDefeated: defeated,
    enemyActed,
    enemyAttacked,
    playerDefeated,
    playerRegenerated,
    events,
  };
}

export function createInitialActor(pos: Vec2, hp: number, attack: number): Actor {
  return { pos, hp, maxHp: hp, attack, facing: 'S', alive: true };
}

export function createInitialEnemy(
  type: EnemyType,
  pos: Vec2,
  hp: number,
  attack: number,
  spawnTurn: number = 0,
  id: number = 0,
): EnemyActor {
  return {
    ...createInitialActor(pos, hp, attack),
    type,
    spawnTurn,
    recovering: false,
    id,
    webCooldown: 0,
  };
}
