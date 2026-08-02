/**
 * Run telemetry (Phase 10.3.1, corrected in Phase 10.3.2 — see
 * docs/history/phase-10-3-2-telemetry-correctness-fix.md). A purely
 * additive, read-only observer of game state. Every function here is a
 * pure transformation — none of them mutate GameState, consume any RNG
 * stream (combatRngState or any map-generation stream), or re-run any
 * game logic. They only ever read already-resolved data: the
 * GameEvent[] turn.ts already produced (now carrying stable
 * targetId/attackerId and exact before/after HP — a Phase 10.3.2
 * observability addition to events.ts, not a calculation change), the
 * PlayerAction that was submitted, the TurnResult it produced, and
 * before/after GameState snapshots the caller (main.ts) already has on
 * hand for its own rendering. This satisfies core_principles' "計測は
 * ゲーム結果へ影響しない" / "計測処理から乱数を一切使用しない" /
 * "既存ゲームロジックを重複実装しない" by construction: there is no path
 * from this module back into GameState or turn.ts.
 *
 * Ownership: main.ts's MainScene holds exactly one RunTelemetry field,
 * replaced wholesale on every new run (Enter or N — see
 * createRunTelemetry), and updated in place (recordTurn/finalizeRun)
 * after each processTurn-equivalent call (including the inventory
 * overlay's equip/use-item path — see main.ts's handleInventoryKey,
 * fixed in Phase 10.3.2 to actually call recordTurn, which it
 * previously did not). Never stored on GameState itself, so it can
 * never be part of any GameState equality check, never affects
 * save/carry-over logic, and a test can construct/inspect it with zero
 * Phaser dependency.
 *
 * Phase 10.3.2 correctness fixes, in one place for reference:
 * - targetId/attackerId (from events.ts) replace the old
 *   "find an enemy of this type" re-lookup, which silently
 *   misattributed hits/kills/HP whenever two same-species enemies
 *   existed on one floor, or once the real target had already died and
 *   stayed in state.enemies (alive:false, never removed).
 * - key_enemy_defeated/key_acquired are gone entirely: this game has no
 *   key mechanic (see history doc's investigation).
 * - turnConsumed on every event derived within one recordTurn call now
 *   comes from that call's single TurnResult.consumed, instead of a
 *   mix of hardcoded true/false guesses.
 * - equipment_changed is now actually reachable from the inventory
 *   overlay's Enter-to-equip path (main.ts integration fix).
 * - per-floor turn counts are now floor_started/floor_completed/
 *   run_completed turn-boundary differences, not a count of distinct
 *   turn numbers seen in that floor's events (which could under/over
 *   count relative to totalTurns).
 * - kills are now counted once from a single canonical
 *   (floor, targetId) set, shared by combatOverall, combatByWeapon,
 *   progression, and perFloor.
 * - a 0-damage "hit" (fully absorbed by armor) now counts toward hits
 *   and a new zeroDamageHits field, never toward damage.
 */

