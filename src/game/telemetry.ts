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
import { EnemyType, GameState, PlayerAction, WeaponId, ArmorId, ItemId, AbilityId, AbilityValues, ElementId, ElementalAffinity } from './types';
import type { TurnResult } from './turn';
import { getEffectivePlayerDefense, REGEN_AMOUNT_PER_TICK, SUNLIGHT_CHARGE_AMOUNT } from './turn';
import { ITEM_DEFINITIONS } from './item-def';
import { WEAPON_IDS_IN_ORDER } from './weapon-def';
import { ARMOR_IDS_IN_ORDER } from './armor-def';
import { getExperience, getLevel, getUnspentAbilityPoints } from './progression';
import { getAbilities, getElementalMindBonus, getPowerDamageBonus } from './ability';
import { getHunger } from './hunger';
import { getActiveEffect } from './effects';
import { ELEMENTAL_AFFINITY_BONUS_DAMAGE } from './combat';
import { getEquipmentInstanceById, isWeaponOrArmorId } from './equipment-instance';

// ---------------------------------------------------------------------
// Event schema (event_model / event_types / event_requirements)
// ---------------------------------------------------------------------

export interface RunEventCommon {
  eventIndex: number;
  turn: number;
  floor: number;
  leg: 'descent' | 'ascent';
  depth: number;
  turnConsumed: boolean;
}

export type RunEventPayload =
  // Phase 15.2 recovery/satiety/status rebalance: `satiety` captures the
  // run's starting satiety value (schemaVersion bump not required since
  // this only adds a field, never changes an existing one's meaning) —
  // see computeRunSummary's satiety.start. Phase 15.3 adds `sol`
  // identically for the starting SOL value.
  | { type: 'run_started'; seed: number; satiety: number; sol: number }
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
      // Phase 15.2 recovery/satiety/status rebalance: whether the banana
      // attack_up effect was active at the moment this attack was
      // resolved (read from the pre-action snapshot, since attack_up's
      // bonus is already baked into physicalDamage and not otherwise
      // separately observable after the fact) — see computeRunSummary's
      // banana.attacksWhileActive, which counts every player_attack
      // (hit, miss, or defeated — i.e. every attack attempt, matching
      // this file's existing validAttacks/combatByWeapon convention of
      // counting attempts rather than only hits) with this field true.
      attackUpActive: boolean;
      // Phase 15.3 SOL/element/ability rebalance: the power-ability
      // direct-attack bonus in effect for this attack (ability.ts's
      // getPowerDamageBonus, already baked into physicalDamage) —
      // exposed separately so computeRunSummary's abilities.
      // powerBonusDamageTotal can attribute how much of the total
      // damage dealt came specifically from the power ability, without
      // re-deriving POWER_DAMAGE_PER_RANK here.
      powerBonus: number;
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
      // Phase 15.1 core combat rebalance: computeIncomingDamage became a
      // proportional (percentage) reduction instead of flat subtraction,
      // so "how much armor actually reduced this hit by" is no longer
      // recoverable from `damage` alone after the fact — these three
      // fields are captured at push-time instead. rawAttackPower is the
      // attacking enemy's own attack stat (pre-reduction); armorReduction
      // is rawAttackPower - damage; flooredAtMinimum is true when the
      // proportional formula's unfloored result was below 1 (i.e. this
      // hit landed at the computeIncomingDamage minimum-damage floor
      // rather than its own natural rounded value). All three are 0/0/
      // false on a miss (damage is always 0 on a miss).
      rawAttackPower: number;
      armorReduction: number;
      flooredAtMinimum: boolean;
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
  //
  // Phase 15.2 recovery/satiety/status rebalance: widened again to allow
  // 'starvation' — starvation_damage was previously never translated into
  // any TelemetryEvent at all (a pre-existing gap this phase fixes), and
  // follows the exact same "non-enemy damage source" precedent poison set.
  // Purely additive (a new possible value alongside the existing ones,
  // consistent with Phase 15.1's own precedent for enemy_attack/
  // EnemyDamageStats additions) — no schemaVersion bump.
  | { type: 'player_damaged'; amount: number; source: EnemyType | 'poison' | 'starvation' }
  | { type: 'player_defeated'; cause: string }
  | { type: 'equipment_acquired'; slot: 'weapon' | 'armor'; id: WeaponId | ArmorId }
  | { type: 'equipment_changed'; slot: 'weapon' | 'armor'; from: WeaponId | ArmorId | null; to: WeaponId | ArmorId; reason: string }
  | { type: 'equipment_removed'; slot: 'weapon' | 'armor'; id: WeaponId | ArmorId }
  | { type: 'equipment_discarded'; slot: 'weapon' | 'armor'; id: WeaponId | ArmorId }
  | { type: 'item_acquired'; itemId: ItemId }
  | { type: 'item_used'; itemId: ItemId; effect: string; amount: number }
  | { type: 'item_discarded'; itemId: ItemId }
  | {
      type: 'sol_changed';
      before: number;
      after: number;
      amount: number;
      reason: 'solar_gun' | 'melee_enchantment' | 'solar_charge' | 'item' | 'other';
      // Phase 15.3 SOL/element/ability rebalance: the raw, pre-clamp
      // amount this recovery *asked for* (e.g. ITEM_DEFINITIONS.sun_
      // fruit.solarAmount, or SUNLIGHT_CHARGE_AMOUNT) — only meaningful
      // for recovery reasons ('item'/'solar_charge'); undefined for
      // consumption reasons, where `amount` (always negative) already
      // is the exact, never-clamped-from-below cost. Distinct from
      // `amount`, which is always the real, maxSolarEnergy-clamped delta
      // (after - before) — mirrors player_healed's requestedAmount/
      // actualHealing distinction.
      requestedAmount?: number;
    }
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
  // Phase 18.1/18.2: mirrors events.ts's 'trap_triggered'/'trap_revealed'
  // GameEvents 1:1 (trapType carried through unchanged; 'source'
  // distinguishes ordinary player-step discovery from a clairvoyance
  // fruit use — see turn.ts's revealTrap, the single point both paths
  // funnel through). Kept as two distinct RunEvent types rather than one
  // generic "trap_event" so a consumer can filter discovery from
  // activation without a payload-shape branch.
  | { type: 'trap_revealed'; trapType: import('./types').TrapType; source: 'step' | 'clairvoyance' | 'grigri_glasses' }
  | { type: 'trap_triggered'; trapType: import('./types').TrapType }
  // Phase 15.2 recovery/satiety/status rebalance: previously
  // starvation_damage had no TelemetryEvent translation at all (see
  // translateGameEvent's 'starvation_damage' case) — mirrors
  // poison_damage's shape exactly (STARVATION_DAMAGE is always 1, but
  // this stays a full hpBefore/hpAfter record rather than a bare count
  // for the same reasons poison_damage does: exact clamping visibility
  // near 0 HP). Pushed alongside a generic 'player_damaged' (source:
  // 'starvation') for the same tick, exactly like poison_damage.
  | { type: 'starvation_damage'; damage: number; hpBefore: number; hpAfter: number }
  // Phase 15.2 recovery/satiety/status rebalance: pushed only on the turn
  // an actual 1-point *natural* satiety decrease happens (never for
  // chocolate's recovery — see the 'chocolate_used' case below, which
  // pushes its own 'item_used' instead) — mirrors satiety_decreased's
  // GameEvent doc comment in events.ts. Used by computeRunSummary to
  // reconstruct satiety.min and satiety.naturalLoss without re-deriving
  // HUNGER_DECREASE_INTERVAL/HUNGER_DECREASE_AMOUNT itself.
  | { type: 'satiety_decreased'; amount: number; satietyAfter: number }
  // Phase 15.3 SOL/element/ability rebalance: one record per successful
  // element enchantment activation (sol included), covering both the
  // requested (pre-clamp) and actual (post-overkill-clamp) elemental
  // damage, the affinity that produced it, and how much of it came from
  // the mind-ability bonus specifically. `actualElementalDamage` is
  // derived from the same targetHpBefore/targetHpAfter-based actualDamage
  // already computed for the enriched player_attack RunEvent, minus the
  // physical portion, floored at 0 and capped at the requested amount —
  // physical damage is treated as applying first (turn.ts computes
  // `damage = baseDamage; ...; damage += elementalDamage` in that order),
  // so any overkill clamp is attributed to the elemental portion last.
  | {
      type: 'element_activation';
      element: ElementId;
      affinity: ElementalAffinity;
      weapon: WeaponId;
      requestedElementalDamage: number;
      actualElementalDamage: number;
      mindBonusPortion: number;
      solConsumed: number;
    }
  // Phase 15.3 SOL/element/ability rebalance: pushed instead of nothing
  // when an eligible, selected, unlocked element lacks enough SOL for a
  // specific hit — see events.ts's element_activation_failed doc comment
  // and turn.ts's applyPlayerAttackToEnemy for the exact trigger.
  | { type: 'element_activation_failed'; element: ElementId; reason: 'insufficient_sol' }
  | { type: 'exit_reached'; floor: number }
  // Phase 13.1 experience/level/ability-point progression foundation.
  | { type: 'experience_gained'; amount: number; enemyId: number; enemyType: EnemyType; level: number; experience: number }
  | { type: 'player_leveled_up'; previousLevel: number; newLevel: number; abilityPointsGained: number; unspentAbilityPoints: number }
  // Phase 13.2 ability point allocation foundation.
  | { type: 'ability_point_spent'; ability: AbilityId; previousValue: number; newValue: number; remainingAbilityPoints: number }
  // Phase 24.4e2 呪いtelemetry統合: internal-only raw events for curse
  // lifecycle transitions. `equipmentInstanceId`/`itemId` carry the real,
  // un-obscured identity (telemetry.rules' "内部telemetryでは真ID保持
  //可" — never surfaced to player-visible text; message-log.ts's own
  // formatting is entirely unaffected by these, per events.ts's own doc
  // comment on the source GameEvents). See computeRunSummary's `curses`
  // aggregation for how each of these is counted.
  | { type: 'equipment_curse_generated'; route: 'normal_floor' | 'monster_house' | 'enemy_drop' | 'star_transform'; equipmentInstanceId: string; itemId: WeaponId | ArmorId }
  | { type: 'equipment_cursed'; source: 'mummy_hit' | 'curse_trap'; equipmentInstanceId: string; itemId: WeaponId | ArmorId; equipped: boolean; revealed: boolean }
  | { type: 'equipment_curse_discovered'; equipmentInstanceId: string; itemId: WeaponId | ArmorId }
  | { type: 'cursed_equipment_acquired'; equipmentInstanceId: string; itemId: WeaponId | ArmorId }
  | { type: 'cursed_equipment_equipped'; equipmentInstanceId: string; itemId: WeaponId | ArmorId; wasRevealed: boolean }
  | { type: 'curse_lock_rejected'; operation: 'unequip' | 'equip_swap' | 'place' | 'discard' | 'solar_forge' | 'star_transform'; equipmentInstanceId?: string; itemId?: WeaponId | ArmorId }
  | { type: 'equipment_uncursed'; source: 'temperance'; equipmentInstanceId: string; itemId: WeaponId | ArmorId }
  | { type: 'cursed_equipment_discarded'; equipmentInstanceId: string; itemId: WeaponId | ArmorId; action: 'place' | 'discard' }
  | { type: 'cursed_equipment_floor_transition' };

