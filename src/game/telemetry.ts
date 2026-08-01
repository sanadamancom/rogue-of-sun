/**
 * Run telemetry (Phase 10.3.1): a purely additive, read-only observer of
 * game state. Every function here is a pure transformation — none of
 * them mutate GameState, consume any RNG stream (combatRngState or any
 * map-generation stream), or re-run any game logic. They only ever read
 * already-resolved data: the GameEvent[] turn.ts already produced, the
 * PlayerAction that was submitted, and before/after GameState snapshots
 * the caller (main.ts) already has on hand for its own rendering. This
 * satisfies core_principles' "計測はゲーム結果へ影響しない" /
 * "計測処理から乱数を一切使用しない" / "既存ゲームロジックを重複実装しない"
 * by construction: there is no path from this module back into GameState
 * or turn.ts.
 *
 * Ownership: main.ts's MainScene holds exactly one RunTelemetry field,
 * replaced wholesale on every new run (Enter or N — see
 * createRunTelemetry), and updated in place (recordTurn/finalizeRun)
 * after each processTurn call. Never stored on GameState itself, so it
 * can never be part of any GameState equality check, never affects
 * save/carry-over logic, and a test can construct/inspect it with zero
 * Phaser dependency.
 */

import { GameEvent } from './events';
import { EnemyActor, GameState, PlayerAction, WeaponId, ArmorId, ItemId, EnemyType } from './types';

// ---------------------------------------------------------------------
// Event schema (event_model / event_types / event_requirements)
// ---------------------------------------------------------------------

export interface RunEventCommon {
  eventIndex: number;
  turn: number;
  floor: number;
  turnConsumed: boolean;
}

export type RunEventPayload =
  | { type: 'run_started'; seed: number }
  | { type: 'floor_started'; floor: number }
  | { type: 'floor_completed'; floor: number }
  | { type: 'run_completed'; result: 'clear' | 'death'; cause: string; finalFloor: number; finalPosition: { x: number; y: number }; finalHp: number; finalSol: number }
  | { type: 'move'; actor: 'player'; from: { x: number; y: number }; to: { x: number; y: number }; direction: string }
  | { type: 'move_blocked'; from: { x: number; y: number }; attempted: { x: number; y: number }; direction: string; reason: string }
  | { type: 'wait'; position: { x: number; y: number } }
  | {
      type: 'player_attack';
      weapon: WeaponId | 'unarmed';
      targetId: number | null;
      targetType: EnemyType;
      attackerPosition: { x: number; y: number };
      targetPosition: { x: number; y: number };
      outcome: 'miss' | 'hit' | 'defeated';
      hitChance: number | null;
      roll: number | null;
      physicalDamage: number;
      additionalDamage: number;
      totalDamage: number;
      targetHpBefore: number;
      targetHpAfter: number;
      defeated: boolean;
      solConsumed: number;
      knockbackApplied: boolean;
    }
  | {
      type: 'enemy_attack';
      attackerId: number | null;
      attackerType: EnemyType;
      attackType: 'melee' | 'kraken_tentacle';
      attackerPosition: { x: number; y: number };
      playerPosition: { x: number; y: number };
      outcome: 'miss' | 'hit';
      hitChance: number | null;
      roll: number | null;
      damage: number;
      playerHpBefore: number;
      playerHpAfter: number;
    }
  | { type: 'attack_invalid'; actor: 'player'; weaponOrAttackType: WeaponId | 'unarmed'; reason: string }
  | { type: 'enemy_defeated'; targetType: EnemyType; targetId: number | null }
  | { type: 'player_damaged'; amount: number; source: EnemyType }
  | { type: 'player_defeated'; cause: string }
  | { type: 'equipment_acquired'; slot: 'weapon' | 'armor'; id: WeaponId | ArmorId }
  | { type: 'equipment_changed'; slot: 'weapon' | 'armor'; from: WeaponId | ArmorId | null; to: WeaponId | ArmorId; reason: string }
  | { type: 'equipment_removed'; slot: 'weapon' | 'armor'; id: WeaponId | ArmorId }
  | { type: 'equipment_discarded'; slot: 'weapon' | 'armor'; id: WeaponId | ArmorId }
  | { type: 'item_acquired'; itemId: ItemId }
  | { type: 'item_used'; itemId: ItemId; effect: string; amount: number }
  | { type: 'item_discarded'; itemId: ItemId }
  | { type: 'sol_changed'; before: number; after: number; amount: number; reason: 'solar_gun' | 'melee_enchantment' | 'solar_charge' | 'item' | 'other' }
  | { type: 'solar_charge'; recovered: number }
  | { type: 'healed'; source: string; requestedAmount: number; actualAmount: number; hpBefore: number; hpAfter: number }
  | { type: 'key_enemy_defeated'; floor: number }
  | { type: 'key_acquired'; floor: number }
  | { type: 'exit_reached'; floor: number };

