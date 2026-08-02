import { ENEMY_DEFINITIONS } from './enemy-def';
import { ITEM_DEFINITIONS } from './item-def';
import { EFFECT_DEFINITIONS } from './effects';
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
    case 'player_webbed':
      return 'クモの巣に足をとられた。';
    case 'slowed_move_cancelled':
      return '足が動かず、その場にとどまった。';
    case 'floor_advanced':
      return '次のフロアへ進んだ。';
    case 'player_defeated':
      return '力尽きた。';
    case 'item_picked_up': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}をひろった。`;
    }
    case 'item_pickup_failed': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `荷物がいっぱいで、${name}をひろえない。`;
    }
    case 'item_used': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を食べた。HPが${event.healed}回復した。`;
    }
    case 'item_use_failed': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `HPは満タンで、${name}は使えない。`;
    }
    case 'item_placed': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を足元に置いた。`;
    }
    case 'item_place_failed': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      if (event.reason === 'ground_occupied') return `足元には既に何かあり、${name}を置けない。`;
      if (event.reason === 'equipped') return `装備中の${name}は置けない。`;
      return `${name}を置けない。`;
    }
    case 'item_discarded': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を捨てた。`;
    }
    case 'item_discard_failed': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      if (event.reason === 'equipped') return `装備中の${name}は捨てられない。`;
      return `${name}を捨てられない。`;
    }
    case 'sun_fruit_used':
      return '太陽の実を使い、太陽エネルギーが回復した。';
    case 'sun_fruit_use_failed':
      return '太陽エネルギーは満タンだ。';
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
    case 'enchantment_toggled':
      return event.selected === 'sol' ? 'エンチャントをソルに切り替えた。' : 'エンチャントを解除した。';
    case 'sol_enchantment_used':
      return 'ソルの力が攻撃に宿った。';
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
      return event.trapType === 'poison_trap' ? '毒の罠を踏んだ！' : '鈍足の罠を踏んだ！';
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
  const lines = events.map(formatEvent);
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