export type RunEvent = RunEventCommon & RunEventPayload;

// ---------------------------------------------------------------------
// RunTelemetry container and lifecycle
// ---------------------------------------------------------------------

export interface RunTelemetry {
  // Phase 13.3c: bumped from 6 to 7 — this phase adds no new RunEvent
  // category and no new RunSummary field (the ability-rank snapshot this
  // phase needed, endingAbilityRanks, was already added in Phase 13.2
  // below — see RunSummary.progression's doc comment); the bump itself
  // is purely a version marker so any Phase 13.3c-adjacent tooling can
  // distinguish exports produced before vs after the ability numeric
  // effects (Phase 13.3a) and speed/action-gauge scheduler (Phase 13.3b)
  // were wired in, per telemetry.schema's "from: 6" / "to: 7". No v1-v6
  // read-compatibility shim is provided — this is an export-only format.
  // Phase 24.4e2: bumped from 7 to 8 — this phase adds 9 new RunEvent
  // categories (equipment_curse_generated/equipment_cursed/
  // equipment_curse_discovered/cursed_equipment_acquired/
  // cursed_equipment_equipped/curse_lock_rejected/equipment_uncursed/
  // cursed_equipment_discarded/cursed_equipment_floor_transition) and 1
  // new RunSummary field (`curses`) to the public export shape — per
  // schema_policy's "public export summaryにcurses fieldを追加するため
  // telemetry schemaVersionを1だけ上げる". No v1-v7 read-compatibility
  // shim is provided — this remains an export-only format (no
  // save/load, no importer — schema_policy's "古いrun JSONを読み込む
  // migrationは、現在import機構がなければ不要").
  // Phase 24.6c1: bumped from 8 to 9; every event now includes `leg`
  // and the backward-compatible `depth` alias in its common fields.
  schemaVersion: 9;
  seed: number;
  result: 'in_progress' | 'clear' | 'death';
  endCause: string | null;
  events: RunEvent[];
  finalized: boolean;
}

/**
 * Phase 24.4e2: scans `state.groundItems` for every floor-generated
 * weapon/armor whose EquipmentInstance already landed cursed (the curse
 * roll happens at floor-generation time — see state.ts's buildFloorState
 * — before any GameEvent mechanism exists to push through, since floor
 * generation itself is not a processTurn call). `state.groundItems` is
 * always rebuilt from scratch per floor (never carried over — see its
 * own GameState doc comment), so every entry found here is guaranteed to
 * be freshly generated for *this* floor, never a previous floor's
 * already-reported instance. Route is derived from each GroundItem's own
 * `spawnSource` (Phase 21.5): 'monster_house' if set, 'normal_floor'
 * otherwise. Called from both createRunTelemetry (floor 1) and
 * recordFloorStarted (floors 2+) — both represent "a floor was just
 * generated" equally, even though only the latter is also a
 * "transition" (see pushFloorTransitionCurseEvent below for that
 * distinct, floor-2+-only concern).
 */
