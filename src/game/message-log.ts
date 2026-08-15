import { ENEMY_DEFINITIONS } from './enemy-def';
import { ITEM_DEFINITIONS } from './item-def';
import { EFFECT_DEFINITIONS } from './effects';
import { ELEMENT_DISPLAY_NAMES } from './element-def';
import { CARD_DEFINITIONS } from './card-def';
import { GameEvent } from './events';

/**
 * Converts one GameEvent into its Japanese display string. The `switch`
 * over `event.type` plus the `never`-typed default below make TypeScript
 * fail to compile if a new GameEvent category is added here without a
 * matching case, per design_policy's exhaustiveness requirement.
 */
export function formatEvent(event: GameEvent): string {
  switch (event.type) {
    case 'player_attack': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      if (event.weaponId) {
        const weaponName = ITEM_DEFINITIONS[event.weaponId].displayName;
        return `${weaponName}で${name}に${event.damage}ダメージ。`;
      }
      return `${name}に${event.damage}ダメージ。`;
    }
    case 'enemy_attack': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      if (event.damage === 0) {
        return `${name}の攻撃！ アーマーで防ぎ、ダメージを受けなかった。`;
      }
      return `${name}の攻撃！ ${event.damage}ダメージを受けた。`;
    }
    case 'player_attack_missed': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      if (event.weaponId) {
        const weaponName = ITEM_DEFINITIONS[event.weaponId].displayName;
        return `${weaponName}で${name}を攻撃したが、外れた。`;
      }
      return `${name}を攻撃したが、外れた。`;
    }
    case 'enemy_attack_missed': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}の攻撃！ 外れた。`;
    }
    case 'enemy_defeated': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}をたおした。`;
    }
    // Phase 23.1 skeleton revival: only skeleton ever produces these
    // three event types, so the display name is a fixed literal rather
    // than an ENEMY_DEFINITIONS lookup (these events carry no
    // enemyType field — targetId alone is enough for telemetry/tests to
    // identify which skeleton).
    case 'skeleton_headified':
      return 'スケルトンの体がくずれ、頭部だけが残った。';
    case 'skeleton_head_attack_no_effect':
      return 'スケルトンの頭部には効かなかった。';
    case 'skeleton_revived':
      return 'スケルトンの頭部が体を取り戻した。';
    case 'enemy_recovering': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}は動きを止めている。`;
    }
    case 'sword_dash': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}が一気に距離をつめた。`;
    }
    case 'web_placed': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}はクモの巣をはった。`;
    }
    case 'bat_retreat': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}はひらりと距離を取った。`;
    }
    case 'mummy_shamble_rest': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}は足を止めて体勢を整えた。`;
    }
    case 'cockatrice_gaze_aim': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}がこちらへ石化光線の狙いを定めた。`;
    }
    case 'cockatrice_gaze_fire': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return event.hit ? `${name}の石化光線を浴びた。` : `${name}の石化光線が放たれた。`;
    }
    case 'player_petrified':
      return '体が石のように動かない。';
    case 'player_petrified_skip':
      return '体が石のように動かない。';
    case 'kraken_tentacle_aim': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}が足元を狙っている！`;
    }
    case 'kraken_tentacle_strike': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      if (!event.hit) return `${name}の触手が空を切った。`;
      if (event.damage === 0) return `${name}の触手が襲いかかったが、アーマーで防いだ。`;
      return `${name}の触手が襲いかかり、${event.damage}ダメージ！`;
    }
    case 'player_pulled':
      return '触手に引き寄せられた！';
    // Phase 23.2 golem charge redesign: minimal "丸まった"/"突進した"
    // lines per fixed_spec's events.rules — no large dedicated log
    // detail beyond these two, matching cockatrice/kraken's aim/strike
    // lines in style.
    case 'golem_charge_telegraphed': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}が丸まった！`;
    }
    case 'golem_charge_executed': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}が突進した！`;
    }
    // Phase 23.4: only steps ever produces these two events, so — like
    // the skeleton-only events above — the display name is a fixed
    // literal rather than an ENEMY_DEFINITIONS lookup (these events
    // carry no enemyType field; enemyId alone is enough for tests/
    // telemetry to identify which steps).
    case 'steps_spike_telegraphed':
      return 'ステップスが地面から棘を出す気配を見せた！';
    case 'steps_spike_executed':
      return 'ステップスが地面から棘を突き出した！';
    case 'player_webbed':
      return 'クモの巣に足をとられた。';
    case 'slowed_move_cancelled':
      return '足が動かず、その場にとどまった。';
    case 'floor_advanced':
      return '次のフロアへ進んだ。';
    case 'player_defeated':
      return '力尽きた。';
    case 'item_picked_up': {
      const name =
        event.displayName ??
        (event.unidentifiedCard
          ? CARD_DEFINITIONS[event.itemId as import('./types').CardId].unidentifiedDisplayName
          : ITEM_DEFINITIONS[event.itemId].displayName);
      return `${name}をひろった。`;
    }
    case 'item_pickup_failed': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.itemId].displayName;
      return `荷物がいっぱいで、${name}をひろえない。`;
    }
    case 'item_used': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を食べた。HPが${event.healed}回復した。`;
    }
    case 'item_use_failed': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.itemId].displayName;
      return `HPは満タンで、${name}は使えない。`;
    }
    case 'item_placed': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を足元に置いた。`;
    }
    case 'item_place_failed': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.itemId].displayName;
      if (event.reason === 'ground_occupied') return `足元には既に何かあり、${name}を置けない。`;
      if (event.reason === 'equipped') return `装備中の${name}は置けない。`;
      return `${name}を置けない。`;
    }
    case 'item_discarded': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を捨てた。`;
    }
    case 'item_discard_failed': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.itemId].displayName;
      if (event.reason === 'equipped') return `装備中の${name}は捨てられない。`;
      return `${name}を捨てられない。`;
    }
    case 'sun_fruit_used':
      return '太陽の実を使い、太陽エネルギーが回復した。';
    case 'sun_fruit_use_failed':
      return '太陽エネルギーは満タンだ。';
    case 'lovers_used':
      return event.recovered > 0 ? `恋人を使い、SOLが${event.recovered}回復した。` : '恋人を使ったが、SOLは満タンだった。';
    case 'chocolate_used':
      return `チョコレートを食べ、満腹度が${event.recovered}回復した。`;
    case 'chocolate_use_failed':
      return '満腹度は満タンで、チョコレートは使えない。';
    case 'hunger_low_warning':
      return 'お腹が空いてきた。食料を探そう。';
    case 'hunger_zero_warning':
      return '空腹で力が入らない…このままでは危険だ。';
    case 'starvation_damage':
      return `空腹でLIFEが${event.damage}減った。`;
    // Phase 15.2 recovery/satiety/status rebalance: satiety_decreased is a
    // background bookkeeping event with no dedicated user-facing message
    // — hunger_low_warning/hunger_zero_warning above already communicate
    // the meaningful satiety-status changes to the player, and surfacing
    // every routine 1-point decrease (once every HUNGER_DECREASE_INTERVAL
    // turns) would spam the log with no new information. formatEvents
    // filters out this empty string before returning, so it never shows
    // as a blank line.
    case 'satiety_decreased':
      return '';
    case 'solar_gun_insufficient_solar':
      return '太陽エネルギーが足りない。';
    case 'solar_charge_used':
      return '太陽光を吸収し、SOLが1回復した。';
    case 'weapon_equipped': {
      const name = ITEM_DEFINITIONS[event.weaponId].displayName;
      return `${name}を装備した。`;
    }
    case 'weapon_already_equipped': {
      const name = ITEM_DEFINITIONS[event.weaponId].displayName;
      return `${name}はすでに装備している。`;
    }
    case 'armor_equipped': {
      const name = ITEM_DEFINITIONS[event.armorId].displayName;
      return `${name}を装備した。`;
    }
    case 'armor_already_equipped': {
      const name = ITEM_DEFINITIONS[event.armorId].displayName;
      return `${name}はすでに装備している。`;
    }
    case 'weapon_equip_blocked': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.weaponId].displayName;
      if (event.reason === 'invalid_instance') {
        return `${name}を装備できなかった。`;
      }
      return `装備中の武器が呪われていて、${name}に持ち替えられない。`;
    }
    case 'armor_equip_blocked': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.armorId].displayName;
      if (event.reason === 'invalid_instance') {
        return `${name}を装備できなかった。`;
      }
      return `装備中の防具が呪われていて、${name}に着替えられない。`;
    }
    case 'weapon_unequipped': {
      const name = ITEM_DEFINITIONS[event.weaponId].displayName;
      return `${name}を外した。`;
    }
    case 'armor_unequipped': {
      const name = ITEM_DEFINITIONS[event.armorId].displayName;
      return `${name}を外した。`;
    }
    case 'weapon_unequip_blocked': {
      if (event.reason === 'cursed') {
        return '装備中の武器が呪われていて、外せない。';
      }
      return '武器を外せなかった。';
    }
    case 'armor_unequip_blocked': {
      if (event.reason === 'cursed') {
        return '装備中の防具が呪われていて、外せない。';
      }
      return '防具を外せなかった。';
    }
    case 'accessory_equipped': {
      const name = ITEM_DEFINITIONS[event.accessoryId].displayName;
      return `${name}を装備した。`;
    }
    case 'accessory_already_equipped': {
      const name = ITEM_DEFINITIONS[event.accessoryId].displayName;
      return `${name}はすでに装備している。`;
    }
    case 'accessory_equip_blocked': {
      const name = event.displayName ?? ITEM_DEFINITIONS[event.accessoryId].displayName;
      return `${name}を装備できなかった。`;
    }
    case 'accessory_unequipped': {
      const name = ITEM_DEFINITIONS[event.accessoryId].displayName;
      return `${name}を外した。`;
    }
    case 'accessory_unequip_blocked': {
      return 'アクセサリーを外せなかった。';
    }
    case 'player_whiff':
      return '空振りした。';
    case 'enemy_knocked_back': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}を吹き飛ばした。`;
    }
    case 'hammer_recover':
      return 'ハンマーを構え直した。';
    case 'sol_enchantment_acquired':
      return 'ソルエンチャントを取得した。';
    case 'element_enchantment_acquired':
      return `${ELEMENT_DISPLAY_NAMES[event.element]}エンチャントを取得した。`;
    case 'enchantment_toggled':
      return event.selected === 'none'
        ? 'エンチャントを解除した。'
        : `エンチャントを${ELEMENT_DISPLAY_NAMES[event.selected]}に切り替えた。`;
    case 'sol_enchantment_used':
      // Phase 14.5: differentiates weak/neutral/resist so a player can
      // tell a weak hit from a plain neutral one during playtesting —
      // deferred from Phase 14.1/14.3 (event.affinity has existed on
      // this payload since Phase 14.1, this just finally reads it here).
      if (event.affinity === 'weak') return 'ソルの力が弱点を突いた！';
      if (event.affinity === 'resist') return 'ソルの力が軽減された。';
      return 'ソルの力が攻撃に宿った。';
    case 'element_enchantment_used': {
      // Phase 14.5: same weak/neutral/resist differentiation as sol
      // above, generalized to the other four elements via
      // ELEMENT_DISPLAY_NAMES. Detailed numeric damage-breakdown display
      // remains deferred (fixed_specification's "ダメージ内訳の詳細表示
      // はPhase 14.5へ持ち越す" — this is wording only, no numbers).
      const name = ELEMENT_DISPLAY_NAMES[event.element];
      if (event.affinity === 'weak') return `${name}の力が弱点を突いた！`;
      if (event.affinity === 'resist') return `${name}の力が軽減された。`;
      return `${name}の力が攻撃に宿った。`;
    }
    // Phase 23.1 solar gun element foundation: dedicated line, never
    // reusing sol_enchantment_used/element_enchantment_used's wording
    // (see this event's own doc comment in events.ts for why) — same
    // weak/neutral/resist differentiation as melee enchantment.
    case 'solar_gun_element_fired': {
      const name = ELEMENT_DISPLAY_NAMES[event.element];
      if (event.affinity === 'weak') return `太陽銃の${name}が弱点を突いた！`;
      if (event.affinity === 'resist') return `太陽銃の${name}が軽減された。`;
      return `太陽銃の${name}が撃ち込まれた。`;
    }
    // Phase 15.3 SOL/element/ability rebalance: step_3's "SOL不足による
    // 属性不発をログとtelemetryで識別可能にする" — a dedicated line,
    // distinct from a plain unenchanted hit (which has no line of its
    // own at all), so the player can tell "I meant to enchant this but
    // couldn't afford it" from "I simply have no element selected".
    case 'element_activation_failed': {
      const name = ELEMENT_DISPLAY_NAMES[event.element];
      return `SOLが足りず、${name}の力を発動できなかった。`;
    }
    case 'effect_granted': {
      // Phase 12.2/12.3: movement_slow's and poison's grant messages are
      // fixed wording (fixed_specification.messages.applied for each
      // trap), distinct from attack_up's banana-flavored line — both
      // branches of this case already hardcode their triggering item/
      // source in the message text (the existing attack_up line names
      // "バナナ" explicitly), so branching by effectId here is consistent
      // with that existing precedent rather than a new pattern.
      if (event.effectId === 'movement_slow') {
        return '体が重くなった。';
      }
      if (event.effectId === 'poison') {
        return '毒に侵された。';
      }
      const name = EFFECT_DEFINITIONS[event.effectId].displayName;
      return `バナナを食べ、${name}が${event.strength}上がった。`;
    }
    case 'effect_refreshed': {
      if (event.effectId === 'movement_slow') {
        return '体が重くなった。';
      }
      if (event.effectId === 'poison') {
        return '毒がさらに体を巡った。';
      }
      const name = EFFECT_DEFINITIONS[event.effectId].displayName;
      return `バナナを食べ、${name}の効果が残り${event.remainingTurns}ターンに更新された。`;
    }
    case 'effect_expired': {
      if (event.effectId === 'movement_slow') {
        return '体の重さがなくなった。';
      }
      if (event.effectId === 'poison') {
        return '毒が抜けた。';
      }
      const name = EFFECT_DEFINITIONS[event.effectId].displayName;
      return `${name}の効果が切れた。`;
    }
    case 'banana_use_failed':
      return '攻撃力上昇はすでに最大時間有効で、バナナは使えない。';
    case 'trap_triggered':
      return event.trapType === 'poison_trap'
        ? '毒の罠を踏んだ！'
        : event.trapType === 'curse_trap'
          ? '禍々しい罠を踏んだ！'
          : '鈍足の罠を踏んだ！';
    // Phase 24.4e1: internal telemetry only (see events.ts's own doc
    // comment on 'equipment_cursed') — never player-visible. formatEvents
    // filters out this empty string before returning, same as
    // 'trap_revealed' above.
    case 'equipment_cursed':
      return '';
    case 'curse_trap_result':
      if (event.outcome === 'no_target') return '何も起こらなかった。';
      if (event.outcome === 'equipped') return `${event.displayName}が呪われていることに気づいた！`;
      return '持ち物に不吉な気配が宿った。';
    // Phase 24.4e2: internal telemetry only, never player-visible — see
    // events.ts's own doc comment on each. formatEvents filters out
    // these empty strings before returning, same as 'trap_revealed'/
    // 'equipment_cursed' above.
    case 'equipment_curse_generated':
    case 'equipment_curse_discovered':
    case 'cursed_equipment_equipped':
    case 'curse_lock_rejected':
    case 'equipment_uncursed':
    case 'cursed_equipment_discarded':
      return '';
    // Phase 18.1/18.2: trap_revealed has no dedicated user-facing line of
    // its own — the player-move ('step') case is always immediately
    // followed by 'trap_triggered' in the same turn's event list, whose
    // existing message above already communicates the discovery; a
    // separate "罠を発見した" line for the same instant would just
    // duplicate it (telemetry.simultaneous_step's "プレイヤー向け既存ログ
    // を二重表示しない"). The 'clairvoyance' case is summarized once by
    // 'clairvoyance_used' below instead of per-trap. formatEvents filters
    // out this empty string before returning, so it never shows as a
    // blank line.
    case 'trap_revealed':
      return '';
    case 'clairvoyance_used':
      return event.revealedCount > 0 ? 'フロアの罠が見えるようになった。' : '罠は見つからなかった。';
    // Phase 24.5d grigri_glasses: single summary line per activation,
    // same pattern as clairvoyance_used above — the per-trap
    // 'trap_revealed' events stay silent (see that case's own doc
    // comment) so this is the only user-visible line for this effect.
    case 'grigri_glasses_activated':
      return event.revealedCount > 0 ? 'フロアの罠が見えるようになった。' : '罠は見つからなかった。';
    case 'poison_damage':
      return `毒で${event.actualDamage}ダメージを受けた。`;
    case 'antidote_used':
      return '毒消しを使った。';
    case 'antidote_use_failed':
      return '今は毒に侵されていない。';
    case 'panacea_used':
      return '万能薬を使った。';
    case 'panacea_use_failed':
      return '今は治す状態異常がない。';
    case 'effect_removed':
      // Phase 12.4: a fixed, single "状態異常が治った。" line regardless
      // of which specific ailment(s) were removed or how many
      // 'effect_removed' events fired this same use (status_ailment_
      // model/messages.restrictions's "解除された状態異常ごとに大量の
      // 重複メッセージを表示しない") — the per-ailment detail lives in
      // the event payload for telemetry/debugging, not in repeated user-
      // facing text. Never reuses poison's natural-expiry wording ("毒が
      // 抜けた。"), per messages.restrictions's "自然終了のメッセージを
      // 流用しない".
      return event.reason === 'antidote' ? '毒が消えた。' : '状態異常が治った。';
    case 'experience_gained':
      return `経験値を${event.amount}得た。`;
    case 'player_leveled_up':
      return `レベルが${event.newLevel}に上がった。\n能力ポイントを1得た。`;
    case 'ability_point_spent':
      return `${event.abilityDisplayName}に1ポイント割り振った。`;
    case 'card_used': {
      const name = CARD_DEFINITIONS[event.cardId].displayName;
      return `${name}を使った。`;
    }
    case 'card_use_failed': {
      // Real name shown deliberately (see events.ts's card_use_failed
      // doc comment): the player already selected this entry by its
      // then-current displayed name, so no new information leaks here.
      const name = CARD_DEFINITIONS[event.cardId].displayName;
      if (event.reason === 'sealed') return `封印されていて、${name}は使えない。`;
      if (event.reason === 'no_valid_target') return `${name}を使ったが、対象がいない。`;
      if (event.reason === 'no_effect') return `${name}を使ったが、何も起こらなかった。`;
      if (event.reason === 'insufficient_resource') return `SOLが足りず、${name}を使えない。`;
      if (event.reason === 'refine_cap_reached') return `${name}を使ったが、これ以上強化できない。`;
      return `${name}はまだ使えない。`;
    }
    case 'card_identified': {
      const name = CARD_DEFINITIONS[event.cardId].displayName;
      return `${name}の正体がわかった。`;
    }
    case 'general_item_identified': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}の正体がわかった。`;
    }
    case 'judgement_triggered':
      return '審判のカードが輝き、死の淵から生還した。';
    case 'card_room_damage': {
      const cardName = CARD_DEFINITIONS[event.cardId].displayName;
      const enemyName = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${cardName}の効果で${enemyName}に${event.damage}のダメージ。`;
    }
    case 'card_room_effect_resolved': {
      const cardName = CARD_DEFINITIONS[event.cardId].displayName;
      return event.targetCount > 0 ? `${cardName}の効果が及んだ。` : `${cardName}を使ったが、対象がいなかった。`;
    }
    case 'card_self_damage': {
      const cardName = CARD_DEFINITIONS[event.cardId].displayName;
      return `${cardName}の効果で自分自身に${event.damage}のダメージ。`;
    }
    case 'card_target_effect_resolved': {
      const cardName = CARD_DEFINITIONS[event.cardId].displayName;
      return `${cardName}の効果が対象へ及んだ。`;
    }
    case 'card_refine_applied': {
      const cardName = CARD_DEFINITIONS[event.cardId].displayName;
      return event.refineLevelAfter > event.refineLevelBefore
        ? `${cardName}の効果で装備の輝きが増した。（+${event.refineLevelAfter}）`
        : `${cardName}を使ったが、これ以上輝きは増さなかった。`;
    }
    case 'solar_forge_completed': {
      const name = ITEM_DEFINITIONS[event.outputDefinitionId].displayName;
      return `太陽鍛冶で${name}が完成した。`;
    }
    case 'solar_forge_failed':
      return '太陽鍛冶に失敗した。';
    case 'monster_house_revealed':
      return 'モンスターハウスだ！';
    case 'effect_blocked':
      return '毒を防いだ！';
    case 'spike_mail_reflected': {
      const enemyName = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${enemyName}に${event.damage}のダメージを反射した。`;
    }
    case 'enemy_drop_spawned': {
      const itemName =
        event.displayName ??
        (event.unidentifiedCard
          ? CARD_DEFINITIONS[event.itemId as import('./types').CardId].unidentifiedDisplayName
          : ITEM_DEFINITIONS[event.itemId].displayName);
      return `「${itemName}」を落とした。`;
    }
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Unhandled game event: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Formats a sequence of events (already in occurrence order) into display
 * lines, collapsing consecutive identical lines into one (Phase 12.4
 * addition). This matters when panacea cures multiple status ailments in
 * a single use: turn.ts pushes one 'effect_removed' GameEvent per
 * ailment actually cured (status_ailment_model.requirements's "解除した
 * 状態異常1種類につきeffect_removedを1回発行する" — an event-level
 * granularity requirement, for telemetry/testing purposes), but each of
 * those formats to the same fixed "状態異常が治った。" text, and showing
 * that sentence 2-4 times in a row would violate messages.restrictions's
 * "解除された状態異常ごとに大量の重複メッセージを表示しない". Collapsing
 * only *consecutive* duplicates (not all duplicates anywhere in the
 * batch) keeps this narrowly scoped to that situation — no other
 * existing event type ever produces back-to-back identical text in
 * normal play, so this is a no-op for every pre-Phase-12.4 event
 * sequence. The underlying GameEvent[] itself (and anything reading it,
 * like telemetry.ts) is completely unaffected — only the display-string
 * output of this function is deduplicated.
 */
export function formatEvents(events: GameEvent[]): string[] {
  // Phase 15.2 recovery/satiety/status rebalance: filters out empty
  // strings (currently only satiety_decreased returns one — see its
  // formatEvent case above) before dedup/display, so a silent
  // bookkeeping-only event never appears as a blank log line.
  const lines = events.map(formatEvent).filter((line) => line.length > 0);
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped.length > 0 && deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  return deduped;
}

/**
 * Fixed-capacity FIFO of display lines: newest pushed onto the end, oldest
 * dropped off the front once over capacity. Deliberately holds only
 * strings, not GameEvents, so it never re-couples display state back to
 * game state. `clear()` is used on restart (Enter/N) and floor transitions
 * per message_lifecycle requirements.
 */
export class MessageLog {
  private readonly capacity: number;
  private lines: string[] = [];

  constructor(capacity: number = 3) {
    this.capacity = capacity;
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.capacity) {
      this.lines = this.lines.slice(this.lines.length - this.capacity);
    }
  }

  pushMany(newLines: string[]): void {
    for (const line of newLines) this.push(line);
  }

  clear(): void {
    this.lines = [];
  }

  get visible(): string[] {
    return this.lines;
  }
}
