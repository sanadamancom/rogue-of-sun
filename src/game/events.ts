import { Direction8, EnchantmentId, EnemyType, ItemId, WeaponId, ArmorId, Vec2 } from './types';

/**
 * Typed, display-agnostic record of a notable action that happened during
 * turn processing. Game logic (turn.ts) only ever constructs these; it
 * never builds display strings itself. src/game/message-log.ts (the
 * formatter) is the only place that turns a GameEvent into Japanese text,
 * so TypeScript's exhaustiveness checking on the discriminated union below
 * catches any event category the formatter forgets to handle.
 *
 * Ordering: within one processTurn call, events are pushed in the exact
 * order the underlying actions occur (player action first, then each
 * living enemy's action in state.enemies array order), so consumers can
 * render TurnResult.events as-is without re-sorting.
 */
export type GameEvent =
  // Phase 10.3.2 telemetry-correctness fix: targetId/targetHpBefore/
  // targetHpAfter/attackerId are pure observability additions (see
  // telemetry.ts's history doc for why) — they change no calculation,
  // no RNG call, no AI, no turn consumption. Before this fix,
  // telemetry.ts had to re-look-up "an enemy of this type" by scanning
  // state.enemies after the turn resolved, which silently misattributed
  // hits/kills whenever two same-species enemies existed on one floor
  // (a supported, pre-existing spawn possibility) or once the real
  // target had already died and stayed in the array (alive:false, never
  // removed). Carrying the actual EnemyActor.id and the exact HP values
  // already computed here removes any need for that re-lookup.
  | { type: 'player_attack'; enemyType: EnemyType; targetId: number; damage: number; targetHpBefore: number; targetHpAfter: number; weaponId?: WeaponId }
  | { type: 'enemy_attack'; enemyType: EnemyType; attackerId: number; damage: number }
  // Phase 10.3 accuracy/evasion foundation: pushed instead of
  // 'player_attack'/'enemy_attack' when a confirmed attack attempt (a
  // target tile was already found — never a whiff) fails its hit roll.
  // hitChance/roll are the exact inputs to combat.ts's resolvesAsHit, so
  // any observer (tests, a future debug overlay) can reconstruct the
  // outcome without re-deriving it.
  | { type: 'player_attack_missed'; enemyType: EnemyType; targetId: number; weaponId?: WeaponId; hitChance: number; roll: number }
  | { type: 'enemy_attack_missed'; enemyType: EnemyType; attackerId: number; hitChance: number; roll: number }
  | { type: 'enemy_defeated'; enemyType: EnemyType; targetId: number }
  | { type: 'enemy_recovering'; enemyType: EnemyType }
  | { type: 'sword_dash'; enemyType: EnemyType }
  | { type: 'web_placed'; enemyType: EnemyType }
  | { type: 'bat_retreat'; actorId: number; enemyType: EnemyType }
  | { type: 'mummy_shamble_rest'; actorId: number; enemyType: EnemyType }
  | { type: 'cockatrice_gaze_aim'; actorId: number; enemyType: EnemyType; direction: Direction8 }
  | {
      type: 'cockatrice_gaze_fire';
      actorId: number;
      enemyType: EnemyType;
      direction: Direction8;
      hit: boolean;
    }
  | { type: 'player_petrified'; actorId: number; enemyType: EnemyType }
  | { type: 'player_petrified_skip' }
  | { type: 'kraken_tentacle_aim'; enemyId: number; enemyType: EnemyType; target: Vec2 }
  | {
      type: 'kraken_tentacle_strike';
      enemyId: number;
      enemyType: EnemyType;
      target: Vec2;
      hit: boolean;
      damage: number;
    }
  | { type: 'player_pulled'; sourceEnemyId: number; enemyType: EnemyType; from: Vec2; to: Vec2 }
  | { type: 'player_webbed' }
  | { type: 'slowed_move_cancelled' }
  | { type: 'floor_advanced' }
  | { type: 'player_defeated' }
  | { type: 'item_picked_up'; itemId: ItemId }
  // Phase 11.1 inventory capacity: pushed instead of 'item_picked_up' when
  // GameState.inventory is already at INVENTORY_CAPACITY, so the ground
  // item is left in place (see turn.ts's move handling). Follows the same
  // reason-tagged shape as 'item_use_failed' below.
  | { type: 'item_pickup_failed'; itemId: ItemId; reason: 'inventory_full' }
  | { type: 'item_used'; itemId: ItemId; healed: number }
  | { type: 'item_use_failed'; itemId: ItemId; reason: 'full_hp' }
  // Phase 11.2 place/discard: reasons mirror the shared blocked-condition
  // set (ground_occupied only applies to place; equipped/item_unavailable
  // apply to both).
  | { type: 'item_placed'; itemId: ItemId }
  | { type: 'item_place_failed'; itemId: ItemId; reason: 'ground_occupied' | 'equipped' | 'item_unavailable' }
  | { type: 'item_discarded'; itemId: ItemId }
  | { type: 'item_discard_failed'; itemId: ItemId; reason: 'equipped' | 'item_unavailable' }
  | { type: 'sun_fruit_used'; itemId: ItemId; recovered: number }
  | { type: 'sun_fruit_use_failed'; itemId: ItemId; reason: 'sol_full' }
  // Phase 11.3 hunger: chocolate_used/chocolate_use_failed follow the same
  // shape as sun_fruit_used/sun_fruit_use_failed above. hunger_low_warning
  // and hunger_zero_warning are pushed at most once per dip (see
  // GameState.hungerLowWarned/hungerZeroWarned). starvation_damage is
  // pushed each time the starvation interval ticks over into damage;
  // death itself still goes through the existing generic
  // 'player_defeated' event below (no separate death-cause event —
  // starvation_damage immediately preceding player_defeated in the same
  // turn's event list is how a starvation death is identified).
  | { type: 'chocolate_used'; itemId: ItemId; recovered: number }
  | { type: 'chocolate_use_failed'; itemId: ItemId; reason: 'hunger_full' }
  | { type: 'hunger_low_warning' }
  | { type: 'hunger_zero_warning' }
  | { type: 'starvation_damage'; damage: number }
  | { type: 'solar_gun_insufficient_solar' }
  | { type: 'solar_charge_used'; recovered: number }
  | { type: 'weapon_equipped'; weaponId: WeaponId }
  | { type: 'weapon_already_equipped'; weaponId: WeaponId }
  | { type: 'armor_equipped'; armorId: ArmorId }
  | { type: 'armor_already_equipped'; armorId: ArmorId }
  | { type: 'player_whiff'; weaponId?: WeaponId }
  | { type: 'enemy_knocked_back'; enemyType: EnemyType }
  | { type: 'hammer_recover' }
  // Sol melee enchantment (Phase 10.1 sol enchant foundation).
  | { type: 'sol_enchantment_acquired' }
  | { type: 'enchantment_toggled'; selected: EnchantmentId }
  | {
      type: 'sol_enchantment_used';
      weaponId: WeaponId;
      enemyType: EnemyType;
      solBefore: number;
      solAfter: number;
      baseDamage: number;
      bonusDamage: number;
    };