function pushFloorGeneratedCurseEvents(telemetry: RunTelemetry, state: GameState): void {
  for (const item of state.groundItems) {
    if (!item.equipmentInstanceId) continue;
    const instance = getEquipmentInstanceById(state, item.equipmentInstanceId);
    // Phase 24.5b: accessory is never floor-generated this phase (Phase
    // 24.5c's job), so this guard is unreachable-false for an accessory
    // instance in production — added to satisfy this event's WeaponId |
    // ArmorId itemId field now that EquipmentInstance.definitionId is
    // the wider EquipmentDefinitionId.
    if (!instance || !instance.cursed || !isWeaponOrArmorId(instance.definitionId)) continue;
    pushEvent(telemetry, state, false, {
      type: 'equipment_curse_generated',
      route: item.spawnSource === 'monster_house' ? 'monster_house' : 'normal_floor',
      equipmentInstanceId: instance.instanceId,
      itemId: instance.definitionId,
    });
  }
}

/**
 * Phase 24.4e2: pushed only from recordFloorStarted (floors 2+, a
 * genuine advanceToNextFloor transition) — never from createRunTelemetry
 * (floor 1 is not a "transition"), and never for the final floor's
 * victory clear (state.ts's floor-clear-vs-victory branch never calls
 * advanceToNextFloor for the final floor at all, so recordFloorStarted
 * is simply never invoked for that boundary — counter_semantics.
 * floor_transition's own "現在のtransition境界に従って明記する", applied
 * here as: only an actual advanceToNextFloor call counts). Counts
 * transitions, not equipped-item count — pushed at most once per call,
 * regardless of whether 1 or 2 equipped slots are cursed.
 */
function pushFloorTransitionCurseEvent(telemetry: RunTelemetry, state: GameState): void {
  const equippedInstanceIds = [state.equippedWeaponInstanceId, state.equippedArmorInstanceId].filter(
    (id): id is string => Boolean(id),
  );
  const anyEquippedCursed = equippedInstanceIds.some((id) => getEquipmentInstanceById(state, id)?.cursed);
  if (anyEquippedCursed) {
    pushEvent(telemetry, state, false, { type: 'cursed_equipment_floor_transition' });
  }
}

/**
 * Starts a brand-new RunTelemetry for `state` (a freshly created floor-1
 * GameState — see state.ts's createInitialState). Called once per run:
 * on the very first load and on every Enter/N restart (main.ts's
 * restart()), never mid-run.
 */
export function createRunTelemetry(state: GameState): RunTelemetry {
  const telemetry: RunTelemetry = {
    schemaVersion: 9,
    seed: state.runSeed,
    result: 'in_progress',
    endCause: null,
    events: [],
    finalized: false,
  };
  pushEvent(telemetry, state, false, { type: 'run_started', seed: state.runSeed, satiety: getHunger(state), sol: state.solarEnergy });
  pushEvent(telemetry, state, false, { type: 'floor_started', floor: state.floor });
  pushFloorGeneratedCurseEvents(telemetry, state);
  return telemetry;
}

function pushEvent(telemetry: RunTelemetry, state: GameState, turnConsumed: boolean, event: RunEventPayload): void {
  if (telemetry.finalized) return; // terminal.rules: "確定後に同じランへイベントを追加しない"
  telemetry.events.push({
    eventIndex: telemetry.events.length,
    turn: state.turn,
    floor: state.floor,
    leg: state.leg,
    depth: state.floor,
    turnConsumed,
    ...event,
  } as RunEvent);
}

// Phase 24.3: sourced from weapon-def.ts/armor-def.ts's own id-order
// arrays (single source of truth for the full 42-species roster) rather
// than a hardcoded literal list that only ever covered the pre-24.3 5
// species.
const WEAPON_IDS: WeaponId[] = WEAPON_IDS_IN_ORDER;
const ARMOR_IDS: ArmorId[] = ARMOR_IDS_IN_ORDER;

function weaponOrUnarmed(id: WeaponId | null): WeaponId | 'unarmed' {
  return id ?? 'unarmed';
}

/**
 * Pushes an 'element_activation' RunEvent (Phase 15.3), computing
 * actualElementalDamage/mindBonusPortion from already-known values —
 * see the 'element_activation' RunEventPayload doc comment for the
 * exact overkill-attribution convention (physical applies first, so any
 * clamp from an overkill hit is attributed to the elemental portion
 * last). `state` is only used for the mind-rank read (getElementalMindBonus);
 * mind rank never changes mid-attack, so `after` is always safe here.
 */