import { GameEvent } from './events';
import { EnemyType, GameState, PlayerAction, WeaponId, ArmorId, ItemId } from './types';
import type { TurnResult } from './turn';
import { ITEM_DEFINITIONS } from './item-def';

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
      targetId: number;
      targetType: EnemyType;
      attackerPosition: { x: number; y: number };
      targetPosition: { x: number; y: number };
      outcome: 'miss' | 'hit' | 'defeated';
      hitChance: number | null;
      roll: number | null;
      // Phase 10.3.3 damage-and-recovery telemetry fix: physicalDamage/
      // additionalDamage/calculatedDamage are the raw, pre-clamp combat
      // calculation (turn.ts's `damage` variable, which can exceed the
      // target's remaining HP on a killing blow — "overkill"). actualDamage
      // is the real HP loss (targetHpBefore - targetHpAfter, never
      // negative, never exceeding targetHpBefore) and is the sole figure
      // used for damageDealt aggregation everywhere in RunSummary — see
      // computeRunSummary. Before this fix, summary aggregation used the
      // raw figure directly, silently inflating damageDealt by the
      // overkill amount on every killing blow.
      physicalDamage: number;
      additionalDamage: number;
      calculatedDamage: number;
      actualDamage: number;
      targetHpBefore: number;
      targetHpAfter: number;
      defeated: boolean;
      solConsumed: number;
      knockbackApplied: boolean;
    }
  | {
      type: 'enemy_attack';
      attackerId: number;
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
  | { type: 'enemy_defeated'; targetType: EnemyType; targetId: number }
  // Phase 12.3: `source` is widened from EnemyType-only to also allow
  // 'poison' — poison is the first non-enemy damage source, so this
  // player_damaged event (and everything downstream that reads its
  // `source`, i.e. deriveDeathCauseFromTail's endCause derivation and
  // computeRunSummary's damageTaken aggregation) now needs to represent
  // "damaged by poison" without inventing a fake EnemyType. This is a
  // schema-meaning change, hence schemaVersion 3 -> 4 (see this file's
  // schemaVersion doc comment below).
  | { type: 'player_damaged'; amount: number; source: EnemyType | 'poison' }
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
  // Phase 10.3.3: renamed from 'healed' to 'player_healed', and `source`
  // is now one of a small fixed set (allowed_sources) rather than a raw
  // itemId, so healingBySource groups consistently by mechanism
  // ('natural_regeneration', 'item', ...) — itemId (when applicable) is
  // kept as a separate, optional detail field instead.
  | { type: 'player_healed'; source: 'natural_regeneration' | 'item'; itemId?: ItemId; requestedAmount: number; actualHealing: number; hpBefore: number; hpAfter: number }
  // Phase 12.3 poison trap: the detailed per-tick record (actualDamage/
  // hpBefore/hpAfter, per telemetry.required's "poison_damageにはactualDamage、
  // hpBefore、hpAfterを含める"). Pushed alongside a generic
  // 'player_damaged' (source: 'poison') for the same tick — see
  // translateGameEvent's 'poison_damage' case — so existing damageTaken/
  // endCause aggregation (which already generically consumes
  // player_damaged events) picks up poison damage for free, while this
  // event exists for anyone wanting poison-specific detail without
  // re-deriving it from player_damaged + a source filter.
  | { type: 'poison_damage'; actualDamage: number; hpBefore: number; hpAfter: number }
  | { type: 'exit_reached'; floor: number };

export type RunEvent = RunEventCommon & RunEventPayload;

// ---------------------------------------------------------------------
// RunTelemetry container and lifecycle
// ---------------------------------------------------------------------

export interface RunTelemetry {
  // Phase 12.3: bumped from 3 to 4 — poison introduces a non-enemy
  // player_damaged.source ('poison') and a new poison_damage event,
  // which changes the meaning of existing fields (player_damaged.source,
  // computeRunSummary's damageTaken aggregation) rather than only adding
  // new ones, so schemaVersion must change per telemetry.policy's "毒
  // ダメージを無視したままschemaVersion 3を維持してはならない". No v1-v3
  // read-compatibility shim is provided (telemetry.forbidden's "v1〜v3の
  // 読み込み互換機能は追加しない") — this is an export-only format.
  schemaVersion: 4;
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
 * restart()), never mid-run.
 */
export function createRunTelemetry(state: GameState): RunTelemetry {
  const telemetry: RunTelemetry = {
    schemaVersion: 4,
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
 * Records one resolved player turn (Phase 10.3.1, corrected 10.3.2):
 * translates the action just submitted plus the full TurnResult
 * turn.ts already produced (result.events and result.consumed) plus
 * before/after GameState snapshots, into zero or more RunEvents pushed
 * onto `telemetry`. Every RunEvent derived within this single call
 * shares `result.consumed` as its turnConsumed value (Phase 10.3.2:
 * previously several derived events hardcoded false regardless of the
 * real outcome).
 */
export function recordTurn(
  telemetry: RunTelemetry,
  action: PlayerAction,
  result: TurnResult,
  before: TurnSnapshot,
  after: GameState,
): void {
  if (telemetry.finalized) return;
  const consumed = result.consumed;

  // Movement (move/move_blocked/wait): turn.ts pushes no GameEvent at
  // all for these — see turn.ts's applyPlayerAction move branch, which
  // returns consumed:false silently on a blocked step — so these are
  // derived from the action + position diff instead.
  if (action.type === 'move') {
    const moved = after.player.pos.x !== before.playerPos.x || after.player.pos.y !== before.playerPos.y;
    if (moved) {
      pushEvent(telemetry, after, consumed, {
        type: 'move',
        actor: 'player',
        from: before.playerPos,
        to: { ...after.player.pos },
        direction: action.direction,
      });
    } else {
      pushEvent(telemetry, after, consumed, {
        type: 'move_blocked',
        from: before.playerPos,
        attempted: destinationOf(before.playerPos, action.direction),
        direction: action.direction,
        reason: before.playerSlowed ? 'slowed' : 'blocked',
      });
    }
  } else if (action.type === 'wait') {
    pushEvent(telemetry, after, consumed, { type: 'wait', position: { ...after.player.pos } });
  }

  for (const event of result.events) {
    translateGameEvent(telemetry, event, before, after, consumed);
  }

  // Natural HP regeneration (Phase 10.2's REGEN_TURNS_PER_HP mechanic):
  // turn.ts exposes this only as TurnResult.playerRegenerated (a plain
  // boolean), never as a GameEvent — see the history doc's investigation
  // (Phase 10.3.3) — so it must be checked here directly rather than in
  // translateGameEvent's event-type switch. actualHealing is the real
  // hp delta (before.playerHp -> after.player.hp), already correctly
  // clamped to maxHp by turn.ts's own Math.min.
  if (result.playerRegenerated) {
    const actualHealing = after.player.hp - before.playerHp;
    if (actualHealing > 0) {
      pushEvent(telemetry, after, consumed, {
        type: 'player_healed',
        source: 'natural_regeneration',
        requestedAmount: 10, // REGEN_TURNS_PER_HP's fixed per-tick amount (turn.ts)
        actualHealing,
        hpBefore: before.playerHp,
        hpAfter: after.player.hp,
      });
    }
  }

  // Floor progression: reachedExit is implied by the phase transitioning
  // to floor_cleared/victory this turn (see turn.ts's processTurn tail).
  // The new floor's own floor_started is pushed separately by main.ts
  // right after advanceToNextFloor — see recordFloorStarted.
  if ((after.phase === 'floor_cleared' || after.phase === 'victory') && before.phase === 'playing') {
    pushEvent(telemetry, after, consumed, { type: 'exit_reached', floor: after.floor });
    pushEvent(telemetry, after, consumed, { type: 'floor_completed', floor: after.floor });
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

function findEnemyById(state: GameState, id: number): { pos: { x: number; y: number }; hp: number } | undefined {
  return state.enemies.find((e) => (e.id ?? 0) === id);
}

function translateGameEvent(
  telemetry: RunTelemetry,
  event: GameEvent,
  before: TurnSnapshot,
  after: GameState,
  consumed: boolean,
): void {
  switch (event.type) {
    case 'player_attack': {
      const weapon = weaponOrUnarmed(event.weaponId ?? null);
      const target = findEnemyById(after, event.targetId);
      // Phase 10.3.3: actualDamage is the real HP loss, never the raw
      // pre-clamp attack power — see the RunEventPayload doc comment on
      // 'player_attack' for why this matters (overkill on a killing blow).
      const actualDamage = Math.max(0, event.targetHpBefore - event.targetHpAfter);
      pushEvent(telemetry, after, consumed, {
        type: 'player_attack',
        weapon,
        targetId: event.targetId,
        targetType: event.enemyType,
        attackerPosition: { ...after.player.pos },
        targetPosition: target ? { ...target.pos } : { x: -1, y: -1 },
        outcome: event.targetHpAfter === 0 ? 'defeated' : 'hit',
        hitChance: null,
        roll: null,
        physicalDamage: event.damage,
        additionalDamage: 0,
        calculatedDamage: event.damage,
        actualDamage,
        targetHpBefore: event.targetHpBefore,
        targetHpAfter: event.targetHpAfter,
        defeated: event.targetHpAfter === 0,
        solConsumed: 0,
        knockbackApplied: false,
      });
      break;
    }
    case 'player_attack_missed': {
      const target = findEnemyById(after, event.targetId);
      pushEvent(telemetry, after, consumed, {
        type: 'player_attack',
        weapon: weaponOrUnarmed(event.weaponId ?? null),
        targetId: event.targetId,
        targetType: event.enemyType,
        attackerPosition: { ...after.player.pos },
        targetPosition: target ? { ...target.pos } : { x: -1, y: -1 },
        outcome: 'miss',
        hitChance: event.hitChance,
        roll: event.roll,
        physicalDamage: 0,
        additionalDamage: 0,
        calculatedDamage: 0,
        actualDamage: 0,
        targetHpBefore: target ? target.hp : 0,
        targetHpAfter: target ? target.hp : 0,
        defeated: false,
        solConsumed: 0,
        knockbackApplied: false,
      });
      break;
    }
    case 'sol_enchantment_used': {
      // Enriches the immediately-preceding player_attack RunEvent (same
      // turn, same target id) rather than pushing a separate event.
      const last = telemetry.events[telemetry.events.length - 1];
      if (last && last.type === 'player_attack') {
        // physicalDamage/additionalDamage split into base vs sol bonus
        // (both raw, pre-clamp figures from turn.ts's own baseDamage/
        // bonusDamage). actualDamage is deliberately left untouched here:
        // it was already computed from targetHpBefore/targetHpAfter,
        // which turn.ts sets *after* adding the sol bonus to `damage` —
        // so it already reflects the full bonused hit, sol or not.
        last.physicalDamage = event.baseDamage;
        last.additionalDamage = event.bonusDamage;
        last.calculatedDamage = event.baseDamage + event.bonusDamage;
        last.solConsumed = event.solBefore - event.solAfter;
      }
      pushEvent(telemetry, after, consumed, {
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
      const attacker = findEnemyById(after, event.attackerId);
      pushEvent(telemetry, after, consumed, {
        type: 'enemy_attack',
        attackerId: event.attackerId,
        attackerType: event.enemyType,
        attackType: 'melee',
        attackerPosition: attacker ? { ...attacker.pos } : { x: -1, y: -1 },
        playerPosition: { ...after.player.pos },
        outcome: 'hit',
        hitChance: null,
        roll: null,
        damage: event.damage,
        playerHpBefore: before.playerHp,
        playerHpAfter: after.player.hp,
      });
      if (event.damage > 0) {
        pushEvent(telemetry, after, consumed, { type: 'player_damaged', amount: event.damage, source: event.enemyType });
      }
      break;
    }
    case 'enemy_attack_missed': {
      const attacker = findEnemyById(after, event.attackerId);
      pushEvent(telemetry, after, consumed, {
        type: 'enemy_attack',
        attackerId: event.attackerId,
        attackerType: event.enemyType,
        attackType: 'melee',
        attackerPosition: attacker ? { ...attacker.pos } : { x: -1, y: -1 },
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
      // hitChance/roll are therefore recorded as null.
      const attacker = after.enemies.find((e) => e.id === event.enemyId);
      pushEvent(telemetry, after, consumed, {
        type: 'enemy_attack',
        attackerId: event.enemyId,
        attackerType: event.enemyType,
        attackType: 'kraken_tentacle',
        attackerPosition: attacker ? { ...attacker.pos } : { ...event.target },
        playerPosition: { ...after.player.pos },
        outcome: event.hit ? 'hit' : 'miss',
        hitChance: null,
        roll: null,
        damage: event.damage,
        playerHpBefore: before.playerHp,
        playerHpAfter: after.player.hp,
      });
      if (event.hit && event.damage > 0) {
        pushEvent(telemetry, after, consumed, { type: 'player_damaged', amount: event.damage, source: event.enemyType });
      }
      break;
    }
    case 'player_whiff': {
      pushEvent(telemetry, after, consumed, {
        type: 'attack_invalid',
        actor: 'player',
        weaponOrAttackType: weaponOrUnarmed(event.weaponId ?? null),
        reason: 'no_target_in_range',
      });
      break;
    }
    case 'solar_gun_insufficient_solar': {
      pushEvent(telemetry, after, consumed, {
        type: 'attack_invalid',
        actor: 'player',
        weaponOrAttackType: 'solar_gun',
        reason: 'insufficient_sol',
      });
      break;
    }
    case 'enemy_defeated': {
      pushEvent(telemetry, after, consumed, { type: 'enemy_defeated', targetType: event.enemyType, targetId: event.targetId });
      break;
    }
    case 'player_defeated': {
      pushEvent(telemetry, after, consumed, { type: 'player_defeated', cause: deriveDeathCauseFromTail(telemetry) });
      break;
    }
    case 'item_picked_up': {
      pushEvent(telemetry, after, consumed, { type: 'item_acquired', itemId: event.itemId });
      if (WEAPON_IDS.includes(event.itemId as WeaponId)) {
        pushEvent(telemetry, after, consumed, { type: 'equipment_acquired', slot: 'weapon', id: event.itemId as WeaponId });
      } else if (ARMOR_IDS.includes(event.itemId as ArmorId)) {
        pushEvent(telemetry, after, consumed, { type: 'equipment_acquired', slot: 'armor', id: event.itemId as ArmorId });
      }
      break;
    }
    case 'item_used': {
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'heal', amount: event.healed });
      if (event.healed > 0) {
        // event.healed is already the actual, maxHp-clamped delta (see
        // turn.ts's applyItemUse: `healed = player.hp - before`, computed
        // *after* the Math.min clamp) — it is the correct actualHealing
        // as-is. requestedAmount is the item's raw, unclamped healAmount
        // (ITEM_DEFINITIONS), purely for visibility into how much was
        // "lost" to the clamp; it is never used for summary aggregation.
        pushEvent(telemetry, after, consumed, {
          type: 'player_healed',
          source: 'item',
          itemId: event.itemId,
          requestedAmount: ITEM_DEFINITIONS[event.itemId].healAmount ?? event.healed,
          actualHealing: event.healed,
          hpBefore: before.playerHp,
          hpAfter: after.player.hp,
        });
      }
      break;
    }
    case 'sun_fruit_used': {
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'sol', amount: event.recovered });
      pushEvent(telemetry, after, consumed, {
        type: 'sol_changed',
        before: before.playerSol,
        after: after.solarEnergy,
        amount: event.recovered,
        reason: 'item',
      });
      break;
    }
    case 'solar_charge_used': {
      pushEvent(telemetry, after, consumed, { type: 'solar_charge', recovered: event.recovered });
      pushEvent(telemetry, after, consumed, {
        type: 'sol_changed',
        before: before.playerSol,
        after: after.solarEnergy,
        amount: event.recovered,
        reason: 'solar_charge',
      });
      break;
    }
    case 'weapon_equipped': {
      pushEvent(telemetry, after, consumed, {
        type: 'equipment_changed',
        slot: 'weapon',
        from: before.equippedWeaponId,
        to: event.weaponId,
        reason: 'player_equip',
      });
      break;
    }
    case 'armor_equipped': {
      pushEvent(telemetry, after, consumed, {
        type: 'equipment_changed',
        slot: 'armor',
        from: before.equippedArmorId,
        to: event.armorId,
        reason: 'player_equip',
      });
      break;
    }
    case 'poison_damage': {
      // Phase 12.3 poison trap: pushes the detailed per-tick record
      // first, then the generic 'player_damaged' (source: 'poison') that
      // feeds the existing damageTaken/endCause aggregation machinery
      // (computeRunSummary's player_damaged case, deriveDeathCauseFromTail)
      // without duplicating that logic here — see this file's
      // 'poison_damage' RunEventPayload doc comment.
      pushEvent(telemetry, after, consumed, {
        type: 'poison_damage',
        actualDamage: event.actualDamage,
        hpBefore: event.hpBefore,
        hpAfter: event.hpAfter,
      });
      if (event.actualDamage > 0) {
        pushEvent(telemetry, after, consumed, { type: 'player_damaged', amount: event.actualDamage, source: 'poison' });
      }
      break;
    }
    case 'antidote_used': {
      // Phase 12.4: reuses item_used's existing extensible effect:string/
      // amount:number shape (telemetry.schema.requirements's "既存
      // item_usedの拡張可能なeffect:string構造を再利用する") rather than
      // a new event type. `amount` is fixed at 1 per
      // telemetry.success_record's "amountは解除した効果レコード数では
      // なく、解除成功を表す1とする" — not a count of removed records
      // (removeEffect could in principle remove more than one duplicate,
      // but that's an implementation-defensive detail, not something
      // telemetry should surface as a damage-like quantity).
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'poison_cure', amount: 1 });
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
  // weapon has a solarCost and the turn actually consumed SOL.
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
      pushEvent(telemetry, after, consumed, {
        type: 'sol_changed',
        before: before.playerSol,
        after: after.solarEnergy,
        amount: solDelta,
        reason: 'solar_gun',
      });
    }
  }
}

/** The most recent damage source recorded so far this call, per tests.combat's "死亡原因が最後の有効ダメージ源と一致する". */
function deriveDeathCauseFromTail(telemetry: RunTelemetry): string {
  for (let i = telemetry.events.length - 1; i >= 0; i--) {
    const e = telemetry.events[i];
    if (e.type === 'player_damaged') return e.source;
  }
  return 'unknown';
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
 * turn. A no-op if already finalized.
 */
export function finalizeRun(telemetry: RunTelemetry, state: GameState): void {
  if (telemetry.finalized) return;
  if (state.phase !== 'gameover' && state.phase !== 'victory') return;

  const result: 'clear' | 'death' = state.phase === 'victory' ? 'clear' : 'death';
  const cause = result === 'death' ? deriveDeathCauseFromTail(telemetry) : 'floor_cleared';

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
  zeroDamageHits: number;
  hitRate: number | null;
  damageDealt: number;
  averageDamagePerHit: number | null;
  kills: number;
}

export interface EnemyDamageStats {
  attackAttempts: number;
  hits: number;
  misses: number;
  zeroDamageHits: number;
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
  // Phase 12.3: `damageTaken` is the sum of every player_damaged event's
  // amount regardless of source (enemy attacks and poison alike) — the
  // "総damageTaken" telemetry.required asks for, distinct from
  // damageTakenByEnemy (per-enemy-only, poison excluded — see this
  // file's player_damaged case in computeRunSummary) and from each
  // PerFloorStats.damageTaken (which already summed all sources per
  // floor even before this phase, since it never filtered by source).
  combatOverall: { validAttacks: number; hits: number; misses: number; hitRate: number | null; damageDealt: number; damageTaken: number; kills: number };
  combatByWeapon: Record<string, WeaponCombatStats>;
  damageTakenByEnemy: Record<string, EnemyDamageStats>;
  equipment: { acquiredCount: number; changeCount: number; endingEquipment: { weapon: WeaponId | null; armor: ArmorId | null } };
  resources: { solGained: number; solConsumed: number; solarChargeActions: number; healingBySource: Record<string, number>; itemsUsedByType: Record<string, number> };
  progression: { enemiesDefeated: number; exitsReached: number };
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
  return { validAttacks: 0, invalidAttempts: 0, hits: 0, misses: 0, zeroDamageHits: 0, hitRate: null, damageDealt: 0, averageDamagePerHit: null, kills: 0 };
}

function emptyEnemyStats(): EnemyDamageStats {
  return { attackAttempts: 0, hits: 0, misses: 0, zeroDamageHits: 0, damage: 0 };
}

function emptyFloorStats(floor: number): PerFloorStats {
  return { floor, turns: 0, moves: 0, waits: 0, attacks: 0, kills: 0, damageDealt: 0, damageTaken: 0, solConsumed: 0, healing: 0 };
}

/**
 * Computes a RunSummary from `telemetry.events` alone. Kill counting
 * (Phase 10.3.2): a single canonical Set of "floor:targetId" strings —
 * built once from enemy_defeated events — is the sole source for
 * combatOverall.kills, each weapon's kills, progression.enemiesDefeated,
 * and each floor's kills, so these four numbers can never disagree
 * (previously each was accumulated independently from different, and
 * sometimes duplicated, signals).
 */
export function computeRunSummary(telemetry: RunTelemetry, finalState: GameState): RunSummary {
  const movement = { successfulMoves: 0, blockedMoves: 0, waits: 0 };
  const combatByWeapon: Record<string, WeaponCombatStats> = {};
  const damageTakenByEnemy: Record<string, EnemyDamageStats> = {};
  const perFloorMap = new Map<number, PerFloorStats>();
  let solGained = 0;
  let totalDamageTaken = 0;
  let solConsumed = 0;
  let solarChargeActions = 0;
  const healingBySource: Record<string, number> = {};
  const itemsUsedByType: Record<string, number> = {};
  let exitsReached = 0;
  let acquiredCount = 0;
  let changeCount = 0;

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

  // Canonical kill set: (floor, targetId) -> the weapon that landed the
  // killing blow. Built in a first pass so every later consumer reads
  // from the same ground truth.
  const killWeaponByKey = new Map<string, string>();
  for (const event of telemetry.events) {
    if (event.type === 'player_attack' && event.defeated) {
      killWeaponByKey.set(`${event.floor}:${event.targetId}`, event.weapon);
    }
  }
  const killedKeys = new Set(killWeaponByKey.keys());

  // Floor turn boundaries (Phase 10.3.2): floor_started/floor_completed/
  // run_completed mark the turn each floor began and ended on a shared
  // global turn counter (state.turn is never reset across floors — see
  // state.ts). turns-on-floor = end_turn - start_turn, so the sum over
  // every floor telescopes to exactly the final turn (== totalTurns),
  // instead of a per-floor "distinct turn numbers seen in events" count
  // that could drift from totalTurns depending on which turns happened
  // to produce zero events on a given floor.
  const floorStartTurn = new Map<number, number>();
  const floorEndTurn = new Map<number, number>();
  for (const event of telemetry.events) {
    if (event.type === 'floor_started') {
      floorStartTurn.set(event.floor, event.turn);
    } else if (event.type === 'floor_completed') {
      floorEndTurn.set(event.floor, event.turn);
    } else if (event.type === 'run_completed') {
      floorEndTurn.set(event.floor, event.turn);
    }
  }

  for (const event of telemetry.events) {
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
          stats.damageDealt += event.actualDamage;
          getFloorStats(event.floor).damageDealt += event.actualDamage;
          if (event.actualDamage === 0) stats.zeroDamageHits++;
        }
        break;
      }
      case 'attack_invalid': {
        const stats = getWeaponStats(event.weaponOrAttackType);
        stats.invalidAttempts++;
        break;
      }
      case 'enemy_defeated': {
        const key = `${event.floor}:${event.targetId}`;
        const weapon = killWeaponByKey.get(key);
        if (weapon) {
          getWeaponStats(weapon).kills++;
          getFloorStats(event.floor).kills++;
        }
        break;
      }
      case 'player_damaged': {
        // Phase 12.3: poison is excluded from damageTakenByEnemy (it has
        // no attacking enemy — telemetry.forbidden's "仮の敵種を追加して
        // damageTakenByEnemyへ記録する"), but still counts toward the
        // overall and per-floor totals (telemetry.required's "総damageTaken
        // とフロア別damageTakenへactualDamageを加算する").
        if (event.source !== 'poison') {
          const stats = getEnemyStats(event.source);
          stats.damage += event.amount;
        }
        totalDamageTaken += event.amount;
        getFloorStats(event.floor).damageTaken += event.amount;
        break;
      }
      case 'enemy_attack': {
        const stats = getEnemyStats(event.attackerType);
        stats.attackAttempts++;
        if (event.outcome === 'miss') {
          stats.misses++;
        } else {
          stats.hits++;
          if (event.damage === 0) stats.zeroDamageHits++;
        }
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
      case 'player_healed':
        healingBySource[event.source] = (healingBySource[event.source] ?? 0) + event.actualHealing;
        getFloorStats(event.floor).healing += event.actualHealing;
        break;
      case 'item_used':
        itemsUsedByType[event.itemId] = (itemsUsedByType[event.itemId] ?? 0) + 1;
        break;
      case 'exit_reached':
        exitsReached++;
        break;
      default:
        break;
    }
  }

  for (const [floor, startTurn] of floorStartTurn) {
    // A floor that never got its own floor_completed/run_completed (the
    // run is still mid-floor, e.g. computeRunSummary called before the
    // run ended) falls back to the current/final GameState turn instead
    // of startTurn itself — falling back to startTurn would silently
    // report 0 turns spent on an in-progress floor.
    const endTurn = floorEndTurn.get(floor) ?? finalState.turn;
    getFloorStats(floor).turns = Math.max(0, endTurn - startTurn);
  }

  let overallValid = 0;
  let overallHits = 0;
  let overallMisses = 0;
  let overallDamage = 0;
  for (const stats of Object.values(combatByWeapon)) {
    stats.hitRate = stats.validAttacks > 0 ? stats.hits / stats.validAttacks : null;
    stats.averageDamagePerHit = stats.hits > 0 ? stats.damageDealt / stats.hits : null;
    overallValid += stats.validAttacks;
    overallHits += stats.hits;
    overallMisses += stats.misses;
    overallDamage += stats.damageDealt;
  }

  return {
    movement,
    combatOverall: {
      validAttacks: overallValid,
      hits: overallHits,
      misses: overallMisses,
      hitRate: overallValid > 0 ? overallHits / overallValid : null,
      damageDealt: overallDamage,
      damageTaken: totalDamageTaken,
      kills: killedKeys.size,
    },
    combatByWeapon,
    damageTakenByEnemy,
    equipment: {
      acquiredCount,
      changeCount,
      endingEquipment: { weapon: finalState.equippedWeaponId, armor: finalState.equippedArmorId },
    },
    resources: { solGained, solConsumed, solarChargeActions, healingBySource, itemsUsedByType },
    progression: { enemiesDefeated: killedKeys.size, exitsReached },
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

/** Phase 12.3: schemaVersion 3 -> 4 (poison), "v3" -> "v4" filenames, so old exports are never confused with the new poison-aware ones. */
export function buildExportFilename(telemetry: RunTelemetry): string {
  const seedPart = sanitizeForFilename(String(telemetry.seed));
  const resultPart = telemetry.result === 'clear' ? 'clear' : 'death';
  return `rogue-of-sun-run-v4-${seedPart}-${resultPart}.json`;
}

export interface TelemetryDocument {
  schemaVersion: 4;
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
 * Builds the full exportable document: JSON.stringify of the return
 * value is exactly what json_export writes to a Blob. Never includes
 * local file paths, credentials, usernames, real-time timestamps, or
 * browser identification. `run.totalTurns` is authoritatively
 * `finalState.turn` (the single GameState turn counter) rather than a
 * max-over-events derivation, so it can never disagree with the value
 * actually reachable from GameState.
 */
export function buildTelemetryDocument(telemetry: RunTelemetry, finalState: GameState): TelemetryDocument {
  const summary = computeRunSummary(telemetry, finalState);
  return {
    schemaVersion: 4,
    gameVersion: 'phase-12.3',
    run: {
      seed: telemetry.seed,
      result: telemetry.result,
      endCause: telemetry.endCause,
      floorsReached: finalState.floor,
      totalTurns: finalState.turn,
      totalEvents: telemetry.events.length,
    },
    summary,
    events: telemetry.events,
  };
}