export type RunEvent = RunEventCommon & RunEventPayload;

// ---------------------------------------------------------------------
// RunTelemetry container and lifecycle
// ---------------------------------------------------------------------

export interface RunTelemetry {
  schemaVersion: 1;
  seed: number;
  result: 'in_progress' | 'clear' | 'death';
  endCause: string | null;
  events: RunEvent[];
  finalized: boolean;
}

/**
 * Starts a brand-new RunTelemetry for `state` (a freshly created floor-1
 * GameState — see state.ts's createInitialState). Called once per run:
 * on the very first load and on every Enter/N restart (main.ts's
 * restart()), never mid-run. Pushes the run's opening `run_started` and
 * `floor_started` events immediately so a JSON export always has a
 * non-empty, self-describing event list even for a run that ends on
 * its very first turn.
 */
export function createRunTelemetry(state: GameState): RunTelemetry {
  const telemetry: RunTelemetry = {
    schemaVersion: 1,
    seed: state.runSeed,
    result: 'in_progress',
    endCause: null,
    events: [],
    finalized: false,
  };
  pushEvent(telemetry, state, false, { type: 'run_started', seed: state.runSeed });
  pushEvent(telemetry, state, false, { type: 'floor_started', floor: state.floor });
  return telemetry;
}

function pushEvent(telemetry: RunTelemetry, state: GameState, turnConsumed: boolean, event: RunEventPayload): void {
  if (telemetry.finalized) return; // terminal.rules: "確定後に同じランへイベントを追加しない"
  telemetry.events.push({
    eventIndex: telemetry.events.length,
    turn: state.turn,
    floor: state.floor,
    turnConsumed,
    ...event,
  } as RunEvent);
}

const WEAPON_IDS: WeaponId[] = ['sword', 'spear', 'hammer', 'solar_gun'];
const ARMOR_IDS: ArmorId[] = ['armor'];

function weaponOrUnarmed(id: WeaponId | null): WeaponId | 'unarmed' {
  return id ?? 'unarmed';
}

/**
 * Records one resolved player turn (Phase 10.3.1): translates the
 * action just submitted plus the GameEvent[] turn.ts already produced
 * (result.events) plus the before/after GameState snapshots the caller
 * already has, into zero or more RunEvents pushed onto `telemetry`. Pure
 * with respect to `state` (never mutates it) and never calls into any
 * RNG — every field it records already exists on `stateBefore`,
 * `stateAfter`, or one of the `result.events`.
 *
 * `stateBefore` is a shallow-ish snapshot (positions/hp/inventory counts
 * captured by the caller before processTurn) since GameState itself is
 * mutated in place by processTurn — see main.ts's call site for exactly
 * what is captured.
 */
export function recordTurn(
  telemetry: RunTelemetry,
  action: PlayerAction,
  events: GameEvent[],
  before: TurnSnapshot,
  after: GameState,
): void {
  if (telemetry.finalized) return;

  // Movement (move.ts's move/move_blocked/wait): turn.ts pushes no
  // GameEvent at all for these — see turn.ts's applyPlayerAction move
  // branch, which returns consumed:false silently on a blocked step —
  // so these are derived from the action + position diff instead.
  if (action.type === 'move') {
    const moved = after.player.pos.x !== before.playerPos.x || after.player.pos.y !== before.playerPos.y;
    if (moved) {
      pushEvent(telemetry, after, true, {
        type: 'move',
        actor: 'player',
        from: before.playerPos,
        to: { ...after.player.pos },
        direction: action.direction,
      });
    } else {
      pushEvent(telemetry, after, false, {
        type: 'move_blocked',
        from: before.playerPos,
        attempted: destinationOf(before.playerPos, action.direction),
        direction: action.direction,
        reason: before.playerSlowed ? 'slowed' : 'blocked',
      });
    }
  } else if (action.type === 'wait') {
    pushEvent(telemetry, after, true, { type: 'wait', position: { ...after.player.pos } });
  }

  for (const event of events) {
    translateGameEvent(telemetry, event, before, after);
  }

  // Floor progression: reachedExit is implied by the phase transitioning
  // to floor_cleared/victory this turn (see turn.ts's processTurn tail),
  // and equally by an explicit advanceToNextFloor call from main.ts,
  // which starts the new floor's floor_started itself (see
  // recordFloorAdvanced below) — so this only needs to detect the
  // moment of reaching the (already-unlocked) exit tile, not re-derive
  // the unlock condition itself.
  if ((after.phase === 'floor_cleared' || after.phase === 'victory') && before.phase === 'playing') {
    pushEvent(telemetry, after, true, { type: 'exit_reached', floor: after.floor });
    pushEvent(telemetry, after, true, { type: 'floor_completed', floor: after.floor });
  }
}