function pushElementActivation(
  telemetry: RunTelemetry,
  state: GameState,
  turnConsumed: boolean,
  args: {
    element: ElementId;
    affinity: ElementalAffinity;
    weapon: WeaponId;
    requestedElementalDamage: number;
    physicalDamage: number;
    actualTotalDamage: number;
    solConsumed: number;
  },
): void {
  const mindBonusPortion = ELEMENTAL_AFFINITY_BONUS_DAMAGE[args.affinity] === args.requestedElementalDamage
    ? 0
    : getElementalMindBonus(state);
  const actualElementalDamage = Math.min(
    args.requestedElementalDamage,
    Math.max(0, args.actualTotalDamage - args.physicalDamage),
  );
  pushEvent(telemetry, state, turnConsumed, {
    type: 'element_activation',
    element: args.element,
    affinity: args.affinity,
    weapon: args.weapon,
    requestedElementalDamage: args.requestedElementalDamage,
    actualElementalDamage,
    mindBonusPortion,
    solConsumed: args.solConsumed,
  });
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
  // Phase 16.2 replaced the coarse `after.player.hp - before.playerHp`
  // whole-turn diff used here with turn.ts's own
  // TurnResult.playerRegenAmount (the regen tick's isolated delta) —
  // the diff silently folded any other same-turn healing (an item use,
  // etc.) into the natural-regen total once REGEN_TURNS_PER_HP dropped
  // to 1 and regen started firing every turn. See docs/history/
  // phase-16-early-game-balance.md's Phase 16.2 section.
  if (result.playerRegenerated) {
    const actualHealing = result.playerRegenAmount;
    if (actualHealing > 0) {
      pushEvent(telemetry, after, consumed, {
        type: 'player_healed',
        source: 'natural_regeneration',
        requestedAmount: REGEN_AMOUNT_PER_TICK, // Phase 15.2: named constant, no longer a duplicated literal
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
  // Phase 15.2 recovery/satiety/status rebalance: whether attack_up
  // (banana) was active going into this turn's action — see the
  // 'player_attack' RunEventPayload's attackUpActive doc comment.
  attackUpActive: boolean;
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
    attackUpActive: getActiveEffect(state, 'attack_up') !== undefined,
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

function findEnemyById(state: GameState, id: number): { pos: { x: number; y: number }; hp: number; attack: number } | undefined {
  return state.enemies.find((e) => (e.id ?? 0) === id);
}

/**
 * Phase 15.1 core combat rebalance: computeIncomingDamage (combat.ts) is
 * now a proportional reduction, not a flat subtraction, so "how much
 * armor reduced this hit" and "did this hit land at the floor" can't be
 * recovered from the final `damage` value alone — this re-derives both
 * from the same formula turn.ts's getIncomingDamage uses, given the
 * attacker's raw attack power and the post-attack GameState (defense is
 * never changed by taking a hit, so `after` and `before` agree on it).
 * Pure and read-only: never mutates `state`, never re-rolls anything.
 */
function describeIncomingDamageReduction(
  state: GameState,
  rawAttackPower: number,
  actualDamage: number,
): { armorReduction: number; flooredAtMinimum: boolean } {
  const effectiveDefense = getEffectivePlayerDefense(state);
  const unflooredProportional = Math.round(rawAttackPower * Math.pow(2, -effectiveDefense / 10));
  return {
    armorReduction: rawAttackPower - actualDamage,
    flooredAtMinimum: unflooredProportional < 1,
  };
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
        attackUpActive: before.attackUpActive,
        powerBonus: getPowerDamageBonus(after),
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
        attackUpActive: before.attackUpActive,
        powerBonus: getPowerDamageBonus(after),
      });
      break;
    }
    case 'sol_enchantment_used': {
      // Enriches the immediately-preceding player_attack RunEvent (same
      // turn, same target id) rather than pushing a separate event.
      const last = telemetry.events[telemetry.events.length - 1];
      let actualDamageForSplit = 0;
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
        actualDamageForSplit = last.actualDamage;
      }
      pushEvent(telemetry, after, consumed, {
        type: 'sol_changed',
        before: event.solBefore,
        after: event.solAfter,
        amount: event.solAfter - event.solBefore,
        reason: 'melee_enchantment',
      });
      pushElementActivation(telemetry, after, consumed, {
        element: 'sol',
        affinity: event.affinity,
        weapon: event.weaponId,
        requestedElementalDamage: event.bonusDamage,
        physicalDamage: event.baseDamage,
        actualTotalDamage: actualDamageForSplit,
        solConsumed: event.solBefore - event.solAfter,
      });
      break;
    }
    case 'element_enchantment_used': {
      // Phase 14.3: mirrors sol_enchantment_used's telemetry handling
      // exactly (same RunEvent enrichment, same sol_changed reason),
      // just reading physicalDamage/elementalDamage instead of
      // baseDamage/bonusDamage. No new RunEvent category, no schema
      // change — see required_correctness.
      const last = telemetry.events[telemetry.events.length - 1];
      let actualDamageForSplit = 0;
      if (last && last.type === 'player_attack') {
        last.physicalDamage = event.physicalDamage;
        last.additionalDamage = event.elementalDamage;
        last.calculatedDamage = event.physicalDamage + event.elementalDamage;
        last.solConsumed = event.solBefore - event.solAfter;
        actualDamageForSplit = last.actualDamage;
      }
      pushEvent(telemetry, after, consumed, {
        type: 'sol_changed',
        before: event.solBefore,
        after: event.solAfter,
        amount: event.solAfter - event.solBefore,
        reason: 'melee_enchantment',
      });
      pushElementActivation(telemetry, after, consumed, {
        element: event.element,
        affinity: event.affinity,
        weapon: event.weaponId,
        requestedElementalDamage: event.elementalDamage,
        physicalDamage: event.physicalDamage,
        actualTotalDamage: actualDamageForSplit,
        solConsumed: event.solBefore - event.solAfter,
      });
      break;
    }
    case 'element_activation_failed': {
      pushEvent(telemetry, after, consumed, {
        type: 'element_activation_failed',
        element: event.element,
        reason: event.reason,
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
      const rawAttackPower = attacker ? attacker.attack : event.damage;
      const { armorReduction, flooredAtMinimum } = describeIncomingDamageReduction(after, rawAttackPower, event.damage);
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
        rawAttackPower,
        armorReduction,
        flooredAtMinimum,
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
        rawAttackPower: attacker ? attacker.attack : 0,
        armorReduction: 0,
        flooredAtMinimum: false,
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
      const rawAttackPower = attacker ? attacker.attack : event.damage;
      const { armorReduction, flooredAtMinimum } = event.hit
        ? describeIncomingDamageReduction(after, rawAttackPower, event.damage)
        : { armorReduction: 0, flooredAtMinimum: false };
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
        rawAttackPower,
        armorReduction,
        flooredAtMinimum,
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
    case 'experience_gained': {
      pushEvent(telemetry, after, consumed, {
        type: 'experience_gained',
        amount: event.amount,
        enemyId: event.enemyId,
        enemyType: event.enemyType,
        level: event.level,
        experience: event.experience,
      });
      break;
    }
    case 'player_leveled_up': {
      pushEvent(telemetry, after, consumed, {
        type: 'player_leveled_up',
        previousLevel: event.previousLevel,
        newLevel: event.newLevel,
        abilityPointsGained: event.abilityPointsGained,
        unspentAbilityPoints: event.unspentAbilityPoints,
      });
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
      // Phase 24.4e2: cursed_equipment_acquired — pickup of a
      // ground-generated equipment instance that was already cursed
      // (curseRevealed true or false alike — counter_semantics.acquired
      // doesn't distinguish). Never fires for a Star/forge-minted
      // instance (those are created directly in inventory, never via a
      // GroundItem pickup) or for a non-equipment item (no
      // equipmentInstanceId on the source event in that case).
      if (event.equipmentInstanceId) {
        const acquiredInstance = getEquipmentInstanceById(after, event.equipmentInstanceId);
        // Phase 24.5b: see pushFloorGeneratedCurseEvents' identical
        // guard/comment above — accessory is never cursed this phase,
        // so this is unreachable-false for an accessory instance.
        if (acquiredInstance?.cursed && isWeaponOrArmorId(acquiredInstance.definitionId)) {
          pushEvent(telemetry, after, consumed, {
            type: 'cursed_equipment_acquired',
            equipmentInstanceId: acquiredInstance.instanceId,
            itemId: acquiredInstance.definitionId,
          });
        }
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
        // Phase 15.3: raw pre-clamp request, vs `amount` (real clamped delta).
        requestedAmount: ITEM_DEFINITIONS[event.itemId].solarAmount ?? event.recovered,
      });
      break;
    }
    // Phase 15.2 recovery/satiety/status rebalance: chocolate_used
    // previously had no TelemetryEvent translation at all (a pre-existing
    // gap this phase fixes) — reuses item_used's existing extensible
    // effect:string/amount:number shape (the same precedent antidote_used/
    // panacea_used below already follow), so itemsUsedByType picks up
    // chocolate for free via the existing generic item_used aggregation.
    // Never pushes satiety_decreased: that event is reserved for the
    // natural HUNGER_DECREASE_INTERVAL tick only, so chocolate's recovery
    // is never counted as "natural loss" going negative.
    case 'chocolate_used': {
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'satiety', amount: event.recovered });
      break;
    }
    // Phase 15.2 recovery/satiety/status rebalance: pushed only on the
    // turn an actual natural 1-point satiety decrease happens — see this
    // event's RunEventPayload doc comment above.
    case 'satiety_decreased': {
      pushEvent(telemetry, after, consumed, {
        type: 'satiety_decreased',
        amount: event.amount,
        satietyAfter: event.satietyAfter,
      });
      break;
    }
    // Phase 15.2 recovery/satiety/status rebalance: starvation_damage
    // previously had no TelemetryEvent translation at all (a pre-existing
    // gap this phase fixes) — mirrors poison_damage's own two-event
    // pattern exactly (detailed record + generic player_damaged for the
    // existing damageTaken/endCause aggregation machinery), using the new
    // 'starvation' player_damaged source rather than reusing 'poison'.
    case 'starvation_damage': {
      pushEvent(telemetry, after, consumed, {
        type: 'starvation_damage',
        damage: event.damage,
        hpBefore: before.playerHp,
        hpAfter: after.player.hp,
      });
      if (event.damage > 0) {
        pushEvent(telemetry, after, consumed, { type: 'player_damaged', amount: event.damage, source: 'starvation' });
      }
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
        requestedAmount: SUNLIGHT_CHARGE_AMOUNT,
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
      // amount:number shape (telemetry.requirements's "既存item_used構造
      // を再利用する") rather than a new event type. `amount` is fixed at
      // 1 per telemetry.requirements's "amountは解除した状態異常数では
      // なく使用成功1回を表す1とする" — not a count of removed ailments.
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'poison_cure', amount: 1 });
      break;
    }
    case 'panacea_used': {
      // Same reasoning as antidote_used above — amount stays 1
      // regardless of how many status ailments this single use cured.
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'status_cure', amount: 1 });
      break;
    }
    case 'trap_revealed': {
      pushEvent(telemetry, after, consumed, { type: 'trap_revealed', trapType: event.trapType, source: event.source });
      break;
    }
    case 'trap_triggered': {
      pushEvent(telemetry, after, consumed, { type: 'trap_triggered', trapType: event.trapType });
      break;
    }
    case 'clairvoyance_used': {
      // Phase 18.2: reuses item_used's existing extensible effect:string/
      // amount:number shape (same precedent as antidote_used/
      // panacea_used above), with amount carrying revealedCount (0 is a
      // valid, expected value — clairvoyance_fruit.consumption's "hidden
      // 罠が0件でも使用は成立する").
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: event.itemId, effect: 'trap_reveal', amount: event.revealedCount });
      break;
    }
    case 'grigri_glasses_activated': {
      // Phase 24.5d: same item_used effect:'trap_reveal' reuse as
      // clairvoyance_used above (telemetry.policy's "新規raw categoryは
      // 原則追加しない") — itemId is fixed to 'grigri_glasses' since this
      // event carries no itemId of its own.
      pushEvent(telemetry, after, consumed, { type: 'item_used', itemId: 'grigri_glasses', effect: 'trap_reveal', amount: event.revealedCount });
      break;
    }
    // Phase 24.4e2 呪いtelemetry統合: below are the raw-event
    // translations for every curse lifecycle transition observable from
    // within a processTurn call (generation via enemy_drop/star_transform,
    // active-curse infliction/discovery via mummy_hit/curse_trap,
    // equip-time discovery/equip, curse-lock rejections, Temperance
    // uncurse, place/discard removal). normal_floor/monster_house
    // generation and floor-transition-while-cursed-equipped have no
    // GameEvent of their own (floor generation/transition has no event
    // stream — see state.ts) and are instead observed directly from
    // GameState by recordFloorStarted below.
    case 'equipment_curse_generated': {
      pushEvent(telemetry, after, consumed, {
        type: 'equipment_curse_generated',
        route: event.route,
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
      });
      break;
    }
    // Phase 24.4e2: reuses Phase 24.4e1's equipment_cursed GameEvent
    // verbatim as the "inflicted" counter's raw source — never
    // reimplemented, per rng_design/event_boundary_rules'
    // "active curse付与ではPhase 24.4e1のequipment_cursedを正規eventと
    // して再利用する".
    case 'equipment_cursed': {
      pushEvent(telemetry, after, consumed, {
        type: 'equipment_cursed',
        source: event.source,
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
        equipped: event.equipped,
        revealed: event.revealed,
      });
      break;
    }
    case 'equipment_curse_discovered': {
      pushEvent(telemetry, after, consumed, {
        type: 'equipment_curse_discovered',
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
      });
      break;
    }
    case 'cursed_equipment_equipped': {
      pushEvent(telemetry, after, consumed, {
        type: 'cursed_equipment_equipped',
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
        wasRevealed: event.wasRevealed,
      });
      break;
    }
    // Phase 24.4e2: this event (events.ts) is only ever pushed directly
    // for the star_transform operation — the other 5 operations are
    // derived below from their own pre-existing `reason: 'cursed'`
    // events, each producing the same curse_lock_rejected RunEventPayload.
    case 'curse_lock_rejected': {
      pushEvent(telemetry, after, consumed, {
        type: 'curse_lock_rejected',
        operation: event.operation,
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
      });
      break;
    }
    case 'equipment_uncursed': {
      pushEvent(telemetry, after, consumed, {
        type: 'equipment_uncursed',
        source: event.source,
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
      });
      break;
    }
    case 'cursed_equipment_discarded': {
      pushEvent(telemetry, after, consumed, {
        type: 'cursed_equipment_discarded',
        equipmentInstanceId: event.equipmentInstanceId,
        itemId: event.itemId,
        action: event.action,
      });
      break;
    }
    // Phase 24.4e2: derived curse_lock_rejected translations — each of
    // these 4 GameEvent categories already existed before this Phase
    // and already carries a `reason` field that distinguishes a
    // curse-lock-caused rejection from every other rejection reason for
    // that same action; only the 'cursed' branch is ever translated
    // into curse_lock_rejected (every other reason is left untranslated
    // by this addition, exactly as before this Phase). The rejected
    // individual is always the currently-equipped one for its slot
    // (equip_swap/unequip both only ever block the *currently equipped*
    // instance — the block target and the request target are never a
    // different individual), so `after.equippedWeaponInstanceId`/
    // `equippedArmorInstanceId` (unchanged by a rejected action) safely
    // resolves it.
    case 'weapon_equip_blocked': {
      if (event.reason === 'cursed' && after.equippedWeaponInstanceId) {
        const instance = getEquipmentInstanceById(after, after.equippedWeaponInstanceId);
        if (instance && isWeaponOrArmorId(instance.definitionId)) {
          pushEvent(telemetry, after, consumed, {
            type: 'curse_lock_rejected',
            operation: 'equip_swap',
            equipmentInstanceId: instance.instanceId,
            itemId: instance.definitionId,
          });
        }
      }
      break;
    }
    case 'armor_equip_blocked': {
      if (event.reason === 'cursed' && after.equippedArmorInstanceId) {
        const instance = getEquipmentInstanceById(after, after.equippedArmorInstanceId);
        if (instance && isWeaponOrArmorId(instance.definitionId)) {
          pushEvent(telemetry, after, consumed, {
            type: 'curse_lock_rejected',
            operation: 'equip_swap',
            equipmentInstanceId: instance.instanceId,
            itemId: instance.definitionId,
          });
        }
      }
      break;
    }
    case 'weapon_unequip_blocked': {
      if (event.reason === 'cursed' && after.equippedWeaponInstanceId) {
        const instance = getEquipmentInstanceById(after, after.equippedWeaponInstanceId);
        if (instance && isWeaponOrArmorId(instance.definitionId)) {
          pushEvent(telemetry, after, consumed, {
            type: 'curse_lock_rejected',
            operation: 'unequip',
            equipmentInstanceId: instance.instanceId,
            itemId: instance.definitionId,
          });
        }
      }
      break;
    }
    case 'armor_unequip_blocked': {
      if (event.reason === 'cursed' && after.equippedArmorInstanceId) {
        const instance = getEquipmentInstanceById(after, after.equippedArmorInstanceId);
        if (instance && isWeaponOrArmorId(instance.definitionId)) {
          pushEvent(telemetry, after, consumed, {
            type: 'curse_lock_rejected',
            operation: 'unequip',
            equipmentInstanceId: instance.instanceId,
            itemId: instance.definitionId,
          });
        }
      }
      break;
    }
    // Phase 24.4e2: solar_forge_failed carries no equipmentInstanceId of
    // its own (validateForgeMaterials never identified *which* material
    // was cursed in its own reason-only failure payload — see
    // solar-forge.ts) — curse_lock_rejected's equipmentInstanceId/itemId
    // are optional for exactly this case (the only one that can't
    // resolve them from GameState alone, since a rejected forge attempt
    // never puts an equipped-only assumption in play the way
    // equip/unequip's block always does).
    case 'solar_forge_failed': {
      if (event.reason === 'cursed') {
        pushEvent(telemetry, after, consumed, { type: 'curse_lock_rejected', operation: 'solar_forge' });
      }
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
  // Phase 24.4e2: a genuine floor transition — both the new floor's own
  // freshly-generated curse instances and the "was a cursed item
  // equipped across this transition" marker apply here, never at
  // createRunTelemetry (floor 1 is not a transition).
  pushFloorGeneratedCurseEvents(telemetry, state);
  pushFloorTransitionCurseEvent(telemetry, state);
}

