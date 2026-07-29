import { ENEMY_DEFINITIONS } from './enemy-def';
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
    case 'player_webbed':
      return 'クモの巣に足をとられた。';
    case 'slowed_move_cancelled':
      return '足が動かず、その場にとどまった。';
    case 'floor_advanced':
      return '次のフロアへ進んだ。';
    case 'player_defeated':
      return '力尽きた。';
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
