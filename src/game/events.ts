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
  // Phase 23.1 solar gun element foundation: `element` is an optional,
  // purely observational addition — the ElementId actually activated on
  // this hit (melee enchantment or the solar gun's own lens), or absent
  // when no element activated at all (a plain unenchanted hit). Never
  // read by combat/defeat logic itself, which already receives the same
  // value directly as a function argument (turn.ts's
  // applyPlayerAttackToEnemy -> defeatEnemyIfNeeded) — this field exists
  // only so observers (tests, telemetry, a future debug overlay) can see
  // it without re-deriving it from the more detailed sol_enchantment_used
  // / element_enchantment_used / solar_gun_element_fired events below.
  | { type: 'player_attack'; enemyType: EnemyType; targetId: number; damage: number; targetHpBefore: number; targetHpAfter: number; weaponId?: WeaponId; element?: ElementId }
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
  // Phase 24.4b enemy drops: pushed once, immediately after
  // 'enemy_defeated', when this genuine terminal defeat's drop roll
  // succeeded and a valid placement cell was found (never pushed on a
  // failed roll or a discarded-for-no-valid-cell drop — those produce no
  // event at all, per producer_decisions' "配置不能・抽選失敗を通常の
  // プレイヤーログへ大量表示しない"). `equipmentInstanceId` is present
  // only when `itemId` resolved to a weapon/armor species. See
  // turn.ts's defeatEnemyIfNeeded (the single terminal-defeat choke
  // point) and enemy-drop.ts.
  | {
      type: 'enemy_drop_spawned';
      enemyId: number;
      enemyType: EnemyType;
      itemId: ItemId;
      pos: Vec2;
      equipmentInstanceId?: string;
      /**
       * Phase 24.4c: identical purpose/contract to 'item_picked_up's
       * own unidentifiedCard field above — true when itemId is a
       * not-yet-identified card, baked in at push time (turn.ts) so
       * message-log.ts's formatEvent stays state-independent. Absent/
       * false for every non-card item and for an already-identified
       * card.
       */
      unidentifiedCard?: boolean;
      /**
       * Phase 24.4d1: the player-visible name to show for this pickup,
       * pre-resolved at push time via item-identification.ts's
       * getDisplayedItemName (same baked-in-at-push-time pattern as
       * unidentifiedCard above, generalized to ordinary consumables and
       * weapon/armor definitions). Absent falls back to the existing
       * unidentifiedCard/ITEM_DEFINITIONS lookup in formatEvent, so
       * older test fixtures that never set this keep working unchanged.
       */
      displayName?: string;
    }
  // Phase 23.1 skeleton revival: pushed instead of 'enemy_defeated' when
  // a body-form skeleton's HP reaches 0 from an attack that did not
  // activate any element — the skeleton stays on the board as a head
  // (alive: true, EnemyActor.skeletonForm: 'head') rather than being
  // fully defeated, so no experience/drop/enemy_defeated event fires
  // this turn. See turn.ts's defeatEnemyIfNeeded.
  | { type: 'skeleton_headified'; targetId: number }
  // Pushed instead of any damage/defeat event when an attack that did
  // not activate any element hits an already-head-form skeleton: the
  // hit has no effect at all (form, revive timer, and HP all stay
  // exactly as they were) — this is the only feedback the player gets
  // for that turn's attack.
  | { type: 'skeleton_head_attack_no_effect'; targetId: number }
  // Pushed once a head-form skeleton reverts to 'body' (turn.ts's
  // resolveSkeletonRevivals, checked once per world turn): always at
  // its own existing tile (never a new position), always at max HP.
  | { type: 'skeleton_revived'; targetId: number }
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
  // Phase 23.2 golem charge redesign: pushed once when an idle golem
  // fixes its charge direction (never re-derived from the player's
  // later position — see turn.ts's resolveGolemChargeEnemy). `target`
  // is the player's tile at the moment of telegraphing, display-only
  // (mirroring kraken_tentacle_aim's `target` field).
  | { type: 'golem_charge_telegraphed'; enemyId: number; enemyType: EnemyType; direction: import('./types').Direction4; target: Vec2 }
  // Pushed once, the turn a telegraphed golem actually charges —
  // whether or not it moved any tiles or attacked the player.
  // `distanceMoved` is how many tiles it actually advanced (0 if the
  // very first step was already blocked); `attackedPlayer` is whether
  // it stopped adjacent to the player and attempted exactly one
  // ordinary attack (win or miss — see resolveEnemyAttackHit, which
  // pushes its own enemy_attack/enemy_attack_missed event for the
  // outcome; this event never duplicates that damage/hit information).
  | { type: 'golem_charge_executed'; enemyId: number; enemyType: EnemyType; direction: import('./types').Direction4; distanceMoved: number; attackedPlayer: boolean }
  // Phase 23.4: pushed once when a hidden steps detects the player at
  // exactly Chebyshev distance 1 and fixes its 3x3 spike attack center
  // (never re-derived from the player's later position — see turn.ts's
  // resolveStepsEnemy).
  | { type: 'steps_spike_telegraphed'; enemyId: number; center: Vec2 }
  // Pushed once, the turn a telegraphed steps actually executes its
  // spike attack — whether or not the player was in the affected area.
  // `playerWasInArea` distinguishes a real hit attempt (in which case
  // resolveEnemyAttackHit separately pushes its own enemy_attack/
  // enemy_attack_missed event for the outcome; this event never
  // duplicates that damage/hit information) from a clean miss because
  // the player had simply moved away.
  | { type: 'steps_spike_executed'; enemyId: number; center: Vec2; playerWasInArea: boolean }
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
      /**
       * Phase 24.4d1: the player-visible name to show for this pickup,
       * pre-resolved at push time via item-identification.ts's
       * getDisplayedItemName (same baked-in-at-push-time pattern as
       * unidentifiedCard above, generalized to ordinary consumables and
       * weapon/armor definitions). Absent falls back to the existing
       * unidentifiedCard/ITEM_DEFINITIONS lookup in formatEvent, so
       * older test fixtures that never set this keep working unchanged.
       */
      displayName?: string;
    }
  // Phase 11.1 inventory capacity: pushed instead of 'item_picked_up' when
  // GameState.inventory is already at INVENTORY_CAPACITY, so the ground
  // item is left in place (see turn.ts's move handling). Follows the same
  // reason-tagged shape as 'item_use_failed' below.
  | { type: 'item_pickup_failed'; itemId: ItemId; reason: 'inventory_full'; displayName?: string }
  | { type: 'item_used'; itemId: ItemId; healed: number }
  | { type: 'item_use_failed'; itemId: ItemId; reason: 'full_hp'; displayName?: string }
  // Phase 11.2 place/discard: reasons mirror the shared blocked-condition
  // set (ground_occupied only applies to place; equipped/item_unavailable
  // apply to both).
  | { type: 'item_placed'; itemId: ItemId; displayName?: string }
  | { type: 'item_place_failed'; itemId: ItemId; reason: 'ground_occupied' | 'equipped' | 'item_unavailable' | 'invalid_instance'; displayName?: string }
  | { type: 'item_discarded'; itemId: ItemId; displayName?: string }
  | { type: 'item_discard_failed'; itemId: ItemId; reason: 'equipped' | 'item_unavailable' | 'invalid_instance'; displayName?: string }
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
  // Phase 24.1: 'invalid_instance' covers an explicitly-named
  // equipmentInstanceId that doesn't resolve to a currently-held
  // individual of the requested species (stale selection, unowned,
  // wrong species) — see turn.ts's applyWeaponEquip/applyArmorEquip.
  | { type: 'weapon_equip_blocked'; weaponId: WeaponId; reason: 'cursed' | 'invalid_instance'; displayName?: string }
  | { type: 'armor_equip_blocked'; armorId: ArmorId; reason: 'cursed' | 'invalid_instance'; displayName?: string }
  // Phase 24.1: successful return to bare hands / no armor via the new
  // unequip_weapon/unequip_armor actions (turn.ts's applyWeaponUnequip/
  // applyArmorUnequip). weaponId/armorId is the species that was equipped
  // just before this unequip.
  | { type: 'weapon_unequipped'; weaponId: WeaponId }
  | { type: 'armor_unequipped'; armorId: ArmorId }
  // Phase 24.1: 'stale' means the given equipmentInstanceId no longer
  // matches the currently-equipped individual (or nothing is equipped);
  // 'cursed' means the currently-equipped individual is a discovered
  // curse. Neither ever changes equipment/inventory/turn state.
  | { type: 'weapon_unequip_blocked'; reason: 'stale' | 'cursed' }
  | { type: 'armor_unequip_blocked'; reason: 'stale' | 'cursed' }
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
  // Phase 23.1 solar gun element foundation: pushed on every solar-gun
  // hit instead of sol_enchantment_used/element_enchantment_used —
  // reusing either of those would distort their existing meaning (both
  // imply an *additional* SOL cost beyond the weapon's own; the solar
  // gun's element never costs more than its single fixed solarCost, so
  // solBefore/solAfter would misleadingly show no change). `element` is
  // never null: the solar gun always fires through some lens (defaulting
  // to sol — see turn.ts's getSolarGunEffectiveElement), so this fires
  // on every successful solar-gun hit, whichever lens is active.
  | {
      type: 'solar_gun_element_fired';
      element: ElementId;
      affinity: ElementalAffinity;
      enemyType: EnemyType;
      targetId: number;
      physicalDamage: number;
      elementalDamage: number;
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
  // Phase 24.3 poison_guard: a poison application was blocked outright
  // (never granted/refreshed) because the player currently has
  // poison_guard equipped — distinct from effect_removed (nothing was
  // active to remove; the grant itself never happened).
  | { type: 'effect_blocked'; effectId: 'poison'; reason: 'poison_guard' }
  // Phase 24.3 spike_mail: 1 reflect damage dealt back to an adjacent
  // enemy that just dealt positive damage to the player.
  | { type: 'spike_mail_reflected'; enemyType: EnemyType; targetId: number; damage: number }
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
  // Phase 24.4d1 general item identification: fired at most once per
  // ItemId (weapon/armor definitionId or ordinary consumable ItemId),
  // the first time markGeneralItemIdentified succeeds for it this run —
  // see item-identification.ts's markGeneralItemIdentified doc comment.
  // Never fired for cards (own 'card_identified' event above) or for
  // always-identified ids (solar_gun, the 5 one-time unlock pickups).
  | { type: 'general_item_identified'; itemId: ItemId }
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
  | { type: 'card_refine_applied'; cardId: CardId; instanceId: string; refineLevelBefore: number; refineLevelAfter: number }
  // Phase 21.7: fired exactly once, the same turn Phase 21.3's
  // applyMonsterHouseReveal actually flips a monster house from
  // 'hidden' to 'revealed' (never on re-entry, never on a blocked/
  // unsuccessful move, never on floor generation). Deliberately carries
  // no unseen information (no room coordinates, enemy count, or reward
  // count) — see message-log.ts's formatEvent for the fixed notification
  // text this maps to.
  | { type: 'monster_house_revealed' }
  // Phase 24.2 太陽鍛冶コア: pushed exactly once on a successful forge —
  // event_and_log's "素材2個と完成品を識別できる情報を保持する". The 2
  // material instanceIds are always the exact ids the action named
  // (never re-derived), `outputInstanceId` is the freshly-minted
  // instance's id (never reused). Never pushed on failure/cancel/stale
  // selection — see 'solar_forge_failed' below for that case.
  | {
      type: 'solar_forge_completed';
      materialInstanceIds: [string, string];
      outputDefinitionId: WeaponId;
      outputInstanceId: string;
    }
  // Phase 24.2: pushed instead of 'solar_forge_completed' whenever the
  // action is rejected outright (no recipe, invalid/duplicate/cursed
  // material, unsafe equipped state) — never distinguishes curse from
  // any other rejection at the event/message level (curse_rules's
  // "失敗ログは呪いを断定しない汎用文言にする").
  | { type: 'solar_forge_failed'; reason: 'duplicate_instance' | 'invalid_instance' | 'not_weapon' | 'cursed' | 'no_recipe' | 'unsafe_equipped_state' }
  // Phase 24.4e1 能動的な呪い付与経路: internal-telemetry-only record of
  // one successful active curse application (mummy's on-hit curse or
  // curse_trap's on-trigger curse — never the generation-time curse roll
  // floor/monsterHouse/enemy-drop/Star already have their own routes
  // for). `source` distinguishes which route applied it;
  // `equipmentInstanceId`/`itemId` carry the real, un-obscured identity
  // (telemetry.rules' "内部telemetryでは真ID保持可") — message-log.ts
  // never reads this event's payload to build player-visible text
  // (telemetry.rules' "player-visible message生成にtelemetry payloadを
  // 直接使わない"; see 'curse_trap_result' below for curse_trap's actual
  // player-facing event). `equipped`/`revealed` mirror the instance's
  // resulting cursed/curseRevealed state at the moment this event is
  // pushed. Never pushed on a failed chance roll or a 0-candidate
  // scope — only on an actual `cursed = true` write.
  | { type: 'equipment_cursed'; source: 'mummy_hit' | 'curse_trap'; equipmentInstanceId: string; itemId: WeaponId | ArmorId; equipped: boolean; revealed: boolean }
  // Phase 24.4e1: curse_trap's player-facing outcome, always pushed
  // exactly once per curse_trap trigger (never duplicated, never omitted
  // — turn.ts's trap-trigger loop pushes this immediately after
  // 'trap_triggered' for a curse_trap specifically). `displayName` is
  // only ever set for `outcome: 'equipped'` (curse_trap_spec.player_
  // message.equipped_target's "表示名はPhase 24.4d1のresolverを使う" —
  // pre-resolved by turn.ts via item-identification.ts's
  // getDisplayedItemName, so message-log.ts never needs equipment-
  // instance/identification lookups of its own here); `outcome:
  // 'unequipped'`/`'no_target'` never carry a displayName, so the real
  // ItemId/instance/slot can never leak through this event
  // (player_message.unequipped_target's "真のItemId・名称・対象slotを
  // 漏らさない").
  | { type: 'curse_trap_result'; outcome: 'no_target' | 'equipped' | 'unequipped'; displayName?: string };