/**
 * Records one successful ability point allocation (Phase 13.2): called
 * by main.ts right after ability.ts's allocateAbilityPoint (via
 * resolveAbilityConfirm) returns `success: true`. Ability allocation is
 * a non-turn state update — never routed through processTurn — so this
 * exists as its own dedicated recorder (mirroring recordFloorStarted's
 * direct-push pattern) rather than going through recordTurn/
 * translateGameEvent, which only ever see events produced inside a
 * processTurn call. Never called for a rejected/cancelled allocation
 * (events_and_messages requirements's "確認キャンセルや無効操作を記録
 * しない"), and always pushed with turnConsumed: false (this never
 * advances state.turn).
 */
export function recordAbilityAllocation(
  telemetry: RunTelemetry,
  state: GameState,
  ability: AbilityId,
  previousValue: number,
  newValue: number,
  remainingAbilityPoints: number,
): void {
  pushEvent(telemetry, state, false, {
    type: 'ability_point_spent',
    ability,
    previousValue,
    newValue,
    remainingAbilityPoints,
  });
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
    leg: state.leg,
    depth: state.floor,
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
  // Phase 15.1 core combat rebalance additions — see this file's
  // describeIncomingDamageReduction and the 'enemy_attack' TelemetryEvent
  // case's doc comment for what each derives from.
  defeated: number;
  rawDamage: number;
  armorReduction: number;
  flooredAtMinimumHits: number;
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
  progression: {
    enemiesDefeated: number;
    exitsReached: number;
    // Phase 13.1 experience/level/ability-point progression foundation.
    experienceGained: number;
    levelsGained: number;
    endingLevel: number;
    endingExperience: number;
    unspentAbilityPoints: number;
    // Phase 13.2 ability point allocation foundation.
    abilityPointsSpent: number;
    endingAbilityRanks: AbilityValues;
  };
  perFloor: PerFloorStats[];
  // Phase 15.2 recovery/satiety/status rebalance additions — see
  // computeRunSummary's aggregation loop and this file's history doc for
  // the full derivation of each field.
  recoveryAndSatiety: {
    satiety: { start: number; min: number; end: number; naturalLoss: number; foodRecovered: number };
    starvation: { turnsAtZero: number; damageEvents: number; totalDamage: number };
    naturalRegen: { occurrences: number; requestedTotal: number; actualTotal: number };
    poison: { tickEvents: number; totalDamage: number };
    apple: { usedCount: number; requestedTotal: number; actualTotal: number };
    banana: { usedCount: number; attacksWhileActive: number };
  };
  // Phase 15.3 SOL/element/ability rebalance additions — see
  // computeRunSummary's aggregation loop and this file's history doc for
  // the full derivation of each field. `resources.solGained`/
  // `solConsumed`/`solarChargeActions` (pre-existing) remain the single
  // source for those totals — sol.gained/consumed below simply mirror
  // them for convenience within this grouped object, never recomputed
  // from a second independent source.
  solAndElements: {
    sol: { start: number; gained: number; consumed: number; end: number };
    elementActivations: {
      byElement: Record<ElementId, { count: number; requestedTotal: number; actualTotal: number; mindBonusTotal: number }>;
      byAffinity: Record<ElementalAffinity, number>;
      insufficientSolCount: number;
    };
    abilities: {
      allocationsByAbility: Record<AbilityId, number>;
      mindBonusDamageTotal: number;
      powerBonusDamageTotal: number;
    };
  };
  finalState: {
    floor: number;
    position: { x: number; y: number };
    life: number;
    maxLife: number;
    sol: number;
    equipment: { weapon: WeaponId | null; armor: ArmorId | null };
    inventory: Record<string, number>;
  };
  // Phase 24.4e2 呪いtelemetry統合: see counter_semantics in
  // docs/history/phase-24-4e2-curse-telemetry.md for each field's exact
  // trigger condition. All derived from telemetry.events alone
  // (computeRunSummary's own single-source-of-truth pattern, unchanged
  // by this phase).
  curses: {
    generatedCount: number;
    generatedByRoute: { normal_floor: number; monster_house: number; enemy_drop: number; star_transform: number };
    inflictedCount: number;
    inflictedBySource: { mummy_hit: number; curse_trap: number };
    discoveredCount: number;
    acquiredCount: number;
    equippedCount: number;
    equippedWhileUnrevealedCount: number;
    lockRejectedCount: number;
    lockRejectedByOperation: {
      unequip: number;
      equip_swap: number;
      place: number;
      discard: number;
      solar_forge: number;
      star_transform: number;
    };
    uncursedCount: number;
    uncursedBySource: { temperance: number };
    discardedUnequippedCount: number;
    floorTransitionsWhileEquippedCount: number;
  };
}