/** Snapshot of the fields recordTurn needs from *before* processTurn mutates GameState in place. */
export interface TurnSnapshot {
  playerPos: { x: number; y: number };
  playerHp: number;
  playerSol: number;
  playerSlowed: boolean;
  equippedWeaponId: WeaponId | null;
  equippedArmorId: ArmorId | null;
  phase: GameState['phase'];
}

export function snapshotForTurn(state: GameState): TurnSnapshot {
  return {
    playerPos: { ...state.player.pos },
    playerHp: state.player.hp,
    playerSol: state.solarEnergy,
    playerSlowed: !!state.player.slowed,
    equippedWeaponId: state.equippedWeaponId,
    equippedArmorId: state.equippedArmorId,
    phase: state.phase,
  };
}

function destinationOf(pos: { x: number; y: number }, direction: string): { x: number; y: number } {
  const vectors: Record<string, { x: number; y: number }> = {
    N: { x: 0, y: -1 },
    S: { x: 0, y: 1 },
    E: { x: 1, y: 0 },
    W: { x: -1, y: 0 },
    NE: { x: 1, y: -1 },
    NW: { x: -1, y: -1 },
    SE: { x: 1, y: 1 },
    SW: { x: -1, y: 1 },
  };
  const v = vectors[direction] ?? { x: 0, y: 0 };
  return { x: pos.x + v.x, y: pos.y + v.y };
}

function findEnemyByType(state: GameState, type: EnemyType): EnemyActor | undefined {
  return state.enemies.find((e) => e.type === type);
}

