import { ENEMY_DEFINITIONS } from './enemy-def';
import { ITEM_DEFINITIONS } from './item-def';
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
      return `${name}に${event.damage}ダメージ。`;
    }
    case 'enemy_attack': {
      const name = ENEMY_DEFINITIONS[event.enemyType].displayName;
      return `${name}の攻撃！ ${event.damage}ダメージを受けた。`;
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
      return event.hit
        ? `${name}の触手が襲いかかり、${event.damage}ダメージ！`
        : `${name}の触手が空を切った。`;
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
    case 'item_used': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `${name}を食べた。HPが${event.healed}回復した。`;
    }
    case 'item_use_failed': {
      const name = ITEM_DEFINITIONS[event.itemId].displayName;
      return `HPは満タンで、${name}は使えない。`;
    }
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Unhandled game event: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** Formats a sequence of events (already in occurrence order) into display lines. */
export function formatEvents(events: GameEvent[]): string[] {
  return events.map(formatEvent);
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