function emptyCursesSummary(): RunSummary['curses'] {
  return {
    generatedCount: 0,
    generatedByRoute: { normal_floor: 0, monster_house: 0, enemy_drop: 0, star_transform: 0 },
    inflictedCount: 0,
    inflictedBySource: { mummy_hit: 0, curse_trap: 0 },
    discoveredCount: 0,
    acquiredCount: 0,
    equippedCount: 0,
    equippedWhileUnrevealedCount: 0,
    lockRejectedCount: 0,
    lockRejectedByOperation: { unequip: 0, equip_swap: 0, place: 0, discard: 0, solar_forge: 0, star_transform: 0 },
    uncursedCount: 0,
    uncursedBySource: { temperance: 0 },
    discardedUnequippedCount: 0,
    floorTransitionsWhileEquippedCount: 0,
  };
}

function emptyWeaponStats(): WeaponCombatStats {
  return { validAttacks: 0, invalidAttempts: 0, hits: 0, misses: 0, zeroDamageHits: 0, hitRate: null, damageDealt: 0, averageDamagePerHit: null, kills: 0 };
}

function emptyEnemyStats(): EnemyDamageStats {
  return { attackAttempts: 0, hits: 0, misses: 0, zeroDamageHits: 0, damage: 0, defeated: 0, rawDamage: 0, armorReduction: 0, flooredAtMinimumHits: 0 };
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
  let experienceGained = 0;
  let levelsGained = 0;
  let abilityPointsSpent = 0;
  const curses = emptyCursesSummary();

  // Phase 15.2 recovery/satiety/status rebalance accumulators.
  let satietyStart = 0;
  let satietyMin = 0;
  let satietyMinInitialized = false;
  let satietyNaturalLoss = 0;
  let foodRecovered = 0;
  let starvationTurnsAtZero = 0;
  let starvationDamageEvents = 0;
  let starvationTotalDamage = 0;
  let naturalRegenOccurrences = 0;
  let naturalRegenRequestedTotal = 0;
  let naturalRegenActualTotal = 0;
  let poisonTickEvents = 0;
  let poisonTotalDamage = 0;
  let appleUsedCount = 0;
  let appleRequestedTotal = 0;
  let appleActualTotal = 0;
  let bananaUsedCount = 0;
  let bananaAttacksWhileActive = 0;
  const trackSatietyValue = (value: number): void => {
    if (!satietyMinInitialized || value < satietyMin) {
      satietyMin = value;
      satietyMinInitialized = true;
    }
  };

  // Phase 15.3 SOL/element/ability rebalance accumulators.
  let solStart = 0;
  const byElement: Record<ElementId, { count: number; requestedTotal: number; actualTotal: number; mindBonusTotal: number }> = {
    sol: { count: 0, requestedTotal: 0, actualTotal: 0, mindBonusTotal: 0 },
    flame: { count: 0, requestedTotal: 0, actualTotal: 0, mindBonusTotal: 0 },
    frost: { count: 0, requestedTotal: 0, actualTotal: 0, mindBonusTotal: 0 },
    cloud: { count: 0, requestedTotal: 0, actualTotal: 0, mindBonusTotal: 0 },
    earth: { count: 0, requestedTotal: 0, actualTotal: 0, mindBonusTotal: 0 },
  };
  const byAffinity: Record<ElementalAffinity, number> = { weak: 0, neutral: 0, resist: 0 };
  let insufficientSolCount = 0;
  const allocationsByAbility: Record<AbilityId, number> = { body: 0, mind: 0, power: 0, speed: 0 };
  let mindBonusDamageTotal = 0;
  let powerBonusDamageTotal = 0;

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
        // Phase 15.2: every attack attempt (hit or miss) while attack_up
        // was active counts — see the attackUpActive doc comment above.
        if (event.attackUpActive) bananaAttacksWhileActive++;
        // Phase 15.3: power-ability contribution, only meaningful for a
        // hit (a miss deals no damage regardless of the bonus present).
        if (event.outcome !== 'miss') powerBonusDamageTotal += event.powerBonus;
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
        getEnemyStats(event.targetType).defeated++;
        break;
      }
      case 'player_damaged': {
        // Phase 12.3: poison is excluded from damageTakenByEnemy (it has
        // no attacking enemy — telemetry.forbidden's "仮の敵種を追加して
        // damageTakenByEnemyへ記録する"), but still counts toward the
        // overall and per-floor totals (telemetry.required's "総damageTaken
        // とフロア別damageTakenへactualDamageを加算する"). Phase 15.2
        // extends the same exclusion to 'starvation' for the identical
        // reason (also not an attacking enemy).
        if (event.source !== 'poison' && event.source !== 'starvation') {
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
          stats.rawDamage += event.rawAttackPower;
          stats.armorReduction += event.armorReduction;
          if (event.flooredAtMinimum) stats.flooredAtMinimumHits++;
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
        // Phase 15.2 recovery/satiety/status rebalance: natural regen and
        // apple-specific aggregates, read from the same events rather
        // than re-deriving REGEN_TURNS_PER_HP/REGEN_AMOUNT_PER_TICK or
        // ITEM_DEFINITIONS.apple.healAmount here.
        if (event.source === 'natural_regeneration') {
          naturalRegenOccurrences++;
          naturalRegenRequestedTotal += event.requestedAmount;
          naturalRegenActualTotal += event.actualHealing;
        } else if (event.source === 'item' && event.itemId === 'apple') {
          appleRequestedTotal += event.requestedAmount;
          appleActualTotal += event.actualHealing;
        }
        break;
      case 'item_used':
        itemsUsedByType[event.itemId] = (itemsUsedByType[event.itemId] ?? 0) + 1;
        // Phase 15.2: apple's usedCount and chocolate's satiety recovery
        // total are derived here from the same generic item_used events
        // that already feed itemsUsedByType above — never double-counted,
        // since each is its own separate accumulator read from the same
        // single event.
        if (event.itemId === 'apple') appleUsedCount++;
        if (event.itemId === 'banana') bananaUsedCount++;
        if (event.itemId === 'chocolate' && event.effect === 'satiety') foodRecovered += event.amount;
        break;
      case 'run_started':
        satietyStart = event.satiety;
        trackSatietyValue(event.satiety);
        solStart = event.sol;
        break;
      case 'satiety_decreased':
        satietyNaturalLoss += event.amount;
        trackSatietyValue(event.satietyAfter);
        break;
      case 'starvation_damage':
        starvationDamageEvents++;
        starvationTurnsAtZero++; // Phase 15.2: STARVATION_INTERVAL is 1, so every damage event is itself one full turn spent at satiety 0
        starvationTotalDamage += event.damage;
        break;
      case 'poison_damage':
        poisonTickEvents++;
        poisonTotalDamage += event.actualDamage;
        break;
      case 'element_activation': {
        const stats = byElement[event.element];
        stats.count++;
        stats.requestedTotal += event.requestedElementalDamage;
        stats.actualTotal += event.actualElementalDamage;
        stats.mindBonusTotal += event.mindBonusPortion;
        byAffinity[event.affinity]++;
        mindBonusDamageTotal += event.mindBonusPortion;
        break;
      }
      case 'element_activation_failed':
        insufficientSolCount++;
        break;
      case 'exit_reached':
        exitsReached++;
        break;
      case 'experience_gained':
        experienceGained += event.amount;
        break;
      case 'player_leveled_up':
        levelsGained++;
        break;
      case 'ability_point_spent':
        abilityPointsSpent++;
        allocationsByAbility[event.ability]++;
        break;
      // Phase 24.4e2 呪いtelemetry統合: see counter_semantics in
      // docs/history/phase-24-4e2-curse-telemetry.md for each case's
      // exact trigger condition — every one of these RunEventPayload
      // variants is only ever pushed at a genuine commit boundary (see
      // translateGameEvent/pushFloorGeneratedCurseEvents/
      // pushFloorTransitionCurseEvent above), so a straight per-event
      // increment here is correct with no additional dedup logic
      // needed.
      case 'equipment_curse_generated':
        curses.generatedCount++;
        curses.generatedByRoute[event.route]++;
        break;
      case 'equipment_cursed':
        curses.inflictedCount++;
        curses.inflictedBySource[event.source]++;
        break;
      case 'equipment_curse_discovered':
        curses.discoveredCount++;
        break;
      case 'cursed_equipment_acquired':
        curses.acquiredCount++;
        break;
      case 'cursed_equipment_equipped':
        curses.equippedCount++;
        if (!event.wasRevealed) curses.equippedWhileUnrevealedCount++;
        break;
      case 'curse_lock_rejected':
        curses.lockRejectedCount++;
        curses.lockRejectedByOperation[event.operation]++;
        break;
      case 'equipment_uncursed':
        curses.uncursedCount++;
        curses.uncursedBySource[event.source]++;
        break;
      case 'cursed_equipment_discarded':
        curses.discardedUnequippedCount++;
        break;
      case 'cursed_equipment_floor_transition':
        curses.floorTransitionsWhileEquippedCount++;
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
    progression: {
      enemiesDefeated: killedKeys.size,
      exitsReached,
      experienceGained,
      levelsGained,
      endingLevel: getLevel(finalState),
      endingExperience: getExperience(finalState),
      unspentAbilityPoints: getUnspentAbilityPoints(finalState),
      abilityPointsSpent,
      endingAbilityRanks: getAbilities(finalState),
    },
    perFloor: Array.from(perFloorMap.values()).sort((a, b) => a.floor - b.floor),
    recoveryAndSatiety: (() => {
      const satietyEnd = getHunger(finalState);
      trackSatietyValue(satietyEnd);
      return {
        satiety: { start: satietyStart, min: satietyMin, end: satietyEnd, naturalLoss: satietyNaturalLoss, foodRecovered },
        starvation: { turnsAtZero: starvationTurnsAtZero, damageEvents: starvationDamageEvents, totalDamage: starvationTotalDamage },
        naturalRegen: { occurrences: naturalRegenOccurrences, requestedTotal: naturalRegenRequestedTotal, actualTotal: naturalRegenActualTotal },
        poison: { tickEvents: poisonTickEvents, totalDamage: poisonTotalDamage },
        apple: { usedCount: appleUsedCount, requestedTotal: appleRequestedTotal, actualTotal: appleActualTotal },
        banana: { usedCount: bananaUsedCount, attacksWhileActive: bananaAttacksWhileActive },
      };
    })(),
    solAndElements: {
      sol: { start: solStart, gained: solGained, consumed: solConsumed, end: finalState.solarEnergy },
      elementActivations: { byElement, byAffinity, insufficientSolCount },
      abilities: { allocationsByAbility, mindBonusDamageTotal, powerBonusDamageTotal },
    },
    finalState: {
      floor: finalState.floor,
      position: { ...finalState.player.pos },
      life: finalState.player.hp,
      maxLife: finalState.player.maxHp,
      sol: finalState.solarEnergy,
      equipment: { weapon: finalState.equippedWeaponId, armor: finalState.equippedArmorId },
      inventory: { ...finalState.inventory },
    },
    curses,
  };
}

