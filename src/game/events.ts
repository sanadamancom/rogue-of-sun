import { Direction8, EnemyType, ItemId, WeaponId, ArmorId, Vec2 } from './types';

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
  | { type: 'player_attack'; enemyType: EnemyType; damage: number; weaponId?: WeaponId }
  | { type: 'enemy_attack'; enemyType: EnemyType; damage: number }
  | { type: 'enemy_defeated'; enemyType: EnemyType }
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
  | { type: 'item_used'; itemId: ItemId; healed: number }
  | { type: 'item_use_failed'; itemId: ItemId; reason: 'full_hp' }
  | { type: 'sun_fruit_used'; itemId: ItemId; recovered: number }
  | { type: 'sun_fruit_use_failed'; itemId: ItemId; reason: 'sol_full' }
  | { type: 'solar_gun_insufficient_solar' }
  | { type: 'weapon_equipped'; weaponId: WeaponId }
  | { type: 'weapon_already_equipped'; weaponId: WeaponId }
  | { type: 'armor_equipped'; armorId: ArmorId }
  | { type: 'armor_already_equipped'; armorId: ArmorId }
  | { type: 'player_whiff'; weaponId?: WeaponId }
  | { type: 'enemy_knocked_back'; enemyType: EnemyType }
  | { type: 'hammer_recover' };
