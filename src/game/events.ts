import { AbilityId, CardId, Direction8, EffectId, ElementalAffinity, ElementId, EnchantmentId, EnemyType, ItemId, StatusAilmentId, TrapType, WeaponId, ArmorId, Vec2 } from './types';

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
  | {
      type: 'item_picked_up';
      itemId: ItemId;
      /**
       * Phase 20.0b: true when `itemId` is a not-yet-identified card
       * (see card-def.ts's CardId/CARD_DEFINITIONS and types.ts's
       * GameState.identifiedCardIds). message-log.ts's formatEvent reads
       * this to show CARD_DEFINITIONS[itemId].unidentifiedDisplayName
       * instead of the real name — baked into the event at push time
       * (turn.ts, which has state access) rather than looked up inside
       * formatEvent (which stays state-independent/pure) so this one
       * event type is the only place identification-awareness enters
       * message formatting. Absent/false for every non-card item, and
       * for a card whose species is already identified.
       */
      unidentifiedCard?: boolean;
    }
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
  // Phase 20.2 zero-effect-success contract: lovers always succeeds
  // (consume/identify/turn), even at full SOL — this event reports the
  // actual recovered amount (0 when already full), same shape as
  // sun_fruit_used above, so message-log.ts can distinguish "recovered
  // some" from "already full" without a new generic mechanism.
  | { type: 'lovers_used'; recovered: number }
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
  // Phase 15.2 recovery/satiety/status rebalance: pushed each time
  // HUNGER_DECREASE_INTERVAL ticks over into an actual 1-point satiety
  // decrease (mirrors starvation_damage's own per-trigger-only shape
  // above) — a background bookkeeping event with no dedicated user-facing
  // message (message-log.ts's hunger_low_warning/hunger_zero_warning
  // already communicate the meaningful satiety-status changes to the
  // player), used by telemetry.ts to reconstruct satiety's minimum value
  // and total natural consumption over a run without re-deriving
  // HUNGER_DECREASE_INTERVAL/HUNGER_DECREASE_AMOUNT itself.
  | { type: 'satiety_decreased'; amount: number; satietyAfter: number }
  | { type: 'solar_gun_insufficient_solar' }
  | { type: 'solar_charge_used'; recovered: number }
  | { type: 'weapon_equipped'; weaponId: WeaponId }
  | { type: 'weapon_already_equipped'; weaponId: WeaponId }
  | { type: 'armor_equipped'; armorId: ArmorId }
  | { type: 'armor_already_equipped'; armorId: ArmorId }
  // Phase 20.0c equipment-instance foundation: pushed instead of
  // 'weapon_equipped'/'armor_equipped' when the currently-equipped
  // individual is a discovered curse (cursed && curseRevealed) and the
  // player tried to equip a different weapon/armor. No inventory,
  // equipment, or turn change accompanies this event.
  | { type: 'weapon_equip_blocked'; weaponId: WeaponId; reason: 'cursed' }
  | { type: 'armor_equip_blocked'; armorId: ArmorId; reason: 'cursed' }
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
  // Phase 14.3 five-element combat effects: the shared activation event
  // for flame/frost/cloud/earth (sol keeps using sol_enchantment_used
  // above, unchanged). One event per successful hit that activates a
  // non-sol enchantment — never a separate event per element, per
  // other_element_events's "属性ごとに四種類のイベント名を作らない".
  // Pushed immediately after the triggering player_attack, before any
  // enemy_defeated check, mirroring sol_enchantment_used's position.
  | {
      type: 'element_enchantment_used';
      element: Exclude<ElementId, 'sol'>;
      affinity: ElementalAffinity;
      weaponId: WeaponId;
      enemyType: EnemyType;
      solBefore: number;
      solAfter: number;
      physicalDamage: number;
      elementalDamage: number;
    }
  // Phase 15.3 SOL/element/ability rebalance: pushed instead of a
  // silent no-op when an eligible, selected, unlocked element simply
  // lacks enough SOL for this specific hit — see turn.ts's
  // applyPlayerAttackToEnemy for the exact trigger condition (distinct
  // from "no element selected", which still pushes nothing at all).
  | { type: 'element_activation_failed'; element: ElementId; reason: 'insufficient_sol' }
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
  // Phase 18.1/18.2: fired the instant a TrapTile's `revealed` flips
  // false -> true — either from the player's own successful move landing
  // on a still-hidden trap tile (source: 'step', always immediately
  // followed by 'trap_triggered' for that same trap in the same
  // processTurn call — see turn.ts's move branch), or from a clairvoyance
  // fruit use (source: 'clairvoyance', never followed by 'trap_triggered'
  // — clairvoyance never sets `triggered`). Never fired for a trap that
  // was already revealed (see turn.ts's revealTrap, the single shared
  // entry point for both sources).
  | { type: 'trap_revealed'; trapType: TrapType; source: 'step' | 'clairvoyance' }
  // Phase 18.2 clairvoyance fruit: fired once per use, regardless of how
  // many traps existed or were newly revealed (revealedCount can be 0 —
  // see turn.ts's applyClairvoyanceUse, which always succeeds once
  // ownership is confirmed). message-log.ts branches its wording on
  // whether revealedCount > 0.
  | { type: 'clairvoyance_used'; itemId: ItemId; revealedCount: number }
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
  | { type: 'ability_point_spent'; ability: AbilityId; abilityDisplayName: string; previousValue: number; newValue: number; remainingAbilityPoints: number }
  // Phase 20.1/20.2/20.3 card core loop. 'cardId' is always the real
  // CardId (never withheld) since a successful use is exactly the moment
  // that species becomes identified (see turn.ts's applyCardUse) — by
  // the time this event exists, showing the real name is correct, not a
  // leak. 'card_use_failed' likewise always carries the real cardId: the
  // player already knows which entry they selected (it was visible,
  // if unidentified, as CARD_DEFINITIONS[cardId].unidentifiedDisplayName
  // in the Inventory list they chose it from — message-log.ts's
  // formatEvent looks up the correct display name itself rather than
  // this event pre-resolving one), so no additional information is
  // disclosed by including the id here.
  | { type: 'card_used'; cardId: CardId }
  | { type: 'card_use_failed'; cardId: CardId; reason: 'sealed' | 'not_implemented' | 'no_valid_target' | 'no_effect' | 'insufficient_resource' | 'refine_cap_reached' }
  | { type: 'card_identified'; cardId: CardId }
  // Phase 20.3: judgement's automatic death-interrupt. Fired at most once
  // per death-confirmation point (turn.ts's playerDefeated check), never
  // alongside 'player_defeated' for the same confirmation (see turn.ts's
  // doc comment there) — the two are mutually exclusive per turn.
  | { type: 'judgement_triggered' }
  // Phase 20.4 room-wide combat cards (justice/devil/tower). One
  // 'card_room_damage' per affected enemy (never per-card-use), so a
  // 0-target use produces none of these; 'card_room_effect_resolved'
  // always fires exactly once per successful use regardless of
  // targetCount, explicitly reporting 0 when the room was empty/the
  // player was on a corridor tile (rogue-of-sun-development-plan.md
  // 20.4's "対象となる敵がいなかったことをログへ出す").
  | {
      type: 'card_room_damage';
      cardId: CardId;
      enemyType: import('./types').EnemyType;
      targetId: number;
      damage: number;
      targetHpBefore: number;
      targetHpAfter: number;
    }
  | { type: 'card_room_effect_resolved'; cardId: CardId; targetCount: number }
  // tower only: the self-inflicted portion of its simultaneous
  // resolution, reported separately from 'card_room_damage' (which is
  // enemy-only) since the player is never one of getSameRoomEnemies'
  // targets.
  | { type: 'card_self_damage'; cardId: CardId; damage: number; hpBefore: number; hpAfter: number }
  // Phase 20.5a: temperance/star's successful target-selected effect.
  // Pushed exactly once per success, alongside the ordinary card_used
  // event finishSuccessfulCardUse already pushes — carries the resolved
  // target (never a stale/unconfirmed one, since this only fires after
  // resolveCardTargetEffect returns success) for message-log.ts/telemetry
  // to describe without re-deriving it.
  | { type: 'card_target_effect_resolved'; cardId: CardId; target: import('./card-target-selection').CardTargetRef }
  // Phase 20.5b: moon/sun's refineLevel increase on the currently-
  // equipped instance. Fires on every success, including the
  // zero-effect case (already at EQUIPMENT_REFINE_LEVEL_CAP) — compare
  // refineLevelBefore/After to tell them apart without a separate flag.
  | { type: 'card_refine_applied'; cardId: CardId; instanceId: string; refineLevelBefore: number; refineLevelAfter: number };