// ---------------------------------------------------------------------
// JSON export (json_export)
// ---------------------------------------------------------------------

/** Strips characters not safe in a filename, per filename_rules. */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Phase 24.6c1: schemaVersion 8 -> 9 (`leg`/`depth` common event fields), "v8" -> "v9" filenames, so old exports are never confused with the new ones. */
export function buildExportFilename(telemetry: RunTelemetry): string {
  const seedPart = sanitizeForFilename(String(telemetry.seed));
  const resultPart = telemetry.result === 'clear' ? 'clear' : 'death';
  return `rogue-of-sun-run-v9-${seedPart}-${resultPart}.json`;
}

export interface TelemetryDocument {
  schemaVersion: 9;
  /**
   * The most recently main-integrated, fully-completed development
   * Phase's identifier (maintenance-game-version-policy), independent of
   * `schemaVersion`: this identifies which *gameplay* milestone produced
   * the recorded events (game rules, balance, available mechanics),
   * while `schemaVersion` identifies the telemetry *payload*'s own
   * structural/interpretation compatibility. The two are updated on
   * unrelated triggers and must never be conflated — a Phase can change
   * gameplay without touching the payload shape (no schemaVersion bump),
   * and a payload-shape change can happen without any gameplay milestone
   * completing (no gameVersion bump). Rules for updating this field:
   *   - format is always 'phase-<integer>' (e.g. 'phase-18'); no
   *     sub-phase number (e.g. never 'phase-18.2') is included, since
   *     sub-phases within one Phase are implementation increments toward
   *     that Phase's single, eventually-integrated gameplay milestone
   *   - updated only when a complete Phase's production gameplay or
   *     telemetry-meaning changes have been merged to main via
   *     `--ff-only` — never for a mid-Phase feature branch, never for a
   *     docs/playtest-HTML/test-only change with no production gameplay
   *     effect
   *   - a Phase split across multiple sub-phase branches (e.g. Phase
   *     18.1/18.2/18.3) only advances this value once, at the point the
   *     *whole* Phase has been integrated to main — not at each
   *     sub-phase's own integration
   *   - this value is not, and must never become, a save/replay
   *     compatibility gate: this codebase has no save/load mechanism,
   *     and buildTelemetryDocument's output is a one-way, download-only
   *     JSON export (see main.ts's export button) that is never read
   *     back into GameState or RunTelemetry — so retroactively changing
   *     this policy or value can never break loading old data, because
   *     nothing in this codebase ever loads old telemetry data
   *
   * Historical note: this field was introduced at 'phase-10.3.1' and
   * bumped twice more (10.3.2, 10.3.3) during the Phase 10.3 telemetry
   * work itself, then bumped once to 'phase-12.3' and left there
   * unmaintained through every subsequent Phase (13 through 17) despite
   * many gameplay-affecting integrations — there was no enforced update
   * rule until this policy. 'phase-18' (Phase 18's trap discovery,
   * clairvoyance fruit, and minimap integration — see docs/history/
   * phase-18-1/2/3-*.md) is the first value assigned under this policy.
   */
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

/** Single source of truth for TelemetryDocument.gameVersion (maintenance-game-version-policy) — see that field's doc comment for the update rule. */
export const CURRENT_GAME_VERSION = 'phase-20';

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
    schemaVersion: 9,
    gameVersion: CURRENT_GAME_VERSION,
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