function translateGameEvent(telemetry: RunTelemetry, event: GameEvent, before: TurnSnapshot, after: GameState): void {
  switch (event.type) {
    case 'player_attack': {
      const target = findEnemyByType(after, event.enemyType);
      const weapon = weaponOrUnarmed(event.weaponId ?? null);
      pushEvent(telemetry, after, true, {
        type: 'player_attack',
        weapon,
        targetId: target?.id ?? null,
        targetType: event.enemyType,
        attackerPosition: { ...after.player.pos },
        targetPosition: target ? { ...target.pos } : { x: -1, y: -1 },
        outcome: target && !target.alive ? 'defeated' : 'hit',
        hitChance: null,
        roll: null,
        physicalDamage: event.damage,
        additionalDamage: 0,
        totalDamage: event.damage,
        targetHpBefore: target ? target.hp + event.damage : event.damage,
        targetHpAfter: target ? target.hp : 0,
        defeated: target ? !target.alive : false,
        solConsumed: 0,
        knockbackApplied: false,
      });
      break;
    }
    case 'player_attack_missed': {
      pushEvent(telemetry, after, true, {
        type: 'player_attack',
        weapon: weaponOrUnarmed(event.weaponId ?? null),
        targetId: findEnemyByType(after, event.enemyType)?.id ?? null,
        targetType: event.enemyType,
        attackerPosition: { ...after.player.pos },
        targetPosition: (() => {
          const t = findEnemyByType(after, event.enemyType);
          return t ? { ...t.pos } : { x: -1, y: -1 };
        })(),
        outcome: 'miss',
        hitChance: event.hitChance,
        roll: event.roll,
        physicalDamage: 0,
        additionalDamage: 0,
        totalDamage: 0,
        targetHpBefore: findEnemyByType(after, event.enemyType)?.hp ?? 0,
        targetHpAfter: findEnemyByType(after, event.enemyType)?.hp ?? 0,
        defeated: false,
        solConsumed: 0,
        knockbackApplied: false,
      });
      break;
    }
    case 'sol_enchantment_used': {
      // Enriches the immediately-preceding player_attack RunEvent (same
      // turn, same target) rather than pushing a separate event — this
      // matches player_attack's own additionalDamage/solConsumed fields
      // in the schema, so the sol bonus lives on the attack it belongs
      // to instead of a disconnected second record.
      const last = telemetry.events[telemetry.events.length - 1];
      if (last && last.type === 'player_attack' && last.targetType === event.enemyType) {
        last.additionalDamage = event.bonusDamage;
        last.totalDamage = last.physicalDamage + event.bonusDamage;
        last.solConsumed = event.solBefore - event.solAfter;
      }
      pushEvent(telemetry, after, false, {
        type: 'sol_changed',
        before: event.solBefore,
        after: event.solAfter,
        amount: event.solAfter - event.solBefore,
        reason: 'melee_enchantment',
      });
      break;
    }
    case 'enemy_knocked_back': {
      const last = telemetry.events[telemetry.events.length - 1];
      if (last && last.type === 'player_attack' && last.targetType === event.enemyType) {
        last.knockbackApplied = true;
      }
      break;
    }
    case 'enemy_attack': {
      pushEvent(telemetry, after, true, {
        type: 'enemy_attack',
        attackerId: findEnemyByType(after, event.enemyType)?.id ?? null,
        attackerType: event.enemyType,
        attackType: 'melee',
        attackerPosition: (() => {
          const a = findEnemyByType(after, event.enemyType);
          return a ? { ...a.pos } : { x: -1, y: -1 };
        })(),
        playerPosition: { ...after.player.pos },
        outcome: 'hit',
        hitChance: null,
        roll: null,
        damage: event.damage,
        playerHpBefore: before.playerHp,
        playerHpAfter: after.player.hp,
      });
      if (event.damage > 0) {
        pushEvent(telemetry, after, false, { type: 'player_damaged', amount: event.damage, source: event.enemyType });
      }
      break;
    }
    case 'enemy_attack_missed': {
      pushEvent(telemetry, after, true, {
        type: 'enemy_attack',
        attackerId: findEnemyByType(after, event.enemyType)?.id ?? null,
        attackerType: event.enemyType,
        attackType: 'melee',
        attackerPosition: (() => {
          const a = findEnemyByType(after, event.enemyType);
          return a ? { ...a.pos } : { x: -1, y: -1 };
        })(),
        playerPosition: { ...after.player.pos },
        outcome: 'miss',
        hitChance: event.hitChance,
        roll: event.roll,
        damage: 0,
        playerHpBefore: before.playerHp,
        playerHpAfter: after.player.hp,
      });
      break;
    }
    case 'kraken_tentacle_strike': {
      // Kraken's own aim/strike mechanic (Phase 06) is a positional AoE
      // check, not an accuracy/evasion roll — see Phase 10.3's history
      // doc for why it was deliberately excluded from that system.
      // hitChance/roll are therefore recorded as null, per
      // event_requirements.enemy_attack.notes.
      pushEvent(telemetry, after, true, {
        type: 'enemy_attack',
        attackerId: event.enemyId,
        attackerType: event.enemyType,
        attackType: 'kraken_tentacle',
        attackerPosition: (() => {
          const a = after.enemies.find((e) => e.id === event.enemyId);
          return a ? { ...a.pos } : { ...event.target };
        })(),
        playerPosition: { ...after.player.pos },
        outcome: event.hit ? 'hit' : 'miss',
        hitChance: null,
        roll: null,
        damage: event.damage,
        playerHpBefore: before.playerHp,
        playerHpAfter: after.player.hp,
      });
      if (event.hit && event.damage > 0) {
        pushEvent(telemetry, after, false, { type: 'player_damaged', amount: event.damage, source: event.enemyType });
      }
      break;
    }
    case 'player_whiff': {
      pushEvent(telemetry, after, true, {
        type: 'attack_invalid',
        actor: 'player',
        weaponOrAttackType: weaponOrUnarmed(event.weaponId ?? null),
        reason: 'no_target_in_range',
      });
      break;
    }
    case 'solar_gun_insufficient_solar': {
      pushEvent(telemetry, after, false, {
        type: 'attack_invalid',
        actor: 'player',
        weaponOrAttackType: 'solar_gun',
        reason: 'insufficient_sol',
      });
      break;
    }
    case 'enemy_defeated': {
      const target = findEnemyByType(after, event.enemyType);
      pushEvent(telemetry, after, false, { type: 'enemy_defeated', targetType: event.enemyType, targetId: target?.id ?? null });
      pushEvent(telemetry, after, false, { type: 'key_enemy_defeated', floor: after.floor });
      break;
    }
    case 'player_defeated': {
      pushEvent(telemetry, after, false, { type: 'player_defeated', cause: 'unknown' });
      break;
    }
    case 'item_picked_up': {
      pushEvent(telemetry, after, false, { type: 'item_acquired', itemId: event.itemId });
      if (WEAPON_IDS.includes(event.itemId as WeaponId)) {
        pushEvent(telemetry, after, false, { type: 'equipment_acquired', slot: 'weapon', id: event.itemId as WeaponId });
      } else if (ARMOR_IDS.includes(event.itemId as ArmorId)) {
        pushEvent(telemetry, after, false, { type: 'equipment_acquired', slot: 'armor', id: event.itemId as ArmorId });
      }
      break;
    }
    case 'item_used': {
      pushEvent(telemetry, after, true, { type: 'item_used', itemId: event.itemId, effect: 'heal', amount: event.healed });
      if (event.healed > 0) {
        pushEvent(telemetry, after, false, {
          type: 'healed',
          source: event.itemId,
          requestedAmount: event.healed,
          actualAmount: event.healed,
          hpBefore: before.playerHp,
          hpAfter: after.player.hp,
        });
      }
      break;
    }
    case 'sun_fruit_used': {
      pushEvent(telemetry, after, true, { type: 'item_used', itemId: event.itemId, effect: 'sol', amount: event.recovered });
      pushEvent(telemetry, after, false, {
        type: 'sol_changed',
        before: before.playerSol,
        after: after.solarEnergy,
        amount: event.recovered,
        reason: 'item',
      });
      break;
    }
    case 'solar_charge_used': {
      pushEvent(telemetry, after, true, { type: 'solar_charge', recovered: event.recovered });
      pushEvent(telemetry, after, false, {
        type: 'sol_changed',
        before: before.playerSol,
        after: after.solarEnergy,
        amount: event.recovered,
        reason: 'solar_charge',
      });
      break;
    }
    case 'weapon_equipped': {
      pushEvent(telemetry, after, true, {
        type: 'equipment_changed',
        slot: 'weapon',
        from: before.equippedWeaponId,
        to: event.weaponId,
        reason: 'player_equip',
      });
      break;
    }
    case 'armor_equipped': {
      pushEvent(telemetry, after, true, {
        type: 'equipment_changed',
        slot: 'armor',
        from: before.equippedArmorId,
        to: event.armorId,
        reason: 'player_equip',
      });
      break;
    }
    default:
      // Every other GameEvent category (facing/AI-behavior-flavor events
      // like sword_dash, web_placed, bat_retreat, mummy_shamble_rest,
      // cockatrice_gaze_*, player_petrified*, kraken_tentacle_aim,
      // player_pulled, player_webbed, slowed_move_cancelled,
      // floor_advanced, item_use_failed, sun_fruit_use_failed,
      // weapon_already_equipped, armor_already_equipped, hammer_recover,
      // enemy_recovering, enchantment_toggled, sol_enchantment_acquired)
      // is outside this phase's required event_types list — no
      // corresponding RunEvent category was specified for them, so they
      // are intentionally not translated. See the history doc's
      // "未実装項目" for the explicit list.
      break;
  }

  // Player-side SOL consumption for the solar gun is not its own
  // GameEvent (it happens inline in resolveSolarGunAttack before the
  // shared player_attack/player_attack_missed push), so it is derived
  // here from the before/after solarEnergy diff whenever the equipped
  // weapon has a solarCost and the turn actually consumed SOL — this
  // avoids re-implementing resolveSolarGunAttack's own resource check.
  if (
    (event.type === 'player_attack' || event.type === 'player_attack_missed') &&
    before.equippedWeaponId === 'solar_gun'
  ) {
    const solDelta = after.solarEnergy - before.playerSol;
    if (solDelta < 0) {
      const last = telemetry.events[telemetry.events.length - 1];
      if (last && last.type === 'player_attack') {
        last.solConsumed = -solDelta;
      }
      pushEvent(telemetry, after, false, {
        type: 'sol_changed',
        before: before.playerSol,
        after: after.solarEnergy,
        amount: solDelta,
        reason: 'solar_gun',
      });
    }
  }
}

