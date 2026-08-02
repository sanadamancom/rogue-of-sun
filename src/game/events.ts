import { AbilityId, Direction8, EffectId, ElementalAffinity, ElementId, EnchantmentId, EnemyType, ItemId, StatusAilmentId, TrapType, WeaponId, ArmorId, Vec2 } from './types';

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
  // Phase 14.2 five-element acquisition: fired once, the turn a
  // flame/frost/cloud/earth pickup is collected (never for sol, which
  // keeps using sol_enchantment_acquired above unchanged). Idempotent
  // against a hypothetical duplicate exactly like sol_enchantment_
  // acquired (never happens this phase, only one of each is ever
  // placed per run).
  | { type: 'element_enchantment_acquired'; element: ElementId }
  | { type: 'enchantment_toggled'; selected: EnchantmentId }
  | {
      type: 'sol_enchantment_used';
      weaponId: WeaponId;
      enemyType: EnemyType;
      solBefore: number;
      solAfter: number;
      baseDamage: number;
      bonusDamage: number;
      // Phase 14.1 five-element enchantment foundation: bonusDamage keeps
      // its existing meaning (the enchantment's final, affinity-adjusted
      // damage — still 10 for every current 'neutral'-affinity enemy,
      // matching every pre-14.1 result exactly). These two fields expose
      // which element/affinity produced it without adding a new event or
      // changing event count/ordering.
      element: 'sol';
      affinity: ElementalAffinity;
    }
  // Phase 12.1 common temporary-effect foundation. 'effect_granted' fires
  // when banana grants attack_up with no prior instance active;
  // 'effect_refreshed' fires when banana renews an already-active
  // instance back to full duration (never both in the same use — see
  // effects.ts's grantOrRefreshEffect). 'effect_expired' fires once, the
  // turn an active effect's remainingTurns reaches 0 via
  // advanceEffectDurations. 'banana_use_failed' fires when a banana is
  // used while attack_up is already at its maximum (full) duration.
  | { type: 'effect_granted'; effectId: EffectId; strength: number; remainingTurns: number }
  | { type: 'effect_refreshed'; effectId: EffectId; strength: number; remainingTurns: number }
  | { type: 'effect_expired'; effectId: EffectId }
  | { type: 'banana_use_failed'; itemId: ItemId; reason: 'effect_at_max' }
  // Phase 12.2 slow trap: fired the instant the player's own successful
  // move lands on a previously-untriggered trap tile. One-shot (this
  // trap object's `triggered` flips to true and never fires again), so
  // this event can only occur at most once per trap per run. The
  // resulting movement_slow grant/refresh is reported separately via the
  // generic 'effect_granted'/'effect_refreshed' events above (no payload
  // duplication) — this event exists purely to identify the trigger
  // moment itself for messaging/telemetry.
  // Phase 12.2 slow_trap, extended in Phase 12.3 with `trapType` so
  // multiple trap kinds sharing one event shape can still be told apart
  // (poison_trap_triggered's distinct message text depends on this).
  // Fired the instant the player's own successful move lands on a
  // previously-untriggered trap tile. One-shot per trap (that trap
  // object's `triggered` flips to true and never fires again), so this
  // event can only occur at most once per trap per run. The resulting
  // effect grant/refresh is reported separately via the generic
  // 'effect_granted'/'effect_refreshed' events above (no payload
  // duplication) — this event exists purely to identify the trigger
  // moment (and which trap type) itself for messaging/telemetry.
  | { type: 'trap_triggered'; trapType: TrapType }
  // Phase 12.3 poison trap: fired once per successful player turn while
  // poison is active (after the turn the trap that granted it was
  // triggered), applying poison's fixed per-tick damage. `actualDamage`
  // is the real HP loss (never the theoretical strength value — HP is
  // clamped at 0, so a near-death player takes less than 3), matching
  // the same "record what actually happened, not the nominal amount"
  // convention as player_attack's/enemy_attack's own damage fields.
  | { type: 'poison_damage'; actualDamage: number; hpBefore: number; hpAfter: number }
  // Phase 12.4 status-ailment removal foundation. 'effect_removed' is the
  // generic explicit-removal counterpart to 'effect_expired' (natural
  // 0-duration end) — see effects.ts's removeEffect/removeStatusAilment
  // doc comments for why these two stay distinct rather than one event
  // covering both. `effectId` is typed StatusAilmentId (not EffectId)
  // because this event also covers spider_web/petrification, which live
  // outside activeEffects — 'attack_up' can never appear here (it's
  // excluded from StatusAilmentId entirely; status_ailment_model.
  // requirements's "attack_upについてeffect_removedを発行しない" is thus
  // enforced at the type level, not just by convention). `reason`
  // distinguishes which item caused the removal. One 'effect_removed' is
  // pushed per status ailment actually removed (e.g. panacea curing all
  // 4 pushes 4 of these), never one aggregate event.
  | { type: 'effect_removed'; effectId: StatusAilmentId; reason: 'antidote' | 'panacea' }
  // Antidote (Phase 12.4): cures only 'poison'. 'removedEffectIds' is an
  // array (always length 1 in practice, since antidote only ever targets
  // one ailment) rather than a single id, so its payload shape matches
  // panacea's below and both can be handled uniformly by any future
  // shared UI/telemetry code.
  | { type: 'antidote_used'; itemId: ItemId; removedEffectIds: StatusAilmentId[] }
  | { type: 'antidote_use_failed'; itemId: ItemId; reason: 'not_poisoned' }
  // Panacea (Phase 12.4): cures every currently-active ailment among
  // STATUS_AILMENT_IDS in one use. 'removedEffectIds' lists exactly which
  // ones were actually active and removed this use (never the full
  // STATUS_AILMENT_IDS list regardless of what was actually cured).
  | { type: 'panacea_used'; itemId: ItemId; removedEffectIds: StatusAilmentId[] }
  | { type: 'panacea_use_failed'; itemId: ItemId; reason: 'no_status_ailment' }
  // Phase 13.1 experience/level/ability-point progression foundation.
  // 'experience_gained' fires exactly once per enemy actually defeated
  // (see turn.ts's applyPlayerAttackToEnemy, the sole enemy_defeated
  // choke point); amount always equals that enemy's
  // EnemyDefinition.experienceReward. 'player_leveled_up' fires once per
  // level actually gained that same turn (ascending order for a
  // multi-level gain) — never fired for a defeat that doesn't cross a
  // level threshold.
  | { type: 'experience_gained'; amount: number; enemyId: number; enemyType: EnemyType; level: number; experience: number }
  | { type: 'player_leveled_up'; previousLevel: number; newLevel: number; abilityPointsGained: number; unspentAbilityPoints: number }
  // Phase 13.2 ability point allocation foundation. Pushed exactly once
  // per successful 1-point allocation (see ability.ts's
  // allocateAbilityPoint, the sole place this event is constructed) —
  // never for a cancelled confirmation or a rejected (0-point/invalid-id)
  // request.
  | { type: 'ability_point_spent'; ability: AbilityId; abilityDisplayName: string; previousValue: number; newValue: number; remainingAbilityPoints: number };