/**
 * Records the start of a new floor after advanceToNextFloor (Phase
 * 10.3.1): called by main.ts right after replacing `this.state` with
 * the freshly built next-floor GameState. The departed floor's
 * `floor_completed` is pushed separately by recordTurn (detected from
 * the pre-advance phase transition, before advanceToNextFloor ever
 * runs), so this only ever adds the new floor's opening marker.
 */
export function recordFloorStarted(telemetry: RunTelemetry, state: GameState): void {
  pushEvent(telemetry, state, false, { type: 'floor_started', floor: state.floor });
}

/**
 * Finalizes a run (Phase 10.3.1 terminal.rules): called once, the first
 * time `state.phase` becomes 'gameover' or 'victory' after a processed
 * turn. A no-op if already finalized (never re-confirms, never appends
 * further events) — see terminal.rules' "終了イベントは1ランにつき一度
 * だけ記録する" / "確定後に同じランへイベントを追加しない". Snapshots
 * the terminal state's floor/position/hp/sol into the run_completed
 * event itself so a later state mutation (e.g. Enter reusing the same
 * MainScene instance before the caller replaces `telemetry`) can never
 * retroactively change it.
 */
export function finalizeRun(telemetry: RunTelemetry, state: GameState): void {
  if (telemetry.finalized) return;
  if (state.phase !== 'gameover' && state.phase !== 'victory') return;

  const result: 'clear' | 'death' = state.phase === 'victory' ? 'clear' : 'death';
  const cause = result === 'death' ? deriveDeathCause(telemetry) : 'floor_cleared';

  telemetry.result = result;
  telemetry.endCause = cause;
  telemetry.events.push({
    eventIndex: telemetry.events.length,
    turn: state.turn,
    floor: state.floor,
    turnConsumed: false,
    type: 'run_completed',
    result,
    cause,
    finalFloor: state.floor,
    finalPosition: { ...state.player.pos },
    finalHp: state.player.hp,
    finalSol: state.solarEnergy,
  });
  telemetry.finalized = true;
}

/** The most recent damage source recorded before death, per tests.combat's "死亡原因が最後の有効ダメージ源と一致する". */
function deriveDeathCause(telemetry: RunTelemetry): string {
  for (let i = telemetry.events.length - 1; i >= 0; i--) {
    const e = telemetry.events[i];
    if (e.type === 'player_damaged') return e.source;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------
// Summary calculation (summary_calculation) — all pure functions over
// telemetry.events; never re-parse formatted log strings, never touch
// GameState.
// ---------------------------------------------------------------------

export interface WeaponCombatStats {
  validAttacks: number;
  invalidAttempts: number;
  hits: number;
  misses: number;
  hitRate: number | null;
  damageDealt: number;
  averageDamagePerHit: number | null;
  kills: number;
}

export interface EnemyDamageStats {
  attackAttempts: number;
  hits: number;
  misses: number;
  damage: number;
}

export interface PerFloorStats {
  floor: number;
  turns: number;
  moves: number;
  waits: number;
  attacks: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  solConsumed: number;
  healing: number;
}

export interface RunSummary {
  movement: { successfulMoves: number; blockedMoves: number; waits: number };
  combatOverall: { validAttacks: number; hits: number; misses: number; hitRate: number | null; damageDealt: number; kills: number };
  combatByWeapon: Record<string, WeaponCombatStats>;
  damageTakenByEnemy: Record<string, EnemyDamageStats>;
  equipment: { acquiredCount: number; changeCount: number; endingEquipment: { weapon: WeaponId | null; armor: ArmorId | null } };
  resources: { solGained: number; solConsumed: number; solarChargeActions: number; healingBySource: Record<string, number>; itemsUsedByType: Record<string, number> };
  progression: { enemiesDefeated: number; keysAcquired: number; exitsReached: number };
  perFloor: PerFloorStats[];
  finalState: {
    floor: number;
    position: { x: number; y: number };
    life: number;
    maxLife: number;
    sol: number;
    equipment: { weapon: WeaponId | null; armor: ArmorId | null };
    inventory: Record<string, number>;
  };
}

function emptyWeaponStats(): WeaponCombatStats {
  return { validAttacks: 0, invalidAttempts: 0, hits: 0, misses: 0, hitRate: null, damageDealt: 0, averageDamagePerHit: null, kills: 0 };
}

function emptyEnemyStats(): EnemyDamageStats {
  return { attackAttempts: 0, hits: 0, misses: 0, damage: 0 };
}

function emptyFloorStats(floor: number): PerFloorStats {
  return { floor, turns: 0, moves: 0, waits: 0, attacks: 0, kills: 0, damageDealt: 0, damageTaken: 0, solConsumed: 0, healing: 0 };
}

/**
 * Computes a RunSummary from `telemetry.events` alone (summary_calculation):
 * every field is derived by walking the event list once; nothing here
 * reads GameState or re-parses any display string. Safe to call at any
 * point (mid-run or after finalizeRun) — calculation_rules' "0回攻撃時の
 * hitRateはnullとし、NaNやInfinityを出さない" is enforced throughout via
 * explicit zero-guards rather than relying on JS's NaN propagation.
 */
export function computeRunSummary(telemetry: RunTelemetry, finalState: GameState): RunSummary {
  const movement = { successfulMoves: 0, blockedMoves: 0, waits: 0 };
  const combatByWeapon: Record<string, WeaponCombatStats> = {};
  const damageTakenByEnemy: Record<string, EnemyDamageStats> = {};
  const perFloorMap = new Map<number, PerFloorStats>();
  let solGained = 0;
  let solConsumed = 0;
  let solarChargeActions = 0;
  const healingBySource: Record<string, number> = {};
  const itemsUsedByType: Record<string, number> = {};
  let enemiesDefeated = 0;
  let keysAcquired = 0;
  let exitsReached = 0;
  let acquiredCount = 0;
  let changeCount = 0;
  const turnsPerFloor = new Map<number, Set<number>>();

  const getFloorStats = (floor: number): PerFloorStats => {
    let s = perFloorMap.get(floor);
    if (!s) {
      s = emptyFloorStats(floor);
      perFloorMap.set(floor, s);
    }
    return s;
  };
  const getWeaponStats = (weapon: string): WeaponCombatStats => {
    let s = combatByWeapon[weapon];
    if (!s) {
      s = emptyWeaponStats();
      combatByWeapon[weapon] = s;
    }
    return s;
  };
  const getEnemyStats = (enemyType: string): EnemyDamageStats => {
    let s = damageTakenByEnemy[enemyType];
    if (!s) {
      s = emptyEnemyStats();
      damageTakenByEnemy[enemyType] = s;
    }
    return s;
  };

  for (const event of telemetry.events) {
    if (!turnsPerFloor.has(event.floor)) turnsPerFloor.set(event.floor, new Set());
    turnsPerFloor.get(event.floor)!.add(event.turn);

    switch (event.type) {
      case 'move':
        movement.successfulMoves++;
        getFloorStats(event.floor).moves++;
        break;
      case 'move_blocked':
        movement.blockedMoves++;
        break;
      case 'wait':
        movement.waits++;
        getFloorStats(event.floor).waits++;
        break;
      case 'player_attack': {
        const stats = getWeaponStats(event.weapon);
        stats.validAttacks++;
        getFloorStats(event.floor).attacks++;
        if (event.outcome === 'miss') {
          stats.misses++;
        } else {
          stats.hits++;
          stats.damageDealt += event.totalDamage;
          getFloorStats(event.floor).damageDealt += event.totalDamage;
          if (event.defeated) stats.kills++;
        }
        break;
      }
      case 'attack_invalid': {
        const stats = getWeaponStats(event.weaponOrAttackType);
        stats.invalidAttempts++;
        break;
      }
      case 'enemy_defeated':
        enemiesDefeated++;
        break;
      case 'player_damaged': {
        const stats = getEnemyStats(event.source);
        stats.hits++;
        stats.damage += event.amount;
        getFloorStats(event.floor).damageTaken += event.amount;
        break;
      }
      case 'enemy_attack': {
        const stats = getEnemyStats(event.attackerType);
        stats.attackAttempts++;
        if (event.outcome === 'miss') stats.misses++;
        break;
      }
      case 'equipment_acquired':
        acquiredCount++;
        break;
      case 'equipment_changed':
        changeCount++;
        break;
      case 'sol_changed':
        if (event.amount > 0) solGained += event.amount;
        else if (event.amount < 0) {
          solConsumed += -event.amount;
          getFloorStats(event.floor).solConsumed += -event.amount;
        }
        break;
      case 'solar_charge':
        solarChargeActions++;
        break;
      case 'healed':
        healingBySource[event.source] = (healingBySource[event.source] ?? 0) + event.actualAmount;
        getFloorStats(event.floor).healing += event.actualAmount;
        break;
      case 'item_used':
        itemsUsedByType[event.itemId] = (itemsUsedByType[event.itemId] ?? 0) + 1;
        break;
      case 'key_acquired':
        keysAcquired++;
        break;
      case 'exit_reached':
        exitsReached++;
        break;
      default:
        break;
    }
  }

  for (const [floor, turnSet] of turnsPerFloor) {
    getFloorStats(floor).turns = turnSet.size;
  }

  let overallValid = 0;
  let overallHits = 0;
  let overallMisses = 0;
  let overallDamage = 0;
  let overallKills = 0;
  for (const stats of Object.values(combatByWeapon)) {
    stats.hitRate = stats.validAttacks > 0 ? stats.hits / stats.validAttacks : null;
    stats.averageDamagePerHit = stats.hits > 0 ? stats.damageDealt / stats.hits : null;
    overallValid += stats.validAttacks;
    overallHits += stats.hits;
    overallMisses += stats.misses;
    overallDamage += stats.damageDealt;
    overallKills += stats.kills;
  }

  return {
    movement,
    combatOverall: {
      validAttacks: overallValid,
      hits: overallHits,
      misses: overallMisses,
      hitRate: overallValid > 0 ? overallHits / overallValid : null,
      damageDealt: overallDamage,
      kills: overallKills,
    },
    combatByWeapon,
    damageTakenByEnemy,
    equipment: {
      acquiredCount,
      changeCount,
      endingEquipment: { weapon: finalState.equippedWeaponId, armor: finalState.equippedArmorId },
    },
    resources: { solGained, solConsumed, solarChargeActions, healingBySource, itemsUsedByType },
    progression: { enemiesDefeated, keysAcquired, exitsReached },
    perFloor: Array.from(perFloorMap.values()).sort((a, b) => a.floor - b.floor),
    finalState: {
      floor: finalState.floor,
      position: { ...finalState.player.pos },
      life: finalState.player.hp,
      maxLife: finalState.player.maxHp,
      sol: finalState.solarEnergy,
      equipment: { weapon: finalState.equippedWeaponId, armor: finalState.equippedArmorId },
      inventory: { ...finalState.inventory },
    },
  };
}

// ---------------------------------------------------------------------
// JSON export (json_export)
// ---------------------------------------------------------------------

/** Strips characters not safe in a filename, per filename_rules. */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function buildExportFilename(telemetry: RunTelemetry): string {
  const seedPart = sanitizeForFilename(String(telemetry.seed));
  const resultPart = telemetry.result === 'clear' ? 'clear' : 'death';
  return `rogue-of-sun-run-v1-${seedPart}-${resultPart}.json`;
}

export interface TelemetryDocument {
  schemaVersion: 1;
  gameVersion: string;
  run: {
    seed: number;
    result: 'in_progress' | 'clear' | 'death';
    endCause: string | null;
    floorsReached: number;
    totalTurns: number;
    totalEvents: number;
  };
  summary: RunSummary;
  events: RunEvent[];
}

/**
 * Builds the full exportable document (telemetry_document): JSON.stringify
 * of the return value is exactly what json_export writes to a Blob. Never
 * includes local file paths, credentials, usernames, real-time
 * timestamps, or browser identification, per telemetry_document.restrictions
 * — every field here is either an already-recorded RunEvent field or a
 * RunSummary value.
 */
export function buildTelemetryDocument(telemetry: RunTelemetry, finalState: GameState): TelemetryDocument {
  const summary = computeRunSummary(telemetry, finalState);
  const totalTurns = telemetry.events.reduce((max, e) => Math.max(max, e.turn), 0);
  return {
    schemaVersion: 1,
    gameVersion: 'phase-10.3.1',
    run: {
      seed: telemetry.seed,
      result: telemetry.result,
      endCause: telemetry.endCause,
      floorsReached: finalState.floor,
      totalTurns,
      totalEvents: telemetry.events.length,
    },
    summary,
    events: telemetry.events,
  };
}
