import { directionBetweenAdjacent, isAdjacent, isOrthogonallyAdjacent } from './direction';
import { applyMonsterHouseReveal } from './monster-house';
import { canMove, destinationOf, isDiagonalCornerOpen, isInBounds, isWalkable } from './map';
import { ENEMY_DEFINITIONS } from './enemy-def';
import { ITEM_DEFINITIONS } from './item-def';
import { hasInventoryCapacity, inventoryEntries } from './inventory';
import {
  getHunger,
  getHungerDecreaseProgress,
  getStarvationProgress,
  HUNGER_DECREASE_AMOUNT,
  HUNGER_DECREASE_INTERVAL,
  HUNGER_LOW_THRESHOLD,
  HUNGER_MAX,
  STARVATION_DAMAGE,
  STARVATION_INTERVAL,
} from './hunger';
import { WEAPON_DEFINITIONS } from './weapon-def';
import { ARMOR_DEFINITIONS } from './armor-def';
import { computeAttackDamage, computeIncomingDamage, computeHitChance, resolvesAsHit, computeElementalDamage } from './combat';
import { advanceEffectDurations, EFFECT_DEFINITIONS, getActiveEffect, getEffectStrength, getPoisonTickProgress, grantOrRefreshEffect, isEffectAtMaxDuration, POISON_TICK_INTERVAL, removeEffect, removeStatusAilment, STATUS_AILMENT_IDS } from './effects';
import { rollPercent } from './rng';
import { canPlaceWebNow, expireWebs, placeWeb } from './web';
import { isSunlitAt } from './sunlight';
import { GameEvent } from './events';
import { applyExperienceGain, getLevel } from './progression';
import { roomIndexContaining } from './mapgen';
import { getPowerDamageBonus, getPlayerSpeed, getElementalMindBonus, getAbilities, BODY_MAX_HP_PER_RANK, MIND_MAX_SOL_PER_RANK } from './ability';
import { CARD_DEFINITIONS, CARD_IDS_IN_ORDER } from './card-def';
import {
  CARD_TARGET_EFFECT_RESOLVERS,
  getTransformCandidatesForItem,
  isCardTargetStillValid,
  resolveCardTargetEffect,
} from './card-target-selection';
import {
  createEquipmentInstance,
  ensureAvailableInstanceForEquip,
  EQUIPMENT_REFINE_LEVEL_CAP,
  findUnequippedInstanceId,
  getEquipmentInstanceById,
  getEquipmentInstances,
  isEquippedArmorCurseLocked,
  isEquippedWeaponCurseLocked,
  normalizeEquipmentInstances,
  removeUnequippedInstance,
} from './equipment-instance';
import {
  AbilityId,
  Actor,
  ALL_DIRECTIONS,
  CardId,
  Direction8,
  DIRECTION_VECTORS,
  ElementalAffinity,
  ElementId,
  EnchantmentId,
  EnemyActor,
  EnemyType,
  GameState,
  ItemId,
  PlayerAction,
  Vec2,
  WeaponId,
} from './types';

/**
 * Weapons any melee enchantment (sol or the four Phase 14.3 elements)
 * can apply to (Phase 10.1 confirmed design, generalized in Phase 14.3:
 * bare hands and the solar gun are explicitly excluded for every
 * element, not just sol). Checked in applyPlayerAttackToEnemy, the
 * single shared hit-resolution function used by every player-attack
 * site (adjacent melee, spear's reach-2 melee, and the solar gun's
 * ranged hit) — for the solar gun this list simply never matches, so no
 * separate exclusion check is needed there. Single source of truth: no
 * other per-element weapon list exists anywhere in this file.
 */
const ELEMENT_ENCHANT_ELIGIBLE_WEAPONS: WeaponId[] = ['sword', 'spear', 'hammer'];

/**
 * Phase 23.1: whether `enemy` counts as an obstacle for movement/
 * placement purposes (player stepping, enemy chase/retreat steps,
 * corner-cross checks, knockback/pull destinations). A head-form
 * skeleton (EnemyActor.skeletonForm === 'head') never blocks movement —
 * fixed_spec's "頭部は移動を阻害しない" — while remaining a fully valid
 * attack target elsewhere (every attack-target lookup in this file
 * still uses a plain `enemy.alive` check, deliberately not this
 * helper — see Stage 2's "通行・占有" split: 攻撃対象は頭部を含む,
 * 移動阻害は頭部を含まない). Every other species/form is unaffected
 * (identical to the old bare `enemy.alive` check).
 */
function isMovementBlockingEnemy(enemy: EnemyActor): boolean {
  return enemy.alive && !(enemy.type === 'skeleton' && enemy.skeletonForm === 'head');
}

/**
 * Phase 23.1: finds the living enemy at `pos` to actually attack,
 * preferring a body-form actor over a head-form skeleton when both
 * occupy the same tile (fixed_spec's "同じマスに通常状態の敵がいる場合、
 * 攻撃対象は通常敵を優先する") — a head never blocks movement, so this
 * is the only place two living enemies can legitimately share a tile.
 * Every ordinary case (at most one living enemy per tile) behaves
 * identically to a plain `enemies.find(enemy => enemy.alive && ...)`.
 */
function findAttackTarget(enemies: EnemyActor[], pos: Vec2): EnemyActor | undefined {
  const atPos = enemies.filter((enemy) => enemy.alive && enemy.pos.x === pos.x && enemy.pos.y === pos.y);
  if (atPos.length === 0) return undefined;
  return atPos.find((enemy) => !(enemy.type === 'skeleton' && enemy.skeletonForm === 'head')) ?? atPos[0];
}

/**
 * SOL consumed per successful enchanted hit, one entry per ElementId
 * (Phase 14.3 five-element combat effects). sol keeps its original
 * Phase 10.1 cost of 1; the other four elements cost 2 each -- a
 * provisional consumption-ratio value referencing the source material's
 * relative costs, per confirmed_combat_spec.sol_cost. Single source of
 * truth: no per-element cost is hardcoded anywhere else.
 */
export const ELEMENT_ENCHANTMENT_SOL_COST: Record<ElementId, number> = {
  sol: 1,
  flame: 2,
  frost: 2,
  cloud: 2,
  earth: 2,
};

/**
 * Maps each non-sol element's one-time-unlock ItemId to the ElementId it
 * unlocks (Phase 14.2 five-element acquisition). sol_enchantment is
 * deliberately excluded — it keeps its own dedicated branch above,
 * unchanged since Phase 10.1.
 */
const ELEMENT_ENCHANTMENT_ITEM_IDS: Record<string, ElementId> = {
  flame_enchantment: 'flame',
  frost_enchantment: 'frost',
  cloud_enchantment: 'cloud',
  earth_enchantment: 'earth',
};

/**
 * Fixed selection cycle order for the 'f' key (Phase 14.2
 * confirmed_game_spec.switching.sequence). 'none' is always a candidate;
 * every other entry is a candidate only while
 * GameState.unlockedEnchantments[entry] is true — see
 * getEnchantmentCycleCandidates below. This single array is the sole
 * place the order is defined; no other code repeats it.
 */
const ENCHANTMENT_CYCLE_ORDER: EnchantmentId[] = ['none', 'sol', 'flame', 'frost', 'cloud', 'earth'];

/**
 * The ordered list of enchantment selections currently reachable by the
 * 'f' key: 'none' plus every ElementId whose unlockedEnchantments entry
 * is true, in ENCHANTMENT_CYCLE_ORDER's fixed order. Always at least
 * length 1 (['none']) since 'none' is unconditional.
 */
function getEnchantmentCycleCandidates(state: GameState): EnchantmentId[] {
  return ENCHANTMENT_CYCLE_ORDER.filter(
    (id) => id === 'none' || state.unlockedEnchantments[id as ElementId],
  );
}

/**
 * Phase 23.1 solar gun element foundation: the ElementId the solar gun
 * actually fires with, derived from the exact same GameState.
 * selectedEnchantment/unlockedEnchantments fields melee enchantment
 * reads above — no separate lens inventory, unlock state, or GameState
 * field exists for the solar gun. `'none'` and `'sol'` both mean the
 * solar gun's standard Sol lens, which — unlike melee's sol enchant —
 * is always usable even before unlockedEnchantments.sol is ever set
 * (fixed_spec's "太陽銃の標準Solレンズは、近接用sol_enchantmentを未取得
 * でも使用可能"). A selected-but-locked element (an invalid fixture;
 * never producible through the normal cycle below) also falls back to
 * sol rather than ever returning an unusable element. Pure — reads
 * GameState but never mutates it.
 */
export function getSolarGunEffectiveElement(state: GameState): ElementId {
  const selected = state.selectedEnchantment;
  if (selected === 'none' || selected === 'sol') return 'sol';
  return state.unlockedEnchantments[selected] ? selected : 'sol';
}

/**
 * Phase 23.1: the solar gun's own lens-switching candidate list for the
 * 'toggle_enchantment' action while the solar gun is equipped — 'sol'
 * (the always-available standard lens; deliberately never 'none', so
 * the UI never shows both at once — fixed_spec's "'none'と'sol'を太陽
 * 銃UI上で重複表示しない") plus every unlocked non-sol element, in
 * ENCHANTMENT_CYCLE_ORDER's existing order. Distinct from
 * getEnchantmentCycleCandidates (melee's own list, which keeps 'none'
 * and only includes 'sol' once unlockedEnchantments.sol is true) —
 * sharing one function between the two weapon categories would either
 * duplicate 'none'/'sol' for the solar gun or hide 'none' from melee,
 * so each keeps its own candidate function reading the same underlying
 * state. A locked non-sol element is never included (fixed_spec's
 * "locked属性を候補に含めない").
 */
export function getSolarGunEnchantmentCandidates(state: GameState): EnchantmentId[] {
  const candidates: EnchantmentId[] = ['sol'];
  for (const id of ENCHANTMENT_CYCLE_ORDER) {
    if (id === 'none' || id === 'sol') continue;
    if (state.unlockedEnchantments[id as ElementId]) candidates.push(id);
  }
  return candidates;
}

/** Consumed player actions required for one natural HP tick (Phase 15.2 recovery/satiety/status rebalance: 5->10 — see docs/history/phase-15-2-recovery-satiety-status-rebalance.md). */
// Phase 16.2 natural-recovery/hunger/corridor-guidance tuning: 10->1
// (tester feedback: "HPの自然回復は1ターンに1回復でよい" — see
// docs/history/phase-16-early-game-balance.md's Phase 16.2 section).
// REGEN_AMOUNT_PER_TICK (1) is unchanged; this only shortens the wait
// between ticks, so every valid turn now heals exactly 1 HP while below
// max — regenProgress's >= comparison already handles a 1-turn interval
// correctly (increment to 1, 1 >= 1, heal, reset to 0) without any other
// change to the surrounding logic.
export const REGEN_TURNS_PER_HP = 1;
/** HP restored per natural regen tick (Phase 15.2: previously an inline literal 10, now a named single source of truth so telemetry.ts never duplicates it). */
export const REGEN_AMOUNT_PER_TICK = 1;

/**
 * The equipped weapon's attack bonus over bare hands (Phase 10.2 combat
 * stat/scale redesign — see weapon-def.ts's doc comment): 0 if unarmed or
 * if the equipped weapon has no bonus (spear, solar gun currently both
 * 0). Always added to, never a replacement for, player.attack — see
 * getEffectiveAttackPower and combat.ts's computeAttackDamage.
 */
/**
 * refineLevel's per-level flat bonus (Phase 20.5b contract correction:
 * rogue-of-sun-card-effects-spec.md's "武器の強化値は既存の与ダメージ計算、
 * 防具の強化値は既存の防御計算へ加算する" confirms this is an in-scope
 * connection this phase, not a Phase 24/27 deferral — only the final
 * numeric value is provisional). Applied identically to weapon attack
 * bonus and armor defense bonus below.
 */
export const EQUIPMENT_REFINE_LEVEL_DAMAGE_BONUS_PER_LEVEL = 1;

function getPlayerWeaponBonus(state: GameState): number {
  if (state.equippedWeaponId) {
    const base = WEAPON_DEFINITIONS[state.equippedWeaponId].attackPower;
    const instance = state.equippedWeaponInstanceId ? getEquipmentInstanceById(state, state.equippedWeaponInstanceId) : undefined;
    const refineBonus = (instance?.refineLevel ?? 0) * EQUIPMENT_REFINE_LEVEL_DAMAGE_BONUS_PER_LEVEL;
    return base + refineBonus;
  }
  return 0;
}

/**
 * The player's current attack_up bonus (Phase 12.1 temporary-effect
 * foundation), applied to physical damage from bare hands, sword, spear,
 * and hammer only — never the solar gun or the sol enchantment's bonus
 * damage (fixed_specification.attack_up_effect.excluded). `weaponId` is
 * the attacking weapon (or null for unarmed), passed in explicitly rather
 * than re-read from state so the caller's already-resolved weaponId
 * (captured before any mid-resolution state change) is always what gets
 * checked.
 */
function getPlayerAttackUpBonus(state: GameState, weaponId: WeaponId | null): number {
  if (weaponId === 'solar_gun') return 0;
  return getEffectStrength(state, 'attack_up');
}

/**
 * The equipped weapon's hit-chance modifier (Phase 10.3 accuracy/evasion
 * foundation): 0 if unarmed. See combat.ts's computeHitChance.
 */
function getPlayerWeaponHitModifier(state: GameState): number {
  if (state.equippedWeaponId) {
    return WEAPON_DEFINITIONS[state.equippedWeaponId].hitModifier;
  }
  return 0;
}

/**
 * The player's total attack power before any defense is subtracted
 * (Phase 10.2 combat stat/scale redesign): player.attack + the equipped
 * weapon's bonus (0 if unarmed). This is a display/inspection helper —
 * actual damage resolution goes through combat.ts's computeAttackDamage
 * directly (see applyPlayerAttackToEnemy), which performs the same
 * addition internally before subtracting the target's defense and
 * flooring at 1.
 */
export function getEffectiveAttackPower(state: GameState): number {
  return state.player.attack + getPlayerWeaponBonus(state);
}

/**
 * The player's current armor value (Phase 08.4 armor/defense foundation):
 * the equipped armor's armorValue if one is equipped, otherwise 0
 * (unarmored). Never added to any permanent player stat.
 */
export function getEffectiveArmorValue(state: GameState): number {
  if (state.equippedArmorId) {
    const base = ARMOR_DEFINITIONS[state.equippedArmorId].armorValue;
    const instance = state.equippedArmorInstanceId ? getEquipmentInstanceById(state, state.equippedArmorInstanceId) : undefined;
    const refineBonus = (instance?.refineLevel ?? 0) * EQUIPMENT_REFINE_LEVEL_DAMAGE_BONUS_PER_LEVEL;
    return base + refineBonus;
  }
  return 0;
}

/**
 * The player's total defense against incoming attacks (Phase 10.2 combat
 * stat/scale redesign): the player's own base `defense` stat (currently
 * always 0 — there is no permanent source of player defense yet besides
 * equipment) plus the equipped armor's value.
 */
export function getEffectivePlayerDefense(state: GameState): number {
  return state.player.defense + getEffectiveArmorValue(state);
}

/**
 * The final damage an incoming attack of `attackPower` deals to the
 * player, after total defense reduction (see getEffectivePlayerDefense):
 * `max(0, attackPower - defense)`. Per design (shonen-mystery-dungeon-
 * style, not a "minimum 1 damage" model — see combat.ts's module doc
 * comment for why this floor was deliberately kept at Phase 10.2), this
 * can reach exactly 0. Every site that applies enemy damage to the
 * player's HP must route through this (see tryMeleeAttack,
 * resolveSpiderEnemy, resolveKrakenEnemy) so defense is applied
 * uniformly.
 */
/**
 * Emperor's temporary mitigation rate (Phase 20.3 provisional value,
 * Phase 27 final tuning target): applied only here, inside
 * getIncomingDamage — the single funnel every enemy-direct-damage site
 * (melee, ranged, kraken tentacle) already routes through — so no
 * per-attack-site duplication is needed. Starvation/poison never call
 * getIncomingDamage (confirmed by this phase's audit — see turn.ts's own
 * doc comments on those call sites), so they are excluded automatically
 * by this same choke point, not by a separate exclusion list.
 */
export const EMPEROR_DAMAGE_REDUCTION = 0.5;

export function getIncomingDamage(state: GameState, attackPower: number): number {
  const raw = computeIncomingDamage(attackPower, getEffectivePlayerDefense(state));
  if (raw <= 0) return raw;
  if (getActiveEffect(state, 'emperor_shield')) {
    return Math.max(1, Math.ceil(raw * (1 - EMPEROR_DAMAGE_REDUCTION)));
  }
  return raw;
}

/**
 * Applies the player's current effective attack power to `target`,
 * pushes the resulting player_attack/enemy_defeated events, and returns
 * whether the enemy was defeated. Shared by every player-attack site
 * (adjacent melee and Phase 08.5's reach-2 spear attack) so defeat
 * handling — and any future on-hit logic — is never duplicated per
 * weapon. Never itself resolves enemy actions.
 */
/**
 * Resolves one confirmed attack attempt against `target` (a target tile
 * has already been found — never called on a whiff/out-of-range/
 * resource-blocked attempt, so this is always where the Phase 10.3 hit
 * roll belongs). Draws exactly one roll from state.combatRngState. On a
 * miss: pushes `player_attack_missed`, never touches target.hp/SOL/
 * defeat, and returns `{ hit: false, defeated: false }` — the caller
 * (resolveFacingAttack/resolveSolarGunAttack) must skip knockback for a
 * miss but still report the action as consumed/attacked (a miss is still
 * an attack attempt, not a whiff). On a hit, behaves exactly as
 * pre-10.3's damage/sol-enchantment/defeat resolution.
 */
/**
 * Shared enemy-defeat resolution (Phase 20.4 extraction): if `target.hp`
 * has just reached 0, marks it defeated, pushes `enemy_defeated`, and
 * awards experience (including any resulting level-ups) — the single
 * choke point every damage-dealing path (player melee/reach attacks, and
 * now justice/devil/tower's room-wide card damage) routes through, so an
 * enemy is never double-awarded and every path shares identical
 * defeat/experience/level-up handling. No key or item-drop system exists
 * in production yet (confirmed by this phase's audit) — nothing else to
 * connect here. A no-op if `target.hp > 0`.
 */
/**
 * Skeleton-only (Phase 23.1): world turns a head-form skeleton waits
 * before becoming eligible to revert to 'body' (subject also to its own
 * tile being unoccupied — see resolveSkeletonRevivals). Single source
 * of truth: no other literal duplicates this value.
 */
const SKELETON_HEAD_REVIVE_TURNS = 8;

function defeatEnemyIfNeeded(
  state: GameState,
  target: EnemyActor,
  targetId: number,
  events: GameEvent[],
  // Phase 23.1: the ElementId actually activated on the attack that
  // brought this target to 0 HP, or null for a plain unenchanted hit
  // (including every existing card-driven fixed-damage source, which
  // never activates an element and always passes null explicitly or by
  // omission). Every species except skeleton ignores this parameter
  // completely — the branch below is the only place it's read.
  attackElement: ElementId | null = null,
): boolean {
  if (target.hp > 0) return false;

  // Phase 23.1 skeleton body/head state machine — the single shared
  // choke point for every way a skeleton's HP can reach 0, whether via
  // a player melee/solar-gun hit (applyPlayerAttackToEnemy) or a fixed
  // card-room-damage source (justice/devil/tower), matching
  // fixed_spec's "カード等の既存無属性ダメージでLIFE0になった場合も頭
  // 部化する". No separate skeleton-specific branch exists anywhere
  // else in the codebase — every call site of this function already
  // routes through here regardless of damage source.
  if (target.type === 'skeleton') {
    const form = target.skeletonForm ?? 'body';
    if (form === 'head') {
      if (attackElement === null) {
        // Ineffective: form, revive timer, and HP all stay exactly as
        // they were; no experience, no defeat event.
        events.push({ type: 'skeleton_head_attack_no_effect', targetId });
        return false;
      }
      // Any activated element, regardless of which, fully defeats a
      // head — falls through to the ordinary defeat path below (no
      // separate branch needed; target.alive is still true here, hp is
      // already 0, so the code below applies unchanged).
    } else if (attackElement === null) {
      // Body form, no element activated: becomes a head instead of a
      // full defeat. Stays on the board (alive: true) at its own
      // position; no experience, no drop, no enemy_defeated event, no
      // RNG consumed.
      target.alive = true;
      target.skeletonForm = 'head';
      target.skeletonReviveAtTurn = state.turn + SKELETON_HEAD_REVIVE_TURNS;
      events.push({ type: 'skeleton_headified', targetId });
      return false;
    }
    // form === 'body' with attackElement !== null (any element) falls
    // through to the ordinary full-defeat path below, same as every
    // other species.
  }

  target.alive = false;
  events.push({ type: 'enemy_defeated', enemyType: target.type, targetId });

  const experienceReward = ENEMY_DEFINITIONS[target.type].experienceReward;
  const gainResult = applyExperienceGain(state, experienceReward);
  events.push({
    type: 'experience_gained',
    amount: experienceReward,
    enemyId: targetId,
    enemyType: target.type,
    level: gainResult.newLevel,
    experience: gainResult.remainingExperience,
  });
  for (const levelUp of gainResult.levelUps) {
    events.push({
      type: 'player_leveled_up',
      previousLevel: levelUp.level - 1,
      newLevel: levelUp.level,
      abilityPointsGained: levelUp.abilityPointsGained,
      unspentAbilityPoints: levelUp.unspentAbilityPointsAfter,
    });
  }
  return true;
}

function applyPlayerAttackToEnemy(state: GameState, target: EnemyActor, events: GameEvent[]): { hit: boolean; defeated: boolean } {
  const weaponId = state.equippedWeaponId;
  const targetId = target.id ?? 0;
  const hitChance = computeHitChance(state.player.accuracy, getPlayerWeaponHitModifier(state), target.evasion);
  const { roll, nextState } = rollPercent(state.combatRngState);
  state.combatRngState = nextState;

  if (!resolvesAsHit(roll, hitChance)) {
    events.push(
      weaponId
        ? { type: 'player_attack_missed', enemyType: target.type, targetId, weaponId, hitChance, roll }
        : { type: 'player_attack_missed', enemyType: target.type, targetId, hitChance, roll },
    );
    return { hit: false, defeated: false };
  }

  const baseDamage = computeAttackDamage(
    state.player.attack + getPlayerAttackUpBonus(state, weaponId) + getPowerDamageBonus(state),
    getPlayerWeaponBonus(state),
    target.defense,
  );
  let damage = baseDamage;

  // Melee enchantment activation (Phase 10.1 sol-only; Phase 14.3
  // generalizes this to all five elements through one shared check
  // instead of a per-element if-chain). Only for sword/spear/hammer
  // (ELEMENT_ENCHANT_ELIGIBLE_WEAPONS — never bare hands, never the
  // solar gun), only while some element is selected (not 'none') and
  // that element is unlocked, and only when there is at least that
  // element's ELEMENT_ENCHANTMENT_SOL_COST SOL available. A confirmed
  // hit (this function is only ever called once an enemy target has
  // already been found, and only reaches this point once the Phase 10.3
  // hit roll above has also succeeded) is required, so a miss never
  // consumes SOL. When SOL is insufficient, the selection is left
  // exactly as-is and the attack simply deals its normal (unbonused)
  // damage — no event, no log line, no animation trigger. sol's own
  // unlock state (unlockedEnchantments.sol) is kept in sync with the
  // pre-existing solUnlocked flag at the single site solUnlocked is ever
  // set (turn.ts's ground-item pickup handling), so reading
  // unlockedEnchantments here reproduces sol's exact pre-14.3 unlock
  // condition without a redundant solUnlocked check.
  const selectedEnchantment = state.selectedEnchantment;
  // Phase 23.1: the solar gun is never in ELEMENT_ENCHANT_ELIGIBLE_
  // WEAPONS, so weaponEligible (and therefore elementSelectedAndUnlocked/
  // insufficientSolElement/meleeActivatedElement below) is always false
  // for it, exactly as before this phase — this melee-only calculation
  // is completely untouched; the solar gun's own always-elemental
  // behavior is layered on separately right after it.
  const isSolarGun = weaponId === 'solar_gun';
  const weaponEligible = weaponId !== null && ELEMENT_ENCHANT_ELIGIBLE_WEAPONS.includes(weaponId);
  const elementSelectedAndUnlocked =
    weaponEligible && selectedEnchantment !== 'none' && state.unlockedEnchantments[selectedEnchantment];
  // Phase 15.3 SOL/element/ability rebalance: distinguishes "no element
  // selected/unlocked" (activatedElement stays null, nothing pushed,
  // unchanged from before) from "an eligible, selected, unlocked element
  // simply didn't have enough SOL this hit" — the latter now pushes its
  // own event (element_activation_failed, below) so the log and
  // telemetry can identify SOL-insufficiency specifically (step_3's
  // "SOL不足による属性不発をログとtelemetryで識別可能にする"), instead of
  // being indistinguishable from "not selected" as before.
  const insufficientSolElement: ElementId | null =
    elementSelectedAndUnlocked && state.solarEnergy < ELEMENT_ENCHANTMENT_SOL_COST[selectedEnchantment]
      ? selectedEnchantment
      : null;
  const meleeActivatedElement: ElementId | null =
    elementSelectedAndUnlocked && state.solarEnergy >= ELEMENT_ENCHANTMENT_SOL_COST[selectedEnchantment]
      ? selectedEnchantment
      : null;

  const solBefore = state.solarEnergy;
  let elementalDamage = 0;
  let affinity: ElementalAffinity = 'neutral';
  // Phase 23.1 solar gun element foundation: the solar gun always fires
  // through its own lens (getSolarGunEffectiveElement, defaulting to
  // sol) — never null, unlike melee's meleeActivatedElement. Its SOL
  // cost is the weapon's own solarCost, already fully spent by
  // resolveSolarGunAttack before this function ever runs; melee's
  // ELEMENT_ENCHANTMENT_SOL_COST is a completely separate, melee-only
  // charge that must never be deducted a second time here for the solar
  // gun (fixed_spec's "太陽銃へ3 SOL以外の追加属性コストを課さない").
  const activatedElement: ElementId | null = isSolarGun ? getSolarGunEffectiveElement(state) : meleeActivatedElement;
  if (activatedElement) {
    if (!isSolarGun) {
      state.solarEnergy -= ELEMENT_ENCHANTMENT_SOL_COST[activatedElement];
    }
    affinity = ENEMY_DEFINITIONS[target.type].elementalAffinities[activatedElement];
    // Phase 15.3: elemental damage is now a small fixed additive value
    // per affinity (combat.ts's ELEMENTAL_AFFINITY_BONUS_DAMAGE), plus
    // the mind-ability bonus (floor(mindRank/2)) added on top —
    // identically for every element including sol, and identically for
    // the solar gun and melee (fixed_spec's "affinityとmind bonusは近
    // 接属性攻撃と同じ計算を使う"). Never affected by enemy defense
    // (computeElementalDamage never reads it).
    elementalDamage = computeElementalDamage(affinity, getElementalMindBonus(state));
    damage += elementalDamage;
  }

  const targetHpBefore = target.hp;
  target.hp = Math.max(0, target.hp - damage);
  const targetHpAfter = target.hp;
  const defeated = target.hp === 0;
  events.push(
    state.equippedWeaponId
      ? {
          type: 'player_attack',
          enemyType: target.type,
          targetId,
          damage,
          targetHpBefore,
          targetHpAfter,
          weaponId: state.equippedWeaponId,
          element: activatedElement ?? undefined,
        }
      : { type: 'player_attack', enemyType: target.type, targetId, damage, targetHpBefore, targetHpAfter, element: activatedElement ?? undefined },
  );
  if (insufficientSolElement) {
    events.push({ type: 'element_activation_failed', element: insufficientSolElement, reason: 'insufficient_sol' });
  }
  if (isSolarGun) {
    // Phase 23.1: dedicated event, never reusing sol_enchantment_used/
    // element_enchantment_used (both imply an *additional* SOL cost
    // beyond the weapon's own — see this event's own doc comment in
    // events.ts). Fires on every solar-gun hit, whichever lens is
    // active — activatedElement is never null here.
    events.push({
      type: 'solar_gun_element_fired',
      element: activatedElement as ElementId,
      affinity,
      enemyType: target.type,
      targetId,
      physicalDamage: baseDamage,
      elementalDamage,
    });
  } else if (activatedElement === 'sol') {
    // sol keeps its own Phase 10.1 event name/payload/field-meanings
    // unchanged — see existing_sol_compatibility.
    events.push({
      type: 'sol_enchantment_used',
      weaponId: weaponId as WeaponId,
      enemyType: target.type,
      solBefore,
      solAfter: state.solarEnergy,
      baseDamage,
      bonusDamage: elementalDamage,
      element: 'sol',
      affinity,
    });
  } else if (activatedElement) {
    // flame/frost/cloud/earth share one event type (Phase 14.3) instead
    // of four separate ones.
    events.push({
      type: 'element_enchantment_used',
      element: activatedElement,
      affinity,
      weaponId: weaponId as WeaponId,
      enemyType: target.type,
      solBefore,
      solAfter: state.solarEnergy,
      physicalDamage: baseDamage,
      elementalDamage,
    });
  }
  if (defeated) {
    defeatEnemyIfNeeded(state, target, targetId, events, activatedElement);
  }
  return { hit: true, defeated };
}

export interface TurnResult {
  /** Whether the input actually consumed a turn (false for blocked moves). */
  consumed: boolean;
  /** Whether the player attacked this turn. */
  playerAttacked: boolean;
  /** Whether the player defeated any enemy this turn. */
  enemyDefeated: boolean;
  /** Whether at least one enemy acted this turn. */
  enemyActed: boolean;
  /** Whether at least one enemy attacked the player this turn. */
  enemyAttacked: boolean;
  /** Whether the player died this turn. */
  playerDefeated: boolean;
  /** Whether the player's natural HP regeneration triggered this turn. */
  playerRegenerated: boolean;
  /**
   * The exact HP amount natural regeneration added this turn (0 when
   * playerRegenerated is false). Phase 16.2: exposed separately from a
   * before/after whole-turn HP diff because REGEN_TURNS_PER_HP=1 means
   * regen now frequently coincides with the same turn as other healing
   * (an item use, etc.) — telemetry.ts's recordTurn previously inferred
   * this via `after.player.hp - before.playerHp`, which silently folded
   * any other same-turn healing into the natural-regen bucket too (see
   * docs/history/phase-16-early-game-balance.md's Phase 16.2 section).
   * This field is the regen tick's own isolated hp delta, captured at
   * the exact point it's applied below, so callers never need to infer
   * it from a coarser snapshot diff.
   */
  playerRegenAmount: number;
  /**
   * Phase 21.3: whether this turn's player move revealed a hidden monster
   * house (hidden -> revealed transition — see monster-house.ts's
   * applyMonsterHouseReveal). False for every non-move action, every
   * blocked/failed move, every move that doesn't cross into a hidden
   * monster house's room, and every floor without a monster house. This
   * is the minimal observable boundary later phases (21.6 logging/UI/
   * telemetry) can build on; nothing in this phase reacts to it.
   */
  monsterHouseRevealed: boolean;
  /**
   * Typed events produced while resolving this turn, in the exact order
   * the underlying actions occurred (player action first, then each
   * living enemy's action in state.enemies array order). Empty for
   * unconsumed/blocked inputs and for actions with nothing worth
   * announcing (e.g. a normal move or wait). See src/game/events.ts and
   * src/game/message-log.ts for the event shapes and their formatting.
   */
  events: GameEvent[];
}

function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { player, enemies, map } = state;

  // Petrified (phase-06-cockatrice-petrifying-gaze): takes priority over
  // everything else below, including the 'wait' fast path — any valid
  // input (move or wait) while petrified is entirely replaced by a forced
  // skip that still consumes the turn, then this clears. Only the very
  // next action is affected (not stacked/extended by repeat hits).
  //
  // Phase 12.4 exception: petrification_exception's "石化中でも
  // inventory overlayを開いて万能薬を使用できるようにする" / "石化中に
  // 許可する能動行動は万能薬使用だけとする". A 'use_item' action for
  // 'panacea' specifically is tried via the normal applyItemUse path
  // instead of the forced skip below. If it actually succeeds
  // (petrification is always one of panacea's cure targets whenever
  // player.petrified is true, so this only fails to succeed if the
  // player doesn't actually own a panacea), its result is returned as-is
  // — petrification_exception's "万能薬使用に成功したターンでは石化の
  // 強制スキップを重複して処理しない" is satisfied simply by returning
  // here instead of falling through to the forced-skip code. If the
  // attempt does NOT succeed (not owned), execution falls through to the
  // existing forced-skip behavior unchanged — petrification_exception's
  // "万能薬を所持していない場合は既存どおり石化ターンを処理する". Every
  // other action type (including antidote, other items, movement,
  // attacks, waiting) is unaffected and still forces the skip below,
  // per petrification_exception's "毒消し、通常アイテム、移動、攻撃、
  // 待機などは既存の石化規則に従う".
  if (player.petrified) {
    if (action.type === 'use_item' && action.itemId === 'panacea') {
      const panaceaResult = applyItemUse(state, action.itemId, events);
      if (panaceaResult.consumed) {
        return panaceaResult;
      }
    }
    player.petrified = false;
    events.push({ type: 'player_petrified_skip' });
    return { consumed: true, attacked: false, defeated: false };
  }

  // Inventory item use (Phase 08.2): resolved before the move/wait guard
  // below so it works whether or not the inventory overlay's own
  // move/wait rejection (see processTurn) is in effect. Never itself
  // re-implements enemy AI — a successful use returns consumed: true and
  // processTurn's normal post-player-action pipeline (enemy actions,
  // regen, floor check, turn increment) runs exactly as for any other
  // consumed action.
  if (action.type === 'use_item') {
    return applyItemUse(state, action.itemId, events);
  }

  // Phase 20.5a: temperance/star, whose target was already
  // selected/re-validated once by main.ts's UI-layer selection flow
  // (card-target-selection.ts). processTurn never trusts that prior
  // validation on faith — applyTargetedCardUse re-validates `target`
  // against the live state itself before applying anything.
  if (action.type === 'use_targeted_card') {
    return applyTargetedCardUse(state, action.cardId, action.target, events);
  }

  if (action.type === 'equip_weapon') {
    return applyWeaponEquip(state, action.weaponId, events);
  }

  if (action.type === 'equip_armor') {
    return applyArmorEquip(state, action.armorId, events);
  }

  // Phase 11.2: place selected item at the player's feet / discard it
  // entirely. Both are resolved the same way use_item/equip_* are —
  // before the move/wait guard below, exempted from the inventoryOpen
  // rejection in processTurn — so a success runs the normal post-action
  // pipeline (enemy actions, regen, floor check, turn increment).
  if (action.type === 'place_item') {
    return applyPlaceItem(state, action.itemId, events);
  }

  if (action.type === 'discard_item') {
    return applyDiscardItem(state, action.itemId, events);
  }

  // Enchantment toggle (Phase 10.1, 'f' key; Phase 14.2 extends the
  // cycle from none<->sol to none/sol/flame/frost/cloud/earth, skipping
  // any element whose unlockedEnchantments entry is false). A no-op (no
  // event, no state change) when only 'none' is reachable — i.e. no
  // element is unlocked at all — matching Phase 10.1's original
  // "切替入力を行ってもsolへ変更しない" guard, now generalized to every
  // element. UI-only, like 'face' below — never consumes a turn and
  // never triggers enemy actions.
  if (action.type === 'toggle_enchantment') {
    // Phase 23.1: the solar gun cycles through its own candidate list
    // (getSolarGunEnchantmentCandidates) while equipped, instead of
    // melee's none/sol/flame/frost/cloud/earth cycle — every other
    // equipped weapon (including bare hands) is completely unchanged
    // from before this phase.
    const isSolarGunEquipped = state.equippedWeaponId === 'solar_gun';
    const candidates = isSolarGunEquipped
      ? getSolarGunEnchantmentCandidates(state)
      : getEnchantmentCycleCandidates(state);
    if (candidates.length <= 1) {
      return { consumed: false, attacked: false, defeated: false };
    }
    const currentIndex = isSolarGunEquipped
      ? candidates.indexOf(getSolarGunEffectiveElement(state))
      : candidates.indexOf(state.selectedEnchantment);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % candidates.length;
    const nextSelection = candidates[nextIndex];
    if (isSolarGunEquipped && nextSelection === 'sol') {
      // Landing back on the solar gun's standard Sol lens: mirror
      // melee's own sol unlock state (fixed_spec's "近接Solが解放済み
      // ならselectedEnchantment='sol'／未解放なら'none'") so a later
      // melee-weapon switch reproduces melee's exact pre-14.3 sol
      // behavior instead of silently granting melee sol for free.
      state.selectedEnchantment = state.unlockedEnchantments.sol ? 'sol' : 'none';
    } else {
      state.selectedEnchantment = nextSelection;
    }
    events.push({ type: 'enchantment_toggled', selected: state.selectedEnchantment });
    return { consumed: false, attacked: false, defeated: false };
  }

  // Space (Phase 09.3b correction): a contextual input, not a single
  // action. On a sunlit tile with SOL below maxSolarEnergy, Space starts
  // a distinct solar-charge action (resolveSolarCharge) instead of a
  // plain wait — deliberately NOT the same action with a side effect
  // tacked on, so charge and wait can be told apart in events/logs/UI
  // and so hammerRecovery treats them differently (see
  // resolveSolarCharge's own doc comment). Every other case (shadow, or
  // sunlit but already at maxSolarEnergy) is a perfectly ordinary wait —
  // SOL never changes, and this is the only place plain 'wait' handling
  // lives.
  if (action.type === 'wait') {
    if (isSunlitAt(state.sunlight, state.player.pos) && state.solarEnergy < state.maxSolarEnergy) {
      return resolveSolarCharge(state, events);
    }
    state.hammerRecovery = false;
    return { consumed: true, attacked: false, defeated: false };
  }

  // Facing-only input (Phase 08.6, Shift+direction): updates player.facing
  // and nothing else — no movement, no turn consumed, no enemy action.
  if (action.type === 'face') {
    player.facing = action.direction;
    return { consumed: false, attacked: false, defeated: false };
  }

  // X action (Phase 08.6): resolves an attack in the player's *current*
  // facing direction — movement input no longer attacks at all (see
  // below). Reuses the exact same adjacent/reach-2/whiff resolution used
  // to be inlined in the move branch prior to this phase.
  if (action.type === 'action') {
    // Hammer recoil (Phase 08.7): while the hammer is equipped and
    // recovering, X only "re-cocks" it — no target resolution, no
    // damage, no knockback. Still a full, turn-consuming action, and the
    // caller's normal enemy-action pipeline still runs afterward.
    if (state.equippedWeaponId === 'hammer' && state.hammerRecovery) {
      state.hammerRecovery = false;
      events.push({ type: 'hammer_recover' });
      return { consumed: true, attacked: false, defeated: false };
    }

    const result = resolveFacingAttack(state, player.facing, events);

    // Recoil bookkeeping: every hammer attack via X (hit, kill,
    // failed-knockback, or whiff) enters recoil. Attacking with any other
    // weapon (or unarmed) clears it — recoil only has meaning while the
    // hammer is the equipped weapon. Equip-switching itself never touches
    // this flag (see applyWeaponEquip): re-equipping the hammer later
    // does not implicitly clear a recoil left over from before it was
    // switched away. Phase 09.2: this only runs when the action actually
    // consumed a turn — an insufficient-SOL solar gun attempt (consumed:
    // false) must leave hammerRecovery exactly as it was (fixed_spec's
    // "SOL不足による不発ではhammerRecoveryを解除しない"), whereas every
    // melee resolution (including a whiff) always consumes, so this is a
    // no-op change for sword/spear/hammer.
    if (result.consumed) {
      state.hammerRecovery = state.equippedWeaponId === 'hammer';
    }

    return result;
  }

  // From here on, action.type === 'move'. Per fixed_decisions.movement,
  // facing always updates to the input direction — even if the move
  // itself ends up failing for any reason (wall, enemy-occupied tile, map
  // edge, or being slowed) — so this happens unconditionally before any
  // of the failure paths below.
  player.facing = action.direction;

  // Slowed (enemy-behavior-02, spider web): any 'move' input fails
  // outright (no position change) while still consuming this world turn,
  // then clears the slow. Phase 08.6 removed the "moving into an enemy
  // attacks" path entirely, so this no longer needs to reason about
  // attack-vs-step — every move is just a step attempt now.
  if (player.slowed) {
    player.slowed = false;
    state.hammerRecovery = false;
    events.push({ type: 'slowed_move_cancelled' });
    return { consumed: true, attacked: false, defeated: false };
  }

  const destination: Vec2 = destinationOf(player.pos, action.direction);

  // Phase 08.6: movement input never attacks. Stepping toward a living
  // enemy's tile is simply a blocked move (no HP change, no turn
  // consumed) — the only way to attack is the 'action' (X) input above,
  // which reads the already-updated player.facing.
  const occupiedByEnemy = enemies.some((enemy) => isMovementBlockingEnemy(enemy) && enemy.pos.x === destination.x && enemy.pos.y === destination.y);
  if (occupiedByEnemy) {
    return { consumed: false, attacked: false, defeated: false };
  }

  // Otherwise, attempt a normal move.
  if (canMove(map, player.pos, action.direction)) {
    player.pos = destination;
    state.hammerRecovery = false;
    // Stepping onto a web tile slows the player (does not trigger merely
    // from a web being newly placed on the player's current tile, since
    // that never goes through this move branch). Not stacked/refreshed if
    // already slowed (can't happen here since a slowed player's move was
    // already intercepted above, but kept as a plain assignment — not an
    // increment — for clarity and safety either way).
    if (state.webs.some((web) => web.pos.x === destination.x && web.pos.y === destination.y)) {
      player.slowed = true;
      events.push({ type: 'player_webbed' });
    }
    // Traps (Phase 12.2 slow_trap, extended in Phase 12.3 with
    // poison_trap sharing this same array/branch): stepping onto an
    // untriggered trap tile fires it — hidden until this moment,
    // permanently revealed and inert afterward (one_shot). Each trap's
    // `trapType` selects which single effect it grants/refreshes
    // (slow_trap -> movement_slow, poison_trap -> poison) via the same
    // generic effects.ts helper banana uses; multiple untriggered traps
    // can share a tile in principle (placement never actually produces
    // this, but nothing here assumes at most one), so every untriggered
    // trap at this destination fires this same move, not just the first
    // found. processTurn detects which trap type(s) fired (by diffing
    // each trap's `triggered` flag before vs. after applyPlayerAction,
    // rather than adding a new return field) so it can skip that
    // specific effect's decrement and — for slow_trap only — the
    // additional enemy phase for this specific turn (fixed_
    // specification.effect.lifecycle's "罠発動ターン自体では敵の追加
    // 行動を発生させない" / "残り10を9へ減らさない"; Phase 12.3 confirms
    // this additional-enemy-phase suppression applies to slow_trap only,
    // never poison_trap).
    for (const trap of (state.traps ?? []).filter(
      (t) => !t.triggered && t.pos.x === destination.x && t.pos.y === destination.y,
    )) {
      // Phase 18.1/18.2: stepping onto a trap always reveals it first
      // (via the same revealTrap shared with applyClairvoyanceUse — a
      // no-op, no-event call when already revealed_untriggered, keeping
      // trap_revealed's "すでにrevealed=trueの罠について再記録しない"
      // rule intact) before marking it triggered, so the
      // revealed=true-implies-nothing-else / triggered=true-implies-
      // revealed=true invariant holds at every intermediate step.
      revealTrap(trap, events, 'step');
      trap.triggered = true;
      events.push({ type: 'trap_triggered', trapType: trap.trapType });
      const effectId = trap.trapType === 'slow_trap' ? 'movement_slow' : 'poison';
      const def = EFFECT_DEFINITIONS[effectId];
      const result = grantOrRefreshEffect(state, effectId);
      // Phase 15.2 recovery/satiety/status rebalance: a fresh grant or
      // refresh of poison always restarts its own 2/4/6/8/10-turn tick
      // schedule from this turn, matching the existing "refresh resets
      // strength/remainingTurns fully, never stacks" rule this phase
      // preserves — see effects.ts's getPoisonTickProgress doc comment.
      if (effectId === 'poison') {
        state.poisonTickProgress = 0;
      }
      events.push(
        result === 'granted'
          ? { type: 'effect_granted', effectId, strength: def.strength, remainingTurns: def.duration }
          : { type: 'effect_refreshed', effectId, strength: def.strength, remainingTurns: def.duration },
      );
    }
    // Auto-pickup (Phase 08.2): stepping onto a ground item tile collects
    // it as part of this same move — no extra turn, and enemies still act
    // this turn exactly as for any other normal move.
    const itemIndex = state.groundItems.findIndex(
      (item) => item.pos.x === destination.x && item.pos.y === destination.y,
    );
    if (itemIndex !== -1) {
      const item = state.groundItems[itemIndex];
      state.groundItems.splice(itemIndex, 1);
      // Sol enchantment (Phase 10.1): a one-time unlock, not a stacked
      // inventory item — see item-def.ts's doc comment. Sets solUnlocked
      // directly instead of going through inventory[itemId]++, and never
      // auto-selects it (selectedEnchantment stays whatever it already
      // was, per confirmed_design's "自動でONにはしない"). Idempotent
      // against a hypothetical duplicate (never happens in this phase,
      // only one is ever placed) so re-picking one up can't re-unlock or
      // push a duplicate acquisition event.
      if (item.itemId === 'sol_enchantment') {
        if (!state.solUnlocked) {
          state.solUnlocked = true;
          state.unlockedEnchantments.sol = true;
          events.push({ type: 'sol_enchantment_acquired' });
        }
      } else if (item.itemId in ELEMENT_ENCHANTMENT_ITEM_IDS) {
        // Flame/frost/cloud/earth enchantments (Phase 14.2): same
        // one-time-unlock, never-enters-inventory, never-auto-selects
        // pattern as sol_enchantment above, just for the other four
        // elements. Idempotent against a hypothetical duplicate for the
        // same reason sol_enchantment's branch is.
        const element = ELEMENT_ENCHANTMENT_ITEM_IDS[item.itemId as keyof typeof ELEMENT_ENCHANTMENT_ITEM_IDS];
        if (!state.unlockedEnchantments[element]) {
          state.unlockedEnchantments[element] = true;
          events.push({ type: 'element_enchantment_acquired', element });
        }
      } else if (hasInventoryCapacity(state)) {
        state.inventory[item.itemId] = (state.inventory[item.itemId] ?? 0) + 1;
        // Phase 20.0c: a floor-generated weapon/armor is already its own
        // EquipmentInstance by the time it's picked up (state.ts's
        // buildFloorState mints it, curse roll included, at floor-
        // generation time — see that loop's doc comment) — picking it up
        // never re-rolls or re-creates anything; it's the exact same
        // instance, still referenced by `item.equipmentInstanceId`.
        // Falling back to creating a fresh (never-cursed) instance only
        // covers a ground weapon/armor that somehow reached the floor
        // through a non-floor-generation path without one already set
        // (defensive; no such path exists in production this phase).
        if (item.itemId === 'sword' || item.itemId === 'spear' || item.itemId === 'hammer' || item.itemId === 'solar_gun' || item.itemId === 'armor') {
          if (!item.equipmentInstanceId || !getEquipmentInstanceById(state, item.equipmentInstanceId)) {
            createEquipmentInstance(state, item.itemId);
          }
        }
        // Phase 20.0b: a card is picked up without being identified by
        // that act alone (rogue-of-sun-card-effects-spec.md's "取得しただ
        // けでは鑑定しない") — the event carries whether this species is
        // still unidentified so message-log.ts's formatEvent can show the
        // unidentified placeholder name instead of the real one.
        const isCard = (CARD_IDS_IN_ORDER as readonly string[]).includes(item.itemId);
        const unidentifiedCard = isCard && !isCardIdentified(state, item.itemId as CardId);
        events.push({ type: 'item_picked_up', itemId: item.itemId, unidentifiedCard });
      } else {
        // Phase 11.1: inventory is at INVENTORY_CAPACITY. Put the ground
        // item back exactly as it was (id/type/position/state untouched)
        // instead of removing it, and notify via item_pickup_failed
        // instead of item_picked_up. No extra turn is consumed beyond the
        // normal move that already happened above, and no RNG is used.
        state.groundItems.splice(itemIndex, 0, item);
        events.push({ type: 'item_pickup_failed', itemId: item.itemId, reason: 'inventory_full' });
      }
    }
    return { consumed: true, attacked: false, defeated: false };
  }

  // Blocked movement (wall or out of bounds): does not consume a turn.
  return { consumed: false, attacked: false, defeated: false };
}

/**
 * Resolves an attack in `direction` from the player's current position
 * (Phase 08.6 X action): checks the adjacent tile first, then — only if
 * the equipped weapon's reach is 2 or more (currently just spear) and the
 * adjacent tile was empty — the tile 2 steps away, subject to the same
 * wall/diagonal-corner-cut legality check as normal movement for each of
 * the two segments independently. If nothing is found within reach, this
 * resolves as a whiff: still a full, turn-consuming action (per
 * fixed_decisions.action), just with no damage dealt. Never moves the
 * player and never changes player.facing (the X action always attacks in
 * whatever direction the player was already facing).
 */
function resolveFacingAttack(
  state: GameState,
  direction: Direction8,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { player, enemies, map } = state;

  // Solar gun (Phase 09.2): a ranged, SOL-consuming weapon entirely
  // distinct from the adjacent/reach-2 melee resolution below — routed
  // out first so melee logic never has to reason about ray distance or
  // solar cost.
  if (state.equippedWeaponId && WEAPON_DEFINITIONS[state.equippedWeaponId].solarCost) {
    return resolveSolarGunAttack(state, direction, events);
  }

  const destination: Vec2 = destinationOf(player.pos, direction);

  // Phase 15.6: a diagonal adjacent target behind a wall corner is not a
  // legal attack target — the same corner definition normal diagonal
  // movement already uses (isDiagonalCornerOpen, shared via map.ts).
  // Cardinal directions are always open by definition, so this only ever
  // changes the diagonal case.
  const target = isDiagonalCornerOpen(map, player.pos, destination)
    ? findAttackTarget(enemies, destination)
    : undefined;
  if (target) {
    const result = applyPlayerAttackToEnemy(state, target, events);
    if (result.hit && !result.defeated) {
      tryKnockback(state, target, direction, events);
    }
    return { consumed: true, attacked: true, defeated: result.defeated };
  }

  // Reach-2 attack (Phase 08.5 spear, carried over unchanged into the X
  // action): only when the adjacent tile is empty of a living enemy
  // (handled above) — adjacent targets always take priority, never both
  // an adjacent and a 2-tile attack in the same action.
  const reach = state.equippedWeaponId ? WEAPON_DEFINITIONS[state.equippedWeaponId].reach : 1;
  if (reach >= 2) {
    // Segment 1 (player -> intervening tile) must be a legal, non-corner
    // -cutting step; canMove already encodes wall/bounds + the existing
    // diagonal corner-cut rule.
    if (canMove(map, player.pos, direction)) {
      // Segment 2 (intervening tile -> far tile) re-applies the same
      // legality check independently.
      if (canMove(map, destination, direction)) {
        const farTile = destinationOf(destination, direction);
        const farTarget = findAttackTarget(enemies, farTile);
        if (farTarget) {
          const result = applyPlayerAttackToEnemy(state, farTarget, events);
          if (result.hit && !result.defeated) {
            tryKnockback(state, farTarget, direction, events);
          }
          return { consumed: true, attacked: true, defeated: result.defeated };
        }
      }
    }
  }

  // Whiff: nothing within reach in the facing direction. Still a full,
  // turn-consuming action — the caller's normal post-action pipeline
  // (enemy actions, regen, floor check, turn increment) still runs.
  events.push(
    state.equippedWeaponId
      ? { type: 'player_whiff', weaponId: state.equippedWeaponId }
      : { type: 'player_whiff' },
  );
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves the equipped weapon's knockback (Phase 08.7 hammer), if any,
 * against a surviving `target` that was just hit in `direction`. A no-op
 * for weapons with knockbackDistance 0 (sword, spear) and for immune
 * species (golem, kraken — checked explicitly here rather than by
 * changing their AI or normal movement capability). The destination tile
 * must be a legal single step from the target's current position — reusing
 * canMove applies the same wall/bounds/diagonal-corner-cut rule as normal
 * movement — and must not already be occupied by the player or another
 * living enemy; ground items and the exit tile never block it. Never
 * chains (only the directly-hit target can be pushed), never moves the
 * player, and never adds extra damage on knockback failure — a blocked
 * knockback simply leaves the target where it is, having already taken
 * the attack's normal damage.
 */
function tryKnockback(state: GameState, target: EnemyActor, direction: Direction8, events: GameEvent[]): void {
  const weaponDef = state.equippedWeaponId ? WEAPON_DEFINITIONS[state.equippedWeaponId] : null;
  if (!weaponDef || weaponDef.knockbackDistance <= 0) return;
  if (target.type === 'golem' || target.type === 'kraken') return; // immune: heavy/fixed-type

  const dest = destinationOf(target.pos, direction);
  if (!canMove(state.map, target.pos, direction)) return; // wall, bounds, or diagonal corner-cut

  const occupied =
    (state.player.pos.x === dest.x && state.player.pos.y === dest.y) ||
    state.enemies.some((e) => e !== target && isMovementBlockingEnemy(e) && e.pos.x === dest.x && e.pos.y === dest.y);
  if (occupied) return;

  target.pos = dest;
  events.push({ type: 'enemy_knocked_back', enemyType: target.type });
}

/**
 * Resolves an X-action attack with the solar gun equipped (Phase 09.2): a
 * ranged, SOL-consuming weapon entirely separate from the melee
 * adjacent/reach-2 path in resolveFacingAttack. Checks solarEnergy first
 * — if below the weapon's solarCost, nothing happens at all (no damage,
 * no ray, no turn consumed, no SOL change), matching the fixed_spec's
 * "SOLが不足している場合は攻撃、ダメージ、ターン消費、敵行動を発生させ
 * ない" / "SOL不足時に値を負数にしない" requirements. Otherwise consumes
 * solarCost SOL unconditionally (hit, whiff, or immediate wall) and walks
 * a ray via the existing castGazeRay (reused as-is: wall/bounds/diagonal
 * corner-cut aware, terrain-only blocking — ground items and the exit
 * never obstruct it), hitting only the first living enemy found, for
 * exactly 1 damage via the shared applyPlayerAttackToEnemy path (so
 * defeat handling/events match every other weapon). Never knocks back
 * (the solar gun's knockbackDistance is 0, so tryKnockback would be a
 * no-op anyway; not called here to keep this branch self-contained).
 * Always returns consumed: true when SOL was sufficient — even a whiff
 * or an immediately-blocked ray still spends the turn and the SOL, per
 * fixed_spec.solar_consumption.
 */
function resolveSolarGunAttack(
  state: GameState,
  direction: Direction8,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const weaponId = state.equippedWeaponId as import('./types').WeaponId;
  const weaponDef = WEAPON_DEFINITIONS[weaponId];
  const solarCost = weaponDef.solarCost ?? 0;

  if (state.solarEnergy < solarCost) {
    events.push({ type: 'solar_gun_insufficient_solar' });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.solarEnergy -= solarCost;

  const reached = castGazeRay(state.map, state.player.pos, direction, weaponDef.reach);
  // Walk the ray tiles in near-to-far order (castGazeRay's return order)
  // so the closest living enemy on the line is always hit first,
  // regardless of state.enemies' array order — a naive find-over-enemies
  // would not guarantee this.
  let target: EnemyActor | undefined;
  for (const tile of reached) {
    target = findAttackTarget(state.enemies, tile);
    if (target) break;
  }

  if (target) {
    const result = applyPlayerAttackToEnemy(state, target, events);
    return { consumed: true, attacked: true, defeated: result.defeated };
  }

  events.push({ type: 'player_whiff', weaponId });
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Sunlight-charge SOL recovery amount (Phase 15.3 SOL/element/ability
 * rebalance: previously an inline literal 1 — see docs/history/
 * phase-15-3-sol-element-ability-rebalance.md). Single source of truth
 * so telemetry.ts never duplicates it.
 */
export const SUNLIGHT_CHARGE_AMOUNT = 1;

/**
 * Resolves the solar-charge branch of a contextual Space input (Phase
 * 09.3b correction): only ever called when the caller has already
 * confirmed the player is on a sunlit tile with SOL below
 * maxSolarEnergy, so this never re-checks either condition or fails.
 * Recovers exactly SUNLIGHT_CHARGE_AMOUNT SOL, pushes the same
 * `solar_charge_used` event the UI's charge-motion trigger already
 * watches for, and consumes a turn (so the caller's normal enemy-
 * resolution/regen/floor-check pipeline runs once, same as any other
 * consumed action).
 *
 * Deliberately does NOT touch `hammerRecovery`, unlike plain 'wait'
 * (which always clears it). Investigated against the existing
 * hammerRecovery rules (turn.ts's applyPlayerAction / hammer_recover
 * comments): the documented clearing triggers are "successful move,
 * wait, X attack with a different weapon" — a deliberately enumerated
 * list of ordinary, weapon-neutral actions, not "any turn-consuming
 * action". Charge is a new, distinct action outside that list, and no
 * spec anywhere says charging while the hammer is recovering should
 * also finish re-cocking it "for free" alongside the SOL gain. Absent
 * that explicit basis, charge is treated as its own action that leaves
 * hammerRecovery exactly as it found it — the same treatment Phase
 * 09.3's original V-only charge action used, so this only restores that
 * behavior rather than inventing a new rule.
 */
function resolveSolarCharge(state: GameState, events: GameEvent[]): { consumed: boolean; attacked: boolean; defeated: boolean } {
  state.solarEnergy = Math.min(state.maxSolarEnergy, state.solarEnergy + SUNLIGHT_CHARGE_AMOUNT);
  events.push({ type: 'solar_charge_used', recovered: SUNLIGHT_CHARGE_AMOUNT });
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves a 'use_item' action (Phase 08.2). Only 'apple' is registered as
 * of this phase, so this only implements the healing-item path; a future
 * non-healing item would need its own branch here without touching this
 * one. Never moves the player, never itself resolves enemy actions —
 * successful uses return consumed: true and the caller (processTurn) runs
 * the normal enemy-resolution/regen/floor-check pipeline exactly as for
 * any other consumed action, so item use never reimplements enemy AI.
 */
function applyItemUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { player } = state;
  const def = ITEM_DEFINITIONS[itemId];
  const owned = state.inventory[itemId] ?? 0;

  // Guard against a stale/invalid selection (e.g. an item the player does
  // not actually have); the inventory UI only ever offers items with a
  // positive count, so this should not occur via normal play, but this
  // keeps the count invariant (never negative) even if reached directly.
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  // Phase 20.1/20.2/20.3 card core loop: any of the 17 CardIds routes to
  // applyCardUse instead of the antidote/banana/heal/solar branches below
  // (a card never has healAmount/solarAmount/hungerAmount set — see
  // item-def.ts's ITEM_DEFINITIONS card entries' doc comment). Checked
  // first, before every other itemId-specific branch, since none of
  // those apply to any card.
  if ((CARD_IDS_IN_ORDER as readonly string[]).includes(itemId)) {
    return applyCardUse(state, itemId as CardId, events);
  }

  // Antidote / panacea (Phase 12.4 status-ailment removal foundation):
  // each removes status ailments rather than restoring HP/SOL/hunger or
  // granting/refreshing an effect, so both are handled by their own
  // functions and neither has healAmount/solarAmount/hungerAmount set.
  // Checked before the banana/hungerAmount/healAmount/solarAmount
  // branches below for the same reason as banana's own check.
  if (itemId === 'antidote') {
    return applyAntidoteUse(state, itemId, events);
  }
  if (itemId === 'panacea') {
    return applyPanaceaUse(state, itemId, events);
  }

  // Clairvoyance fruit (Phase 18.2): reveals every currently-hidden trap
  // on this floor, handled by its own function since it reads/writes
  // GameState.traps rather than player.hp/solarEnergy/hunger/
  // activeEffects. Checked before the banana/hungerAmount/healAmount/
  // solarAmount branches below since clairvoyance_fruit has none of
  // those set (same precedent as banana/antidote/panacea above).
  if (itemId === 'clairvoyance_fruit') {
    return applyClairvoyanceUse(state, itemId, events);
  }

  // Banana (Phase 12.1 temporary-effect foundation): grants/refreshes
  // attack_up, handled by its own function since it reads/writes
  // effects.ts state rather than player.hp/solarEnergy/hunger. Checked
  // before the hungerAmount/healAmount/solarAmount branches below since
  // banana has none of those set.
  if (itemId === 'banana') {
    return applyBananaUse(state, itemId, events);
  }

  // Chocolate (Phase 11.3): restores hunger, handled by its own function
  // since it reads/writes hunger.ts state rather than player.hp/solarEnergy.
  if ((def.hungerAmount ?? 0) > 0) {
    return applyChocolateUse(state, itemId, events);
  }

  const healAmount = def.healAmount ?? 0;
  if (healAmount > 0) {
    if (player.hp >= player.maxHp) {
      events.push({ type: 'item_use_failed', itemId, reason: 'full_hp' });
      return { consumed: false, attacked: false, defeated: false };
    }
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    const healed = player.hp - before;
    state.inventory[itemId] = owned - 1;
    events.push({ type: 'item_used', itemId, healed });
    state.inventoryOpen = false;
    return { consumed: true, attacked: false, defeated: false };
  }

  // Sun fruit (Phase 09.1): restores solar energy, never HP. Rejected
  // (no consumption, no turn) when solar energy is already at maximum —
  // mirrors apple's full_hp rejection above but on the separate solar
  // energy stat.
  const solarAmount = def.solarAmount ?? 0;
  if (solarAmount > 0) {
    if (state.solarEnergy >= state.maxSolarEnergy) {
      events.push({ type: 'sun_fruit_use_failed', itemId, reason: 'sol_full' });
      return { consumed: false, attacked: false, defeated: false };
    }
    const before = state.solarEnergy;
    state.solarEnergy = Math.min(state.maxSolarEnergy, state.solarEnergy + solarAmount);
    const recovered = state.solarEnergy - before;
    state.inventory[itemId] = owned - 1;
    events.push({ type: 'sun_fruit_used', itemId, recovered });
    state.inventoryOpen = false;
    return { consumed: true, attacked: false, defeated: false };
  }

  // No other item effect is registered yet.
  return { consumed: false, attacked: false, defeated: false };
}

// ---------------------------------------------------------------------
// Phase 20.0b/20.1/20.2/20.3: card identification, sealed-state gating,
// and the 9 implemented cards' use transaction. See card-def.ts's
// CARD_DEFINITIONS for each card's metadata and
// rogue-of-sun-card-effects-spec.md for the authoritative per-card rules.
// ---------------------------------------------------------------------

/** Whether `cardId`'s species has been identified this run (see types.ts's GameState.identifiedCardIds doc comment). */
export function isCardIdentified(state: GameState, cardId: CardId): boolean {
  return (state.identifiedCardIds ?? []).includes(cardId);
}

/**
 * Marks `cardId`'s species identified if not already, pushing exactly one
 * 'card_identified' event the first time (never a duplicate for an
 * already-identified species — rogue-of-sun-card-effects-spec.md's "一度
 * 鑑定したCardIdは同一run中に未鑑定へ戻さない" / no re-identification
 * event either). Identification is per-species, never per-copy: this has
 * no notion of "which copy" — every copy of `cardId` currently or later
 * held is affected identically by one call.
 */
function markCardIdentified(state: GameState, cardId: CardId, events: GameEvent[]): void {
  const ids = state.identifiedCardIds ?? [];
  if (ids.includes(cardId)) return;
  state.identifiedCardIds = [...ids, cardId];
  events.push({ type: 'card_identified', cardId });
}

/**
 * Whether normal card use is currently locked out (Phase 20.0b "封印状
 * 態"), reusing the exact same activeEffects mechanism as attack_up/
 * movement_slow/poison via a dedicated 'sealed' EffectId (see effects.ts's
 * EFFECT_DEFINITIONS.sealed doc comment for why no grant source exists
 * yet this phase — only the check here is wired up).
 */
function isCardUseSealed(state: GameState): boolean {
  return getActiveEffect(state, 'sealed') !== undefined;
}

/**
 * Phase 20.3 common death-resolution function: the single place
 * judgement's interrupt is implemented, called from every lethal cause —
 * both the pre-existing end-of-turn confirmation (enemy attack, poison,
 * starvation — all of which only reach LIFE 0 later in processTurn) and,
 * as of this correction, immediately after a card's own lethal effect
 * (death/hanged_man), so a judgement-driven revival happens *before*
 * processTurn's normal post-action pipeline (resolveEnemiesAction/
 * hunger/poison) runs for this same turn — restoring the "revived
 * player still gets a normal enemy/environment phase this turn" behavior
 * rather than losing it to resolveEnemiesAction's already-dead-on-entry
 * guard. Idempotent and side-effect-free when the player is already
 * alive (a no-op call from the end-of-turn confirmation after an
 * already-resolved card death is safe and never double-consumes or
 * double-triggers). Never itself pushes 'player_defeated' or transitions
 * state.phase — those remain the caller's responsibility, since this
 * function may run mid-turn, well before the turn's natural end.
 */
function resolveDeathIfDefeated(state: GameState, events: GameEvent[]): void {
  if (state.player.alive) return;
  const judgementOwned = state.inventory.judgement ?? 0;
  if (judgementOwned > 0) {
    state.inventory.judgement = judgementOwned - 1;
    state.player.hp = state.player.maxHp;
    state.player.alive = true;
    markCardIdentified(state, 'judgement', events);
    events.push({ type: 'judgement_triggered' });
  }
}

/**
 * Finalizes a successful manual card use: consumes exactly one copy,
 * identifies the species (a no-op if already identified), and pushes
 * 'card_used'. Callers are responsible for having already applied the
 * card's own effect and confirmed success *before* calling this — this
 * function itself has no failure path, matching effects.ts's
 * grantOrRefreshEffect precedent (failure is always decided upstream of
 * the "commit" step). Never touches turn progression itself — like every
 * other apply*Use function, returning `consumed: true` lets processTurn's
 * normal pipeline advance the turn exactly once.
 */
function finishSuccessfulCardUse(state: GameState, cardId: CardId, events: GameEvent[]): void {
  const owned = state.inventory[cardId] ?? 0;
  state.inventory[cardId] = owned - 1;
  markCardIdentified(state, cardId, events);
  events.push({ type: 'card_used', cardId });
}

/**
 * Applies a flat ability-rank increase from a permanent-growth card
 * (high_priestess/empress/chariot/strength/wheel_of_fortune), reusing
 * exactly the same body/mind/speed side effects allocateAbilityPoint
 * applies for a point-allocated rank increase (ability.ts) — maxHp/
 * current-HP for body, maxSolarEnergy for mind, every enemy's
 * actionGauge reset for speed — except: consumes no unspentAbilityPoints,
 * enforces no ABILITY_RANK_CAP (no card in rogue-of-sun-card-effects-spec.md
 * describes a capped/failing permanent-growth use), and supports a
 * multi-point `amount` (wheel_of_fortune's +2) rather than always +1.
 * power has no side effect to mutate here: getPowerDamageBonus (ability.ts)
 * already derives its bonus fresh from the current power rank on every
 * read, so incrementing state.abilities.power alone is sufficient — same
 * reasoning as allocateAbilityPoint's own power branch (absent because
 * there is nothing to do there either).
 */
function applyCardAbilityIncrease(state: GameState, ability: AbilityId, amount: number): void {
  const abilities = getAbilities(state);
  abilities[ability] += amount;
  state.abilities = abilities;
  if (ability === 'body') {
    state.player.maxHp += BODY_MAX_HP_PER_RANK * amount;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + BODY_MAX_HP_PER_RANK * amount);
  } else if (ability === 'mind') {
    state.maxSolarEnergy += MIND_MAX_SOL_PER_RANK * amount;
  } else if (ability === 'speed') {
    for (const enemy of state.enemies) {
      enemy.actionGauge = 0;
    }
  }
}

/** high_priestess/empress/chariot/strength: always succeeds, +1 to the given ability. */
function applyAbilityGrowthCardUse(
  state: GameState,
  cardId: CardId,
  ability: AbilityId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  applyCardAbilityIncrease(state, ability, 1);
  finishSuccessfulCardUse(state, cardId, events);
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * emperor (Phase 20.3 provisional spec): grants/refreshes the
 * emperor_shield temporary effect (5 turns, EMPEROR_DAMAGE_REDUCTION
 * mitigation on enemy-direct damage — see getIncomingDamage). Always
 * succeeds, including on reuse while already active (refreshes back to
 * 5 remaining turns rather than stacking — grantOrRefreshEffect's
 * existing never-stack-strength contract). No RNG. Zero-effect-success:
 * a reuse that leaves remainingTurns unchanged (already at 5) still
 * consumes/identifies/advances the turn.
 */
/**
 * moon/sun (Phase 20.5b contract correction — rogue-of-sun-card-effects-spec.md
 * is authoritative here, superseding this function's earlier provisional
 * doc comment): raises the currently-equipped weapon (moon) or armor
 * (sun) instance's refineLevel by exactly 1. Fails outright (no consume/
 * identify/turn/RNG, and no `card_refine_applied` event) in two cases:
 * nothing of the relevant slot is currently equipped, or the equipped
 * instance is already at EQUIPMENT_REFINE_LEVEL_CAP — per the spec's
 * "強化上限に達した装備は対象にできない...使用不成立とする". This is
 * NOT a zero-effect-success case (unlike lovers/hanged_man's contract);
 * an at-cap equipped instance is a genuine rejection, identical in shape
 * to "no_valid_target". The target is always the equipped instance,
 * never chosen via card-target-selection.ts's UI flow (moon/sun
 * explicitly never use that module). The resulting refineLevel is
 * applied to actual attack/defense calculations via
 * getPlayerWeaponBonus/getEffectiveArmorValue (see
 * EQUIPMENT_REFINE_LEVEL_DAMAGE_BONUS_PER_LEVEL above) — the spec's
 * "武器の強化値は既存の与ダメージ計算、防具の強化値は既存の防御計算へ
 * 加算する" confirms this connection is in-scope this phase, not
 * deferred; only the per-level bonus's exact numeric value remains
 * Phase 27-provisional. No RNG.
 */
function applyMoonCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const instanceId = state.equippedWeaponInstanceId;
  if (!instanceId) {
    events.push({ type: 'card_use_failed', cardId, reason: 'no_valid_target' });
    return { consumed: false, attacked: false, defeated: false };
  }
  const instance = getEquipmentInstanceById(state, instanceId);
  if (!instance) {
    events.push({ type: 'card_use_failed', cardId, reason: 'no_valid_target' });
    return { consumed: false, attacked: false, defeated: false };
  }
  if (instance.refineLevel >= EQUIPMENT_REFINE_LEVEL_CAP) {
    events.push({ type: 'card_use_failed', cardId, reason: 'refine_cap_reached' });
    return { consumed: false, attacked: false, defeated: false };
  }
  const before = instance.refineLevel;
  instance.refineLevel = before + 1;
  finishSuccessfulCardUse(state, cardId, events);
  events.push({
    type: 'card_refine_applied',
    cardId,
    instanceId,
    refineLevelBefore: before,
    refineLevelAfter: instance.refineLevel,
  });
  return { consumed: true, attacked: false, defeated: false };
}

function applySunCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const instanceId = state.equippedArmorInstanceId;
  if (!instanceId) {
    events.push({ type: 'card_use_failed', cardId, reason: 'no_valid_target' });
    return { consumed: false, attacked: false, defeated: false };
  }
  const instance = getEquipmentInstanceById(state, instanceId);
  if (!instance) {
    events.push({ type: 'card_use_failed', cardId, reason: 'no_valid_target' });
    return { consumed: false, attacked: false, defeated: false };
  }
  if (instance.refineLevel >= EQUIPMENT_REFINE_LEVEL_CAP) {
    events.push({ type: 'card_use_failed', cardId, reason: 'refine_cap_reached' });
    return { consumed: false, attacked: false, defeated: false };
  }
  const before = instance.refineLevel;
  instance.refineLevel = before + 1;
  finishSuccessfulCardUse(state, cardId, events);
  events.push({
    type: 'card_refine_applied',
    cardId,
    instanceId,
    refineLevelBefore: before,
    refineLevelAfter: instance.refineLevel,
  });
  return { consumed: true, attacked: false, defeated: false };
}

function applyEmperorCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const result = grantOrRefreshEffect(state, 'emperor_shield');
  const def = EFFECT_DEFINITIONS.emperor_shield;
  finishSuccessfulCardUse(state, cardId, events);
  events.push(
    result === 'granted'
      ? { type: 'effect_granted', effectId: 'emperor_shield', strength: def.strength, remainingTurns: def.duration }
      : { type: 'effect_refreshed', effectId: 'emperor_shield', strength: def.strength, remainingTurns: def.duration },
  );
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * wheel_of_fortune: picks one of the 4 abilities with equal probability
 * via state.combatRngState (the game's shared seeded PRNG stream — see
 * types.ts's GameState.combatRngState doc comment), consuming exactly one
 * roll (rollPercent, 0..99), mapped to 4 equal 25-wide buckets in
 * ABILITY_IDS-matching order (body/mind/power/speed). Always succeeds;
 * the chosen ability is raised by 2 (not 1) via applyCardAbilityIncrease.
 */
function applyWheelOfFortuneUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const { roll, nextState } = rollPercent(state.combatRngState);
  state.combatRngState = nextState;
  const abilities: AbilityId[] = ['body', 'mind', 'power', 'speed'];
  const chosen = abilities[Math.min(3, Math.floor(roll / 25))];
  applyCardAbilityIncrease(state, chosen, 2);
  finishSuccessfulCardUse(state, cardId, events);
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * lovers (Phase 20.2 zero-effect-success contract): restores current SOL
 * to max. Always succeeds — even when SOL is already at max — per
 * rogue-of-sun-development-plan.md's common_item_use_contract
 * "使用処理そのものを完了できる場合は、実際の状態変化が0でも使用成立と
 * する". Consumes/identifies/advances the turn regardless; the actual
 * recovered amount (0 when already full) is reported via `lovers_used`
 * (same shape as sun_fruit_used) rather than rejecting the use.
 */
function applyLoversCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const recovered = state.maxSolarEnergy - state.solarEnergy;
  state.solarEnergy = state.maxSolarEnergy;
  finishSuccessfulCardUse(state, cardId, events);
  events.push({ type: 'lovers_used', recovered });
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * hanged_man: swaps current LIFE and SOL as integer values (never a
 * ratio), each clamped to the *other* stat's own max
 * (newLife = min(oldSol, maxHp), newSol = min(oldSol's counterpart...)) —
 * see rogue-of-sun-card-effects-spec.md's calculation. Fails (no
 * consumption, no identification, no turn, no RNG) when the computed
 * post-swap LIFE and SOL both equal their pre-swap values (a true no-op
 * swap). A post-swap LIFE of 0 is allowed through to the normal death
 * pipeline — this function itself never sets state.player.alive; the
 * existing per-turn playerDefeated confirmation (see the judgement
 * interrupt below) picks it up exactly like any other HP-reaching-0 cause.
 */
function applyHangedManCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  // Phase 20.2 zero-effect-success contract: always succeeds, even when
  // L and S are equal (a numerically no-op swap) — per
  // rogue-of-sun-development-plan.md's "LとSが同値で結果の状態変化が0
  // でも使用成立とする". Both newLife/newSol are computed simultaneously
  // from the pre-swap oldLife/oldSol (never chaining one result into the
  // other's calculation), matching the spec's integer-swap rule exactly.
  const oldLife = state.player.hp;
  const oldSol = state.solarEnergy;
  const newLife = Math.min(oldSol, state.player.maxHp);
  const newSol = Math.min(oldLife, state.maxSolarEnergy);
  state.player.hp = newLife;
  state.solarEnergy = newSol;
  finishSuccessfulCardUse(state, cardId, events);
  if (state.player.hp <= 0) {
    // Phase 20.2/20.3: unlike every existing damage source (enemy
    // attack, starvation, poison), no other code path syncs player.alive
    // to a card-driven direct HP write — this line is the single point
    // that does so for hanged_man. resolveDeathIfDefeated is called
    // immediately after (not deferred to the end-of-turn confirmation),
    // so a held judgement revives the player before processTurn's normal
    // post-action pipeline (resolveEnemiesAction/hunger/poison) runs for
    // this same turn — see that function's doc comment for why this
    // ordering matters (a revival discovered only at the end-of-turn
    // confirmation would have already lost this turn's enemy phase).
    state.player.alive = false;
    resolveDeathIfDefeated(state, events);
  }
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * death: always succeeds (never fails, even at full SOL — per
 * rogue-of-sun-card-effects-spec.md's "現在SOLが最大でも使用可能"). Order
 * (per spec's death.order): consume+identify first (finishSuccessfulCardUse),
 * then LIFE to 0, then SOL to max — never stopping LIFE at 1. This
 * function itself never sets state.player.alive or checks judgement; the
 * existing per-turn playerDefeated confirmation (see the judgement
 * interrupt below) handles both uniformly for every LIFE-reaching-0 cause,
 * death included — see that code's own doc comment for why no per-cause
 * duplication is needed.
 */
function applyDeathCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  finishSuccessfulCardUse(state, cardId, events);
  state.player.hp = 0;
  state.solarEnergy = state.maxSolarEnergy;
  // Phase 20.3: see hanged_man's identical doc comment above — death's
  // direct HP write needs the same explicit alive sync, since no other
  // code path performs it for a card-driven HP change. Calling
  // resolveDeathIfDefeated immediately after (rather than deferring to
  // the end-of-turn confirmation) is what lets a held judgement revive
  // the player in time for this same turn's normal enemy/environment
  // phase to still run — see that function's doc comment.
  state.player.alive = false;
  resolveDeathIfDefeated(state, events);
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * The list of currently-alive enemies in the same generated room as the
 * player (Phase 20.4 shared room-targeting), snapshotted once at call
 * time in `state.enemies`' own stable array order (never re-queried
 * mid-effect, so a mid-resolution defeat/drop never changes who else is
 * still a pending target). Empty when the player is on a corridor/
 * doorway tile (never falls back to "use to nearest enemy" or any other
 * substitute). Uses dungeon-generation room geometry, never the 9x7
 * camera viewport.
 */
function getSameRoomEnemies(state: GameState): EnemyActor[] {
  const roomIndex = roomIndexContaining(state.map.rooms, state.player.pos);
  if (roomIndex < 0) return [];
  return state.enemies.filter((e) => e.alive && roomIndexContaining(state.map.rooms, e.pos) === roomIndex);
}

/**
 * justice (Phase 20.4 provisional spec): deals `max(1, maxLife -
 * currentLife)` fixed (unmitigated, no hit roll) damage to every enemy
 * in the player's current room, computed once from the pre-effect LIFE
 * values (never per-enemy). Always succeeds — including with 0 targets
 * (corridor or an empty room) — per the zero-effect-success contract;
 * an empty target list still consumes/identifies/advances the turn. No
 * RNG. Defeated enemies route through the shared defeatEnemyIfNeeded
 * choke point (experience/level-ups), never a duplicated defeat path.
 */
function applyJusticeCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const damage = Math.max(1, state.player.maxHp - state.player.hp);
  const targets = getSameRoomEnemies(state);
  for (const target of targets) {
    const targetId = target.id ?? 0;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    events.push({ type: 'card_room_damage', cardId, enemyType: target.type, targetId, damage, targetHpBefore: before, targetHpAfter: target.hp });
    defeatEnemyIfNeeded(state, target, targetId, events);
  }
  finishSuccessfulCardUse(state, cardId, events);
  events.push({ type: 'card_room_effect_resolved', cardId, targetCount: targets.length });
  return { consumed: true, attacked: targets.length > 0, defeated: targets.some((t) => t.hp <= 0) };
}

/** devil's fixed SOL cost (Phase 20.4 provisional value, Phase 27 final tuning target). */
const DEVIL_SOL_COST = 3;
/** devil's fixed per-enemy damage (Phase 20.4 provisional value, Phase 27 final tuning target). */
const DEVIL_DAMAGE = 5;

/**
 * devil (Phase 20.4 provisional spec): costs DEVIL_SOL_COST SOL; fails
 * outright (no SOL/card/identify/turn/RNG change) if current SOL is
 * below that cost. Otherwise always succeeds — including with 0 targets
 * — dealing DEVIL_DAMAGE fixed (unmitigated) damage to every enemy in
 * the player's current room. No new disruption/status effect this phase
 * (per rogue-of-sun-card-effects-spec.md's provisional scope). No RNG.
 */
function applyDevilCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  if (state.solarEnergy < DEVIL_SOL_COST) {
    events.push({ type: 'card_use_failed', cardId, reason: 'insufficient_resource' });
    return { consumed: false, attacked: false, defeated: false };
  }
  state.solarEnergy -= DEVIL_SOL_COST;
  const targets = getSameRoomEnemies(state);
  for (const target of targets) {
    const targetId = target.id ?? 0;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - DEVIL_DAMAGE);
    events.push({ type: 'card_room_damage', cardId, enemyType: target.type, targetId, damage: DEVIL_DAMAGE, targetHpBefore: before, targetHpAfter: target.hp });
    defeatEnemyIfNeeded(state, target, targetId, events);
  }
  finishSuccessfulCardUse(state, cardId, events);
  events.push({ type: 'card_room_effect_resolved', cardId, targetCount: targets.length });
  return { consumed: true, attacked: targets.length > 0, defeated: targets.some((t) => t.hp <= 0) };
}

/** tower's damage-per-level multiplier (Phase 20.4 provisional value, Phase 27 final tuning target). */
const TOWER_DAMAGE_PER_LEVEL = 3;

/**
 * tower (Phase 20.4 provisional spec): deals `TOWER_DAMAGE_PER_LEVEL *
 * getLevel(state)` fixed (unmitigated — never reduced by emperor_shield,
 * since it is self-inflicted, not an enemy attack) damage to every enemy
 * in the player's current room *and to the player themselves*, computed
 * once and applied to a snapshot of targets taken before any damage is
 * applied (so a mid-resolution player death never skips remaining
 * enemies' damage). Outside a room, only the player is affected. Always
 * succeeds (the player is always a target). No RNG. After all damage is
 * applied, the player's own common death-confirmation path
 * (resolveDeathIfDefeated) runs exactly once, same as every other
 * card-driven HP-to-0 cause — never duplicated here.
 */
function applyTowerCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const damage = TOWER_DAMAGE_PER_LEVEL * getLevel(state);
  const enemyTargets = getSameRoomEnemies(state);
  finishSuccessfulCardUse(state, cardId, events);
  for (const target of enemyTargets) {
    const targetId = target.id ?? 0;
    const before = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    events.push({ type: 'card_room_damage', cardId, enemyType: target.type, targetId, damage, targetHpBefore: before, targetHpAfter: target.hp });
    defeatEnemyIfNeeded(state, target, targetId, events);
  }
  const playerHpBefore = state.player.hp;
  state.player.hp = Math.max(0, state.player.hp - damage);
  events.push({ type: 'card_self_damage', cardId, damage, hpBefore: playerHpBefore, hpAfter: state.player.hp });
  if (state.player.hp <= 0) {
    state.player.alive = false;
    resolveDeathIfDefeated(state, events);
  }
  events.push({ type: 'card_room_effect_resolved', cardId, targetCount: enemyTargets.length });
  return { consumed: true, attacked: true, defeated: enemyTargets.some((t) => t.hp <= 0) };
}

/**
 * temperance's registered CardTargetEffectResolver (Phase 20.5a):
 * clears `cursed` on the targeted equipment instance. Only ever called
 * by resolveCardTargetEffect against an isolated working-state clone —
 * never the live state directly. Fails if the target isn't (or is no
 * longer, on this working copy) an equipment_instance that is both
 * cursed and curseRevealed — the exact same eligibility
 * getTemperanceCandidates already enforces, re-checked here defensively
 * since a resolver must never assume its input is still valid.
 * curseRevealed is never reset to false: a solved curse's discovery
 * stays part of this run's history, per
 * rogue-of-sun-card-effects-spec.md's "curse-knownは判明済みの履歴とし
 * て維持し、未判明へ戻さない".
 */
function resolveTemperanceEffect(workingState: GameState, target: import('./card-target-selection').CardTargetRef): import('./card-target-selection').CardTargetEffectOutcome {
  if (target.kind !== 'equipment_instance') return { success: false };
  const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === target.instanceId);
  if (!instance || !instance.cursed || !instance.curseRevealed) return { success: false };
  instance.cursed = false;
  return { success: true };
}

/**
 * star's registered CardTargetEffectResolver (Phase 20.5a): transforms
 * the targeted item/equipment individual into a different ItemId of the
 * same category, drawn from getTransformCandidatesForItem's roster-wide
 * candidate list (never from what the player currently owns, and never
 * including any card). 0 candidates -> failure (no RNG consumed on this
 * working-state clone, so the caller's real combatRngState is
 * unaffected either since the whole clone is discarded on failure). 1
 * candidate -> deterministic, no RNG. 2+ candidates -> exactly one
 * rollPercent draw against workingState.combatRngState, canonical order
 * fixed by ITEM_IDS_IN_ORDER (via getTransformCandidatesForItem).
 *
 * inventory_item target: decrements the original stack by 1 (removing
 * the key entirely is unnecessary — Inventory tolerates 0 — matching
 * every other card's existing consume pattern) and increments the
 * transformed ItemId's stack by 1.
 *
 * equipment_instance target: the original instance is removed from
 * equipmentInstances outright (never reused — a fresh instance is
 * always minted via createEquipmentInstance, so refineLevel/cursed/
 * curseRevealed never carry over, per rogue-of-sun-card-effects-spec.md's
 * "refineLevelを引き継がず...curse状態を引き継がない"), inventory counts
 * for both the original and new ItemId are adjusted, and — if the
 * original was currently equipped — the new instance is auto-equipped
 * into the exact same slot, so no intermediate unequipped state is ever
 * observable outside this resolver.
 */
function resolveStarEffect(workingState: GameState, target: import('./card-target-selection').CardTargetRef): import('./card-target-selection').CardTargetEffectOutcome {
  let originalItemId: ItemId;
  if (target.kind === 'inventory_item') {
    originalItemId = target.itemId;
  } else {
    const instance = getEquipmentInstances(workingState).find((i) => i.instanceId === target.instanceId);
    if (!instance) return { success: false };
    originalItemId = instance.definitionId;
  }

  const candidates = getTransformCandidatesForItem(originalItemId);
  if (candidates.length === 0) return { success: false };

  let chosen: ItemId;
  if (candidates.length === 1) {
    chosen = candidates[0];
  } else {
    const { roll, nextState } = rollPercent(workingState.combatRngState);
    workingState.combatRngState = nextState;
    const index = Math.min(candidates.length - 1, Math.floor((roll / 100) * candidates.length));
    chosen = candidates[index];
  }

  if (target.kind === 'inventory_item') {
    const owned = workingState.inventory[originalItemId] ?? 0;
    workingState.inventory[originalItemId] = Math.max(0, owned - 1);
    workingState.inventory[chosen] = (workingState.inventory[chosen] ?? 0) + 1;
    return { success: true };
  }

  const instances = getEquipmentInstances(workingState);
  const index = instances.findIndex((i) => i.instanceId === target.instanceId);
  if (index < 0) return { success: false };
  const wasEquippedWeapon = workingState.equippedWeaponInstanceId === target.instanceId;
  const wasEquippedArmor = workingState.equippedArmorInstanceId === target.instanceId;
  instances.splice(index, 1);
  const ownedOriginal = workingState.inventory[originalItemId] ?? 0;
  workingState.inventory[originalItemId] = Math.max(0, ownedOriginal - 1);
  const newInstance = createEquipmentInstance(workingState, chosen as import('./types').WeaponId | import('./types').ArmorId);
  workingState.inventory[chosen] = (workingState.inventory[chosen] ?? 0) + 1;
  if (wasEquippedWeapon) {
    workingState.equippedWeaponId = chosen as import('./types').WeaponId;
    workingState.equippedWeaponInstanceId = newInstance.instanceId;
  }
  if (wasEquippedArmor) {
    workingState.equippedArmorId = chosen as import('./types').ArmorId;
    workingState.equippedArmorInstanceId = newInstance.instanceId;
  }
  return { success: true };
}

CARD_TARGET_EFFECT_RESOLVERS.temperance = resolveTemperanceEffect;
CARD_TARGET_EFFECT_RESOLVERS.star = resolveStarEffect;

/**
 * Resolves a 'use_targeted_card' action (Phase 20.5a: temperance/star).
 * Re-validates everything itself rather than trusting the caller's
 * prior selection: ownership, sealed state, and (via
 * resolveCardTargetEffect's isolation) the target's continued validity
 * and the effect's own success. Only a successful CardTargetEffectTransaction
 * gets committed onto the live `state` (via Object.assign of the
 * isolated working-state clone's fields — see resolveCardTargetEffect's
 * own doc comment for why that clone is always a complete, valid
 * GameState safe to assign wholesale) together with the same
 * finishSuccessfulCardUse commit every other card uses. A failure of any
 * kind — not owned, sealed, stale target, 0 transform candidates —
 * leaves `state` completely untouched.
 */
function applyTargetedCardUse(
  state: GameState,
  cardId: 'temperance' | 'star',
  target: import('./card-target-selection').CardTargetRef,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[cardId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }
  if (isCardUseSealed(state)) {
    events.push({ type: 'card_use_failed', cardId, reason: 'sealed' });
    return { consumed: false, attacked: false, defeated: false };
  }
  if (!isCardTargetStillValid(state, cardId, target)) {
    events.push({ type: 'card_use_failed', cardId, reason: 'no_valid_target' });
    return { consumed: false, attacked: false, defeated: false };
  }
  const transaction = resolveCardTargetEffect(state, cardId, target);
  if (transaction.status !== 'success') {
    events.push({ type: 'card_use_failed', cardId, reason: 'no_valid_target' });
    return { consumed: false, attacked: false, defeated: false };
  }
  Object.assign(state, transaction.nextState);
  finishSuccessfulCardUse(state, cardId, events);
  events.push({ type: 'card_target_effect_resolved', cardId, target });
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves a manual card use (Phase 20.1/20.2/20.3's 9 implemented
 * cards). Dispatches by cardId; the 8 defined-but-not-implemented cards
 * (emperor/justice/temperance/devil/tower/star/moon/sun) always fail here
 * regardless of how they reached inventory (e.g. a test fixture placing
 * one directly) — never treated as a successful use, per
 * rogue-of-sun-development-plan.md's prohibited "未実装カードを使用成功
 * 扱いにすること". judgement (useMode 'automatic') is defensively
 * rejected with no event, since it is never offered as a normal-use
 * candidate in the first place (its Inventory entry exists but
 * inventory.ts's selection routing still resolves it to a 'use_item'
 * PlayerAction like any other consumable — this is the actual point that
 * silently no-ops it, matching the existing owned<=0 guard's silent-reject
 * precedent above rather than adding a new UI-level carve-out).
 */
function applyCardUse(
  state: GameState,
  cardId: CardId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const def = CARD_DEFINITIONS[cardId];
  if (def.useMode !== 'manual') {
    return { consumed: false, attacked: false, defeated: false };
  }
  if (isCardUseSealed(state)) {
    events.push({ type: 'card_use_failed', cardId, reason: 'sealed' });
    return { consumed: false, attacked: false, defeated: false };
  }
  switch (cardId) {
    case 'high_priestess':
      return applyAbilityGrowthCardUse(state, cardId, 'mind', events);
    case 'empress':
      return applyAbilityGrowthCardUse(state, cardId, 'body', events);
    case 'chariot':
      return applyAbilityGrowthCardUse(state, cardId, 'speed', events);
    case 'strength':
      return applyAbilityGrowthCardUse(state, cardId, 'power', events);
    case 'emperor':
      return applyEmperorCardUse(state, cardId, events);
    case 'moon':
      return applyMoonCardUse(state, cardId, events);
    case 'sun':
      return applySunCardUse(state, cardId, events);
    case 'justice':
      return applyJusticeCardUse(state, cardId, events);
    case 'devil':
      return applyDevilCardUse(state, cardId, events);
    case 'tower':
      return applyTowerCardUse(state, cardId, events);
    case 'wheel_of_fortune':
      return applyWheelOfFortuneUse(state, cardId, events);
    case 'lovers':
      return applyLoversCardUse(state, cardId, events);
    case 'hanged_man':
      return applyHangedManCardUse(state, cardId, events);
    case 'death':
      return applyDeathCardUse(state, cardId, events);
    default:
      events.push({ type: 'card_use_failed', cardId, reason: 'not_implemented' });
      return { consumed: false, attacked: false, defeated: false };
  }
}

/**
 * Chocolate use (Phase 11.3 hunger foundation): restores hunger, never
 * HP/SOL. Split out from applyItemUse (unlike heal/solar branches which
 * stayed inline) so the hunger-specific getHunger/HUNGER_MAX helpers stay
 * localized to hunger.ts callers. Rejected (no consumption, no turn) when
 * hunger is already at HUNGER_MAX — mirrors apple's full_hp / sun_fruit's
 * sol_full rejection but on the hunger stat. Turn-order note (Phase 11.3
 * fixed_specification.chocolate.same_turn_order): this only applies the
 * recovery itself; the generic per-consumed-turn hunger decrease/
 * starvation step in processTurn runs afterward against the
 * already-recovered hunger value, which is what makes "using chocolate
 * from 0 hunger never starves on that same action" fall out naturally
 * without any special-casing here.
 */
function applyChocolateUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }
  const hungerAmount = ITEM_DEFINITIONS[itemId].hungerAmount ?? 0;
  const before = getHunger(state);
  if (before >= HUNGER_MAX) {
    events.push({ type: 'chocolate_use_failed', itemId, reason: 'hunger_full' });
    return { consumed: false, attacked: false, defeated: false };
  }
  state.hunger = Math.min(HUNGER_MAX, before + hungerAmount);
  const recovered = state.hunger - before;
  state.inventory[itemId] = owned - 1;
  events.push({ type: 'chocolate_used', itemId, recovered });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Banana use (Phase 12.1 temporary-effect foundation): grants or
 * refreshes the 'attack_up' status effect (see effects.ts), never
 * touching HP/SOL/hunger. Rejected (no consumption, no turn, no state
 * change at all) when attack_up is already at its maximum (full)
 * duration — fixed_specification.banana.use_failure: "attack_upの残り
 * ターンがすでに20の場合は使用失敗" / "失敗時は...乱数状態を変更しない".
 * On success, this only grants/refreshes the effect and decrements the
 * banana count; it deliberately does NOT advance any effect's remaining
 * duration itself (fixed_specification.banana.use_success's "バナナ使用
 * ターン自体ではattack_upの残りターンを減らさない") — that decrement is
 * processTurn's job, once per turn, and processTurn skips it entirely on
 * a turn where this function just granted/refreshed the effect (see
 * processTurn's isBananaGrant check).
 */
function applyBananaUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  if (isEffectAtMaxDuration(state, 'attack_up')) {
    events.push({ type: 'banana_use_failed', itemId, reason: 'effect_at_max' });
    return { consumed: false, attacked: false, defeated: false };
  }

  const result = grantOrRefreshEffect(state, 'attack_up');
  state.inventory[itemId] = owned - 1;
  const def = EFFECT_DEFINITIONS.attack_up;
  events.push(
    result === 'granted'
      ? { type: 'effect_granted', effectId: 'attack_up', strength: def.strength, remainingTurns: def.duration }
      : { type: 'effect_refreshed', effectId: 'attack_up', strength: def.strength, remainingTurns: def.duration },
  );
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Antidote use (Phase 12.4 status-ailment removal foundation): removes
 * only the 'poison' status ailment, immediately and completely, never
 * touching HP/SOL/hunger/attack_up/movement_slow/spider-web/
 * petrification. Rejected (no consumption, no turn, no state change at
 * all, inventory overlay stays open) when poison is not currently
 * active — items.antidote.failure's "アイテムを消費しない" / "ターンを
 * 消費しない" / "inventory overlayを閉じない". On success, this only
 * removes poison (via effects.ts's removeEffect — never touches
 * state.activeEffects directly) and decrements the antidote count; it
 * pushes 'antidote_used' (removedEffectIds always exactly ['poison'] on
 * success) and one 'effect_removed' (reason: 'antidote'). Deliberately
 * does NOT touch attack_up/movement_slow/spider-web/petrification, enemy
 * actions, hunger, or natural regen — those all remain processTurn's job
 * downstream, unchanged from any other successful item use. Poison
 * simply no longer exists in state.activeEffects by the time
 * processTurn's later applyPoisonTick call runs this same turn, which is
 * what naturally prevents a poison tick without needing any special-
 * cased skip flag.
 */
function applyAntidoteUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  if (!getActiveEffect(state, 'poison')) {
    events.push({ type: 'antidote_use_failed', itemId, reason: 'not_poisoned' });
    return { consumed: false, attacked: false, defeated: false };
  }

  removeEffect(state, 'poison');
  state.inventory[itemId] = owned - 1;
  events.push({ type: 'antidote_used', itemId, removedEffectIds: ['poison'] });
  events.push({ type: 'effect_removed', effectId: 'poison', reason: 'antidote' });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Panacea use (Phase 12.4 status-ailment removal foundation): removes
 * every currently-active status ailment among effects.ts's
 * STATUS_AILMENT_IDS (poison, movement_slow, spider_web, petrification)
 * in one use, never attack_up (a beneficial effect — excluded from
 * STATUS_AILMENT_IDS entirely, not by a name check here) and never HP/
 * SOL/hunger. Iterates STATUS_AILMENT_IDS through effects.ts's
 * removeStatusAilment (the single common removal entry point covering
 * both activeEffects-backed ids and the two special Actor-field
 * ailments), collecting exactly which ids were actually active and
 * removed. Rejected (no consumption, no turn, no state change,
 * inventory overlay stays open) when nothing was actually cured —
 * items.panacea.failure's requirements. On success, decrements the
 * panacea count by exactly 1 regardless of how many ailments were cured
 * (items.panacea.success_result's "解除した状態異常の種類数にかかわら
 * ず消費数は1個とする"), pushes 'panacea_used' (removedEffectIds listing
 * every id actually cured) once, then one 'effect_removed' per cured id
 * (never a single aggregate event). Curing 'petrification' here is what
 * satisfies petrification_exception's "石化による強制スキップを解除す
 * る" — the caller (applyPlayerAction's petrified-branch exception) never
 * needs to touch player.petrified itself; this function's call into
 * removeStatusAilment('petrification') already does that as part of the
 * uniform loop below, with no separate special-casing required.
 */
function applyPanaceaUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  const removed: import('./types').StatusAilmentId[] = [];
  for (const id of STATUS_AILMENT_IDS) {
    if (removeStatusAilment(state, id) === 'removed') {
      removed.push(id);
    }
  }

  if (removed.length === 0) {
    events.push({ type: 'panacea_use_failed', itemId, reason: 'no_status_ailment' });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.inventory[itemId] = owned - 1;
  events.push({ type: 'panacea_used', itemId, removedEffectIds: removed });
  for (const id of removed) {
    events.push({ type: 'effect_removed', effectId: id, reason: 'panacea' });
  }
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Clairvoyance fruit use (Phase 18.2): reveals every currently-hidden
 * trap on this floor at once (`revealed` false -> true for each; never
 * touches `triggered` — a trap this reveals stays in the
 * revealed_untriggered state per Phase 18.1's three-state model until a
 * later move actually steps onto it). Deliberately always succeeds (owned
 * <= 0 aside) regardless of how many traps exist or how many were newly
 * revealed — clairvoyance_fruit.consumption's "hidden罠が0件でも使用は
 *成立する" / "hidden罠が0件でもアイテムを消費する" / "hidden罠が0件でも
 * 1ターン消費する" — unlike antidote/panacea (which reject when nothing
 * would change), there is no failure branch here at all once ownership is
 * confirmed. Consumes exactly one clairvoyance_fruit and one turn either
 * way. `revealTrap` (below) is the single shared entry point for
 * revealing a trap, so this and the player-move discovery path in
 * applyPlayerAction's move branch share the exact same invariant-
 * preserving logic and the exact same 'trap_revealed' event shape,
 * differing only in `source`.
 */
function applyClairvoyanceUse(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  let revealedCount = 0;
  for (const trap of state.traps ?? []) {
    if (revealTrap(trap, events, 'clairvoyance')) revealedCount++;
  }

  state.inventory[itemId] = owned - 1;
  events.push({ type: 'clairvoyance_used', itemId, revealedCount });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Shared trap-discovery entry point (Phase 18.2), used by both the
 * player-move trigger branch (applyPlayerAction) and applyClairvoyanceUse
 * above, so the revealed=false-implies-nothing / triggered=true-implies-
 * revealed=true invariant (Phase 18.1) and the 'trap_revealed' event's
 * emission rule are defined in exactly one place. Sets `trap.revealed =
 * true` and pushes 'trap_revealed' only when the trap was actually hidden
 * (revealed was false) — a no-op, no-event call on an already-revealed
 * trap, matching trap_revealed.trap_revealed's "すでにrevealed=trueの罠
 * について再記録しない". Returns whether it actually revealed the trap
 * (used by applyClairvoyanceUse to count newly-discovered traps for its
 * message/telemetry). Never touches `triggered` — the caller (the move
 * branch's trigger loop) sets that separately, in the same order every
 * time: revealTrap first, then triggered = true, so revealed is always
 * true by the moment triggered becomes true.
 */
function revealTrap(
  trap: import('./types').TrapTile,
  events: GameEvent[],
  source: 'step' | 'clairvoyance',
): boolean {
  if (trap.revealed) return false;
  trap.revealed = true;
  events.push({ type: 'trap_revealed', trapType: trap.trapType, source });
  return true;
}

/**
 * Resolves an 'equip_weapon' action (Phase 08.3). Equipping never removes
 * the weapon from the inventory (not consumable, not stackable) and never
 * touches player.attack (the permanent unarmed stat) — see
 * getEffectiveAttackPower for how equippedWeaponId is applied during
 * combat. Already-equipped is a no-op (no turn, inventory stays open);
 * an unowned weapon cannot be equipped.
 */
function applyWeaponEquip(
  state: GameState,
  weaponId: import('./types').WeaponId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[weaponId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  if (state.equippedWeaponId === weaponId) {
    events.push({ type: 'weapon_already_equipped', weaponId });
    return { consumed: false, attacked: false, defeated: false };
  }

  // Phase 20.0c: a discovered-cursed currently-equipped weapon cannot be
  // swapped away via normal equip (rogue-of-sun-development-plan.md
  // 20.0c's "判明済みの呪い装備を通常操作では装備解除できない" — there is
  // no separate 'unequip' action in this game; equipping a different
  // weapon is the only way to change equippedWeaponId, so blocking the
  // swap here is the complete implementation of that rule). Rejected
  // before touching inventory/equipment state or consuming a turn.
  normalizeEquipmentInstances(state);
  if (isEquippedWeaponCurseLocked(state)) {
    events.push({ type: 'weapon_equip_blocked', weaponId, reason: 'cursed' });
    return { consumed: false, attacked: false, defeated: false };
  }

  const instance = ensureAvailableInstanceForEquip(state, weaponId, state.equippedWeaponInstanceId);
  state.equippedWeaponId = weaponId;
  state.equippedWeaponInstanceId = instance.instanceId;
  if (instance.cursed) {
    // Phase 20.0c: equipping a cursed instance is the discovery moment
    // (rogue-of-sun-development-plan.md 20.0c's "呪われた装備を装備した
    // 時点でcurseRevealed=trueになる") — cursed itself is never set here;
    // only whether it's already-cursed status becomes known.
    instance.curseRevealed = true;
  }
  events.push({ type: 'weapon_equipped', weaponId });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves an 'equip_armor' action (Phase 08.4). Equipping never removes
 * the armor from the inventory and never touches player.maxHp/hp, and is
 * fully independent of equippedWeaponId (equipping armor never changes
 * the equipped weapon and vice versa). Already-equipped is a no-op (no
 * turn, inventory stays open); unowned armor cannot be equipped.
 */
function applyArmorEquip(
  state: GameState,
  armorId: import('./types').ArmorId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[armorId] ?? 0;
  if (owned <= 0) {
    return { consumed: false, attacked: false, defeated: false };
  }

  if (state.equippedArmorId === armorId) {
    events.push({ type: 'armor_already_equipped', armorId });
    return { consumed: false, attacked: false, defeated: false };
  }

  // Phase 20.0c: see applyWeaponEquip's identical doc comment above.
  normalizeEquipmentInstances(state);
  if (isEquippedArmorCurseLocked(state)) {
    events.push({ type: 'armor_equip_blocked', armorId, reason: 'cursed' });
    return { consumed: false, attacked: false, defeated: false };
  }

  const instance = ensureAvailableInstanceForEquip(state, armorId, state.equippedArmorInstanceId);
  state.equippedArmorId = armorId;
  state.equippedArmorInstanceId = instance.instanceId;
  if (instance.cursed) {
    instance.curseRevealed = true;
  }
  events.push({ type: 'armor_equipped', armorId });
  state.inventoryOpen = false;
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Whether `itemId` is the player's last copy of a currently-equipped
 * weapon/armor (Phase 11.2 equipped_item_rule): owning exactly 1 and it
 * being the equipped weapon or armor blocks place/discard, but owning 2+
 * of an equipped weapon/armor (not reachable today since weapons/armor
 * are non-stackable, but kept generic per the confirmed rule) does not.
 */
function isLastEquippedCopy(state: GameState, itemId: import('./types').ItemId): boolean {
  const owned = state.inventory[itemId] ?? 0;
  if (owned !== 1) return false;
  return state.equippedWeaponId === itemId || state.equippedArmorId === itemId;
}

/**
 * Clamps state.selectedItemIndex into the valid range of the current
 * inventory entry list after a place/discard changes which items have a
 * positive count (Phase 11.2 menu_behavior: "最後の1個がなくなった場合
 * は、有効な近接項目へ選択を補正する"). A no-op when the current index is
 * already valid (e.g. the acted-on item still has count > 0, or an entry
 * further down the list took its place).
 */
function clampSelectedItemIndex(state: GameState): void {
  const entries = inventoryEntries(state);
  if (entries.length === 0) {
    state.selectedItemIndex = 0;
    return;
  }
  state.selectedItemIndex = Math.min(state.selectedItemIndex, entries.length - 1);
}

/**
 * Resolves a 'place_item' action (Phase 11.2): moves one copy of itemId
 * from the inventory onto the ground at the player's current position.
 * Blocked (no state change, no turn) when the item isn't owned, is the
 * last copy of a currently-equipped weapon/armor, or the player's current
 * tile already holds a ground item (GroundItem's one-per-tile
 * construction invariant — see types.ts's GameState.groundItems doc
 * comment). Never uses RNG; the new GroundItem's id comes from the
 * existing monotonically-increasing nextGroundItemId counter (same
 * pattern as web.ts's placeWeb).
 */
function applyPlaceItem(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    events.push({ type: 'item_place_failed', itemId, reason: 'item_unavailable' });
    return { consumed: false, attacked: false, defeated: false };
  }

  if (isLastEquippedCopy(state, itemId)) {
    events.push({ type: 'item_place_failed', itemId, reason: 'equipped' });
    return { consumed: false, attacked: false, defeated: false };
  }

  const occupied = state.groundItems.some(
    (item) => item.pos.x === state.player.pos.x && item.pos.y === state.player.pos.y,
  );
  if (occupied) {
    events.push({ type: 'item_place_failed', itemId, reason: 'ground_occupied' });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.inventory[itemId] = owned - 1;
  // Phase 20.0c: unlike discard, placing an item keeps its
  // EquipmentInstance tracked (never removes it from
  // state.equipmentInstances) — only its GroundItem gets tagged with the
  // same equipmentInstanceId — so re-picking it up later resolves back
  // to this exact individual instead of minting a fresh one
  // (rogue-of-sun-development-plan.md 20.0c's "placeした装備を床へ戻した
  // 場合も同一個体を維持する"). isLastEquippedCopy above already rejects
  // placing the equipped individual outright, so any id found here is
  // necessarily an unequipped one.
  let placedEquipmentInstanceId: string | undefined;
  if (itemId === 'sword' || itemId === 'spear' || itemId === 'hammer' || itemId === 'solar_gun') {
    placedEquipmentInstanceId = findUnequippedInstanceId(state, itemId, state.equippedWeaponInstanceId);
  } else if (itemId === 'armor') {
    placedEquipmentInstanceId = findUnequippedInstanceId(state, itemId, state.equippedArmorInstanceId);
  }
  state.groundItems.push({
    id: state.nextGroundItemId,
    itemId,
    pos: { ...state.player.pos },
    ...(placedEquipmentInstanceId ? { equipmentInstanceId: placedEquipmentInstanceId } : {}),
  });
  state.nextGroundItemId += 1;
  events.push({ type: 'item_placed', itemId });
  clampSelectedItemIndex(state);
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves a 'discard_item' action (Phase 11.2): removes one copy of
 * itemId from the inventory entirely (no GroundItem is created). The
 * confirmation step itself lives in the UI layer (src/main.ts) — by the
 * time this action reaches processTurn, the player has already confirmed,
 * so this only re-validates the same ownership/equipped guards
 * place_item uses (defense in depth against a stale selection). Never
 * uses RNG.
 */
function applyDiscardItem(
  state: GameState,
  itemId: import('./types').ItemId,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  const owned = state.inventory[itemId] ?? 0;
  if (owned <= 0) {
    events.push({ type: 'item_discard_failed', itemId, reason: 'item_unavailable' });
    return { consumed: false, attacked: false, defeated: false };
  }

  if (isLastEquippedCopy(state, itemId)) {
    events.push({ type: 'item_discard_failed', itemId, reason: 'equipped' });
    return { consumed: false, attacked: false, defeated: false };
  }

  state.inventory[itemId] = owned - 1;
  // Phase 20.0c: see applyPlaceItem's identical doc comment above.
  if (itemId === 'sword' || itemId === 'spear' || itemId === 'hammer' || itemId === 'solar_gun') {
    removeUnequippedInstance(state, itemId, state.equippedWeaponInstanceId);
  } else if (itemId === 'armor') {
    removeUnequippedInstance(state, itemId, state.equippedArmorInstanceId);
  }
  events.push({ type: 'item_discarded', itemId });
  clampSelectedItemIndex(state);
  return { consumed: true, attacked: false, defeated: false };
}

/**
 * Resolves an attack against the player if `enemy` is adjacent to them
 * (8-direction adjacency), updating facing and (on a hit) player
 * HP/alive. Returns whether an attack was attempted at all (true
 * whenever adjacent, hit or miss) — this only ever signals "this
 * enemy's turn is spent attacking", not hit success; see
 * resolveEnemyAttackHit for the Phase 10.3 hit roll itself. Shared by
 * every 8-direction melee behaviorType (generic_melee, slow_melee,
 * fast_melee, recovery_melee) so the attack resolution itself lives in
 * one place.
 */
function tryMeleeAttack(state: GameState, enemy: EnemyActor, events: GameEvent[]): boolean {
  const { player } = state;
  if (!isAdjacent(enemy.pos, player.pos)) return false;
  // Phase 15.6: symmetric with the player-side fix in resolveFacingAttack
  // — a diagonally adjacent player behind a wall corner is not a legal
  // attack target for the enemy either, using the exact same shared
  // corner definition (isDiagonalCornerOpen). Cardinal adjacency is
  // always open, so this only ever blocks the diagonal case. Every
  // tryMeleeAttack caller already falls through to its own tryChaseStep
  // (or waits, if no legal step exists) when this returns false, so no
  // enemy-behavior branch needs its own special case.
  if (!isDiagonalCornerOpen(state.map, enemy.pos, player.pos)) return false;
  const dir = directionBetweenAdjacent(enemy.pos, player.pos);
  if (dir) enemy.facing = dir;
  resolveEnemyAttackHit(state, enemy, events);
  return true;
}

/**
 * Resolves one confirmed enemy attack attempt against the player (Phase
 * 10.3 accuracy/evasion foundation): draws exactly one roll from
 * state.combatRngState. On a miss, pushes `enemy_attack_missed` and
 * never touches player.hp/alive. On a hit, applies the existing
 * defense-reduced damage (see getIncomingDamage) exactly as before
 * Phase 10.3. Shared by every enemy damage-dealing path (tryMeleeAttack,
 * resolveSpiderEnemy's own melee branch, resolveKrakenEnemy's tentacle
 * strike) so the roll/damage-application logic lives in one place, the
 * same way applyPlayerAttackToEnemy centralizes the player side.
 */
function resolveEnemyAttackHit(state: GameState, enemy: EnemyActor, events: GameEvent[]): boolean {
  const { player } = state;
  const attackerId = enemy.id ?? 0;
  const hitChance = computeHitChance(enemy.accuracy, 0, player.evasion);
  const { roll, nextState } = rollPercent(state.combatRngState);
  state.combatRngState = nextState;

  if (!resolvesAsHit(roll, hitChance)) {
    events.push({ type: 'enemy_attack_missed', enemyType: enemy.type, attackerId, hitChance, roll });
    return false;
  }

  const damage = getIncomingDamage(state, enemy.attack);
  player.hp = Math.max(0, player.hp - damage);
  events.push({ type: 'enemy_attack', enemyType: enemy.type, attackerId, damage });
  if (player.hp === 0) player.alive = false;
  return true;
}

/**
 * Attempts one 8-direction chase step toward the player for `enemy`,
 * against the current occupancy of the board (won't step onto the
 * player's tile or another living enemy's current tile; already-moved
 * enemies' updated positions count, dead enemies never block). Returns
 * whether a step was actually taken. Shared by every 8-direction melee
 * behaviorType.
 */
function tryChaseStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && isMovementBlockingEnemy(other) && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  const dx = Math.sign(player.pos.x - enemy.pos.x);
  const dy = Math.sign(player.pos.y - enemy.pos.y);
  const candidateDirs = pickChaseDirections(dx, dy);
  for (const dir of candidateDirs) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    enemy.facing = dir;
    enemy.pos = dest;
    return true;
  }
  return false;
}

/**
 * Resolves one bok's action (attack or chase-move-or-wait) against the
 * current occupancy of the board. Unchanged behavior from Phase 04:
 * 8-direction adjacency and chase, now expressed via the shared
 * tryMeleeAttack/tryChaseStep helpers above instead of inline logic.
 */
function resolveBokEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy); // moves if possible; no-op (wait in place) otherwise
  return { acted: true, attacked: false };
}

/**
 * Resolves one golem's action ('slow_melee'). Golem acts every other enemy
 * turn: its phase is `(state.turn - enemy.spawnTurn) % 2`, so the very
 * first enemy turn after it's created (phase 0) is always an acting turn,
 * and every other turn thereafter alternates. On an off turn it does
 * nothing at all — no movement, and critically no attack even if already
 * adjacent to the player. On an acting turn it behaves exactly like bok
 * (attack if adjacent, otherwise one chase step).
 */
function resolveGolemEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const phase = (state.turn - (enemy.spawnTurn ?? 0)) % 2;
  if (phase !== 0) {
    // Resting turn: deliberately does not attack even if adjacent.
    events.push({ type: 'enemy_recovering', enemyType: enemy.type });
    return { acted: false, attacked: false };
  }
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/**
 * Resolves one sword's action ('fast_melee'). If already adjacent to the
 * player at the start of its turn, it attacks immediately without moving.
 * Otherwise it attempts up to 2 chase steps in the same enemy turn,
 * re-evaluating the board after each step: if it becomes adjacent after
 * the first step, it attacks and stops (no second step); if it only
 * becomes adjacent after the second step, it does not attack that turn.
 * At most one attack per enemy turn either way.
 */
function resolveSwordEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }

  const movedFirstStep = tryChaseStep(state, enemy);
  if (!movedFirstStep) {
    return { acted: true, attacked: false }; // no legal step at all; wait in place
  }
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true }; // became adjacent after step 1: attack, no step 2
  }

  // Step 2; never attacks this turn even if now adjacent. Only when this
  // second step actually happens does the movement count as the sword's
  // signature 2-tile approach worth announcing; a single successful step
  // (or none at all) is a normal move and stays silent.
  const movedSecondStep = tryChaseStep(state, enemy);
  if (movedSecondStep) {
    events.push({ type: 'sword_dash', enemyType: enemy.type });
  }
  return { acted: true, attacked: false };
}

/**
 * Resolves one axe's action ('recovery_melee'). If `enemy.recovering` is
 * set (from having attacked on its previous turn), this turn is a forced
 * wait — no movement, no attack — and the flag is cleared so the turn
 * after that is normal again. Otherwise it behaves like bok (attack if
 * adjacent, otherwise one chase step), and an attack sets `recovering` for
 * next turn. Moving without attacking never triggers recovery.
 */
function resolveAxeEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.recovering) {
    enemy.recovering = false;
    events.push({ type: 'enemy_recovering', enemyType: enemy.type });
    return { acted: false, attacked: false };
  }
  if (tryMeleeAttack(state, enemy, events)) {
    enemy.recovering = true;
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

// Fixed cardinal check order used both for the spider's move candidates and
// as the deterministic tie-break order when multiple candidates yield the
// same resulting distance to the player. Matches the N/S/E/W ordering used
// throughout ALL_DIRECTIONS.
const SPIDER_DIRECTIONS: Direction8[] = ['N', 'S', 'E', 'W'];

// Fixed diagonal check order for corner-crossing A candidate evaluation and
// tie-breaking, matching the NE/NW/SE/SW ordering used in ALL_DIRECTIONS.
const CORNER_CROSS_DIRECTIONS: Direction8[] = ['NE', 'NW', 'SE', 'SW'];

const manhattanDistance = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * True if `enemy` may use corner-crossing A to step diagonally from
 * `enemy.pos` in `dir` right now: the diagonal destination is in-bounds
 * floor with no living actor on it, and — the defining condition — *both*
 * orthogonal tiles between the current position and the diagonal
 * destination are walls (not walkable). This is the exact opposite of
 * normal diagonal-move corner-cutting (map.ts's canMove requires both
 * sides walkable); corner-crossing A requires both sides to be solid.
 */
function canCornerCross(state: GameState, enemy: EnemyActor, dir: Direction8): boolean {
  const delta = DIRECTION_VECTORS[dir];
  const from = enemy.pos;
  const dest: Vec2 = { x: from.x + delta.x, y: from.y + delta.y };

  if (!isWalkable(state.map, dest)) return false;
  if (dest.x === state.player.pos.x && dest.y === state.player.pos.y) return false;
  const occupiedByEnemy = state.enemies.some(
    (other) => other !== enemy && isMovementBlockingEnemy(other) && other.pos.x === dest.x && other.pos.y === dest.y,
  );
  if (occupiedByEnemy) return false;

  const sideA: Vec2 = { x: from.x + delta.x, y: from.y };
  const sideB: Vec2 = { x: from.x, y: from.y + delta.y };
  // Both orthogonal sides must be solid (not walkable) — a wall corner.
  if (isWalkable(state.map, sideA) || isWalkable(state.map, sideB)) return false;

  return true;
}

/**
 * Attempts corner-crossing A for `enemy`: among the diagonal directions
 * where canCornerCross holds, picks the one whose destination minimizes
 * Manhattan distance to the player (ties broken by CORNER_CROSS_DIRECTIONS
 * order), but only actually moves if that destination is strictly closer
 * than the enemy's current position — a corner-cross that doesn't improve
 * distance to the player is never used (falls through to normal chase
 * instead). Returns whether it moved.
 */
function tryCornerCross(state: GameState, enemy: EnemyActor): boolean {
  const currentDist = manhattanDistance(enemy.pos, state.player.pos);
  let bestDir: Direction8 | null = null;
  let bestDist = Infinity;

  for (const dir of CORNER_CROSS_DIRECTIONS) {
    if (!canCornerCross(state, enemy, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    const dist = manhattanDistance(dest, state.player.pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }

  if (bestDir && bestDist < currentDist) {
    enemy.facing = bestDir;
    enemy.pos = destinationOf(enemy.pos, bestDir);
    return true;
  }
  return false;
}

/**
 * Spider's normal 4-direction-only chase step (unchanged from before
 * enemy-behavior-02): among legal cardinal move candidates, picks the one
 * minimizing Manhattan distance to the player after the move; ties are
 * broken by SPIDER_DIRECTIONS order (no RNG). Returns whether it moved.
 */
function trySpiderChaseStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && isMovementBlockingEnemy(other) && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  let bestDir: Direction8 | null = null;
  let bestDest: Vec2 | null = null;
  let bestDist = Infinity;

  for (const dir of SPIDER_DIRECTIONS) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    const dist = manhattanDistance(dest, player.pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
      bestDest = dest;
    }
  }

  if (bestDir && bestDest) {
    enemy.facing = bestDir;
    enemy.pos = bestDest;
    return true;
  }
  return false;
}

/** Decrements webCooldown by 1 if it's currently above 0; a no-op otherwise. Never used on the same turn a web was just placed (placeWeb sets a fresh value). */
function decrementWebCooldown(enemy: EnemyActor): void {
  const current = enemy.webCooldown ?? 0;
  if (current > 0) enemy.webCooldown = current - 1;
}

/**
 * Resolves one spider's action (enemy-behavior-02), in fixed priority
 * order:
 * 1. Orthogonal-adjacency melee attack (diagonal adjacency never attacks).
 * 2. Web placement, if this spider's webCooldown is 0 and
 *    canPlaceWebNow holds (in range/line-of-sight of the player's current
 *    tile, that tile isn't already webbed). Placing consumes the whole
 *    turn — no movement or attack alongside it.
 * 3. Corner-crossing A, if it yields a strictly closer diagonal step.
 * 4. Normal cardinal (4-direction) chase.
 * 5. Wait in place if none of the above apply.
 *
 * Every branch except an actual web placement decrements this spider's own
 * webCooldown by 1 (if above 0) at the end, so "the next 3 of this
 * spider's own turns" — regardless of what action they end up taking —
 * are what its cooldown counts down across; other enemies acting never
 * affects it.
 */
function resolveSpiderEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (isOrthogonallyAdjacent(enemy.pos, state.player.pos)) {
    const dir = directionBetweenAdjacent(enemy.pos, state.player.pos);
    if (dir) enemy.facing = dir;
    resolveEnemyAttackHit(state, enemy, events);
    decrementWebCooldown(enemy);
    return { acted: true, attacked: true };
  }

  const eligibleToPlaceWeb = (enemy.webCooldown ?? 0) <= 0;
  if (eligibleToPlaceWeb && canPlaceWebNow(state, enemy)) {
    placeWeb(state, enemy);
    events.push({ type: 'web_placed', enemyType: enemy.type });
    return { acted: true, attacked: false };
  }

  if (tryCornerCross(state, enemy)) {
    decrementWebCooldown(enemy);
    return { acted: true, attacked: false };
  }

  trySpiderChaseStep(state, enemy); // moves if possible; no-op (wait in place) otherwise
  decrementWebCooldown(enemy);
  return { acted: true, attacked: false };
}

/** Chebyshev (8-direction) distance, matching the 8-direction move grid used by chase/retreat. */
const chebyshevDistance = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Phase 16.1 early-resource-and-combat-pressure rebalance: the distance
 * (Chebyshev, matching the 8-direction chase grid) within which an enemy
 * "notices" the player and starts chasing/attacking. Chosen to comfortably
 * cover same-room engagement at Phase 16's enlarged room interiors (width
 * 6-11, height 5-9 — the longest single straight line inside even the
 * biggest room is well under this) while still meaningfully limiting how
 * many far-flung enemies across a 48x36 floor can converge on the player
 * at once. This is a plain numeric distance check, not a line-of-sight or
 * field-of-view system — deliberately out of scope for this phase; an
 * enemy within range still "notices" the player through walls exactly as
 * every enemy always has, and still has to path around walls once it
 * starts chasing (canMove/tryChaseStep are unchanged).
 */
const AGGRO_RANGE = 8;

/** Whether `player` is within `enemy`'s aggro range (see AGGRO_RANGE) — always true once already adjacent (checked separately by callers), so this only needs to cover the "not yet adjacent" case. */
function isWithinAggroRange(enemy: EnemyActor, player: Actor): boolean {
  return chebyshevDistance(enemy.pos, player.pos) <= AGGRO_RANGE;
}

/**
 * Attempts one bat retreat step (enemy-behavior-06) for `enemy`: among the
 * 8 adjacent tiles (fixed ALL_DIRECTIONS order, matching every other
 * deterministic direction scan in this file), a candidate must be a legal
 * step per canMove (in bounds, walkable, no diagonal corner-cutting), free
 * of the player and every other living enemy's current position, and
 * strictly farther from the player (Chebyshev) than the bat's current
 * position. Among candidates, picks the one with the greatest resulting
 * distance, ties broken by ALL_DIRECTIONS order. Returns whether it moved.
 */
function tryBatRetreatStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && isMovementBlockingEnemy(other) && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  const currentDist = chebyshevDistance(enemy.pos, player.pos);
  let bestDir: Direction8 | null = null;
  let bestDest: Vec2 | null = null;
  let bestDist = -Infinity;

  for (const dir of ALL_DIRECTIONS) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    const dist = chebyshevDistance(dest, player.pos);
    if (dist <= currentDist) continue;
    if (dist > bestDist) {
      bestDist = dist;
      bestDir = dir;
      bestDest = dest;
    }
  }

  if (bestDir && bestDest) {
    enemy.facing = bestDir;
    enemy.pos = bestDest;
    return true;
  }
  return false;
}

/**
 * Resolves one bat's action ('bat_retreat', enemy-behavior-06). If this bat
 * is currently retreat-pending (set after its previous successful attack),
 * it tries tryBatRetreatStep instead of acting normally: on success it
 * consumes its whole turn (no attack/chase alongside the step) and emits
 * bat_retreat; on failure (no tile increases distance) it clears the
 * pending flag and falls through to normal bok-style behavior this same
 * turn, per spec, without emitting bat_retreat. Otherwise (not
 * retreat-pending) it behaves exactly like bok: attack if adjacent
 * (which sets retreat-pending for its next turn), else one chase step.
 */
function resolveBatEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.retreating) {
    enemy.retreating = false;
    if (tryBatRetreatStep(state, enemy)) {
      events.push({ type: 'bat_retreat', actorId: enemy.id ?? 0, enemyType: enemy.type });
      return { acted: true, attacked: false };
    }
    // No valid retreat tile: fall back to normal behavior this same turn.
  }

  if (tryMeleeAttack(state, enemy, events)) {
    enemy.retreating = true;
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/**
 * Resolves one mummy's action ('mummy_shamble', phase-06-mummy-shambling-movement).
 * If this mummy is currently rest-pending (set after its previous
 * successful chase step), it rests: no movement, no attack, even if
 * adjacent to the player, consuming its whole turn and emitting
 * mummy_shamble_rest; the pending flag is cleared and normal behavior
 * resumes on its next turn (no same-turn fallback, unlike the bat).
 * Otherwise it behaves exactly like bok: attack if adjacent (never sets
 * rest-pending), else one chase step (sets rest-pending only if the step
 * actually moved it).
 */
function resolveMummyEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.restingAfterMove) {
    enemy.restingAfterMove = false;
    events.push({ type: 'mummy_shamble_rest', actorId: enemy.id ?? 0, enemyType: enemy.type });
    return { acted: true, attacked: false };
  }

  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  if (tryChaseStep(state, enemy)) {
    enemy.restingAfterMove = true;
  }
  return { acted: true, attacked: false };
}

/** Minimum/maximum tile distance (inclusive) at which the petrifying gaze may be aimed/fired. */
const GAZE_MIN_RANGE = 2;
export const GAZE_MAX_RANGE = 5;

/**
 * If `from` and `to` lie on one of the 8 fixed lines (same row, same
 * column, or a perfect diagonal), returns that direction and the tile
 * distance along it (equal to Chebyshev distance, since alignment already
 * guarantees the line is straight). Returns null if they are not aligned
 * on any of the 8 directions (including the same-tile case).
 */
function alignedGazeDirection(from: Vec2, to: Vec2): { direction: Direction8; distance: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return { direction: dy > 0 ? 'S' : 'N', distance: Math.abs(dy) };
  if (dy === 0) return { direction: dx > 0 ? 'E' : 'W', distance: Math.abs(dx) };
  if (Math.abs(dx) !== Math.abs(dy)) return null;
  if (dx > 0 && dy < 0) return { direction: 'NE', distance: dx };
  if (dx < 0 && dy < 0) return { direction: 'NW', distance: -dx };
  if (dx > 0 && dy > 0) return { direction: 'SE', distance: dx };
  return { direction: 'SW', distance: -dx };
}

/**
 * Walks a gaze ray from `from` along `direction`, one tile at a time via
 * the existing canMove (so it stops at a wall/map edge and respects the
 * same diagonal corner-cut rule as normal movement — line of sight is
 * blocked by terrain only, never by actors), up to `maxSteps` tiles.
 * Returns every tile actually reached, in order (shorter than `maxSteps`
 * if blocked early). Exported (phase-07-1-ranged-attack-telegraph) so the
 * telegraph-rendering module can compute the exact same reachable tiles
 * used by the hit/miss check below, instead of re-deriving the range
 * logic separately for display.
 */
export function castGazeRay(map: GameState['map'], from: Vec2, direction: Direction8, maxSteps: number): Vec2[] {
  const reached: Vec2[] = [];
  let pos = from;
  for (let i = 0; i < maxSteps; i++) {
    if (!canMove(map, pos, direction)) break;
    pos = destinationOf(pos, direction);
    reached.push(pos);
  }
  return reached;
}

/**
 * Resolves one cockatrice's action ('cockatrice_gaze',
 * phase-06-cockatrice-petrifying-gaze). Priority, highest first:
 * 1. If already aimed (`gazeDirection` set from a previous turn), fires
 *    along that exact stored direction this turn — even if now adjacent
 *    to the player — so an aimed shot is never silently replaced by a
 *    melee attack (implementation_policy). Clears `gazeDirection`
 *    regardless of hit/miss.
 * 2. Otherwise, attacks normally if adjacent (never sets gazeDirection).
 * 3. Otherwise, aims if the player is on an unobstructed 2-5 tile line
 *    along one of the 8 directions: stores that fixed direction, takes no
 *    other action this turn, and never re-aims at the player's later
 *    position.
 * 4. Otherwise, falls back to a normal chase step.
 */
function resolveCockatriceEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.gazeDirection) {
    const direction = enemy.gazeDirection;
    enemy.gazeDirection = undefined;
    // Display-only bookkeeping (phase-07-1-ranged-attack-telegraph-reticle-only);
    // does not participate in the hit check below, which is unchanged.
    enemy.gazeTargetTile = undefined;
    const reached = castGazeRay(state.map, enemy.pos, direction, GAZE_MAX_RANGE);
    const hit = reached.some((tile) => tile.x === state.player.pos.x && tile.y === state.player.pos.y);
    events.push({
      type: 'cockatrice_gaze_fire',
      actorId: enemy.id ?? 0,
      enemyType: enemy.type,
      direction,
      hit,
    });
    if (hit) {
      state.player.petrified = true;
      events.push({ type: 'player_petrified', actorId: enemy.id ?? 0, enemyType: enemy.type });
    }
    return { acted: true, attacked: false };
  }

  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }

  const aligned = alignedGazeDirection(enemy.pos, state.player.pos);
  if (aligned && aligned.distance >= GAZE_MIN_RANGE && aligned.distance <= GAZE_MAX_RANGE) {
    const reached = castGazeRay(state.map, enemy.pos, aligned.direction, aligned.distance);
    if (reached.length === aligned.distance) {
      enemy.gazeDirection = aligned.direction;
      // Display-only snapshot of the aimed-at tile (phase-07-1-ranged-attack-telegraph-reticle-only);
      // hit-detection above still relies solely on gazeDirection + castGazeRay, unchanged.
      enemy.gazeTargetTile = { ...state.player.pos };
      events.push({
        type: 'cockatrice_gaze_aim',
        actorId: enemy.id ?? 0,
        enemyType: enemy.type,
        direction: aligned.direction,
      });
      return { acted: true, attacked: false };
    }
  }

  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/** Minimum/maximum Chebyshev distance (inclusive) at which the kraken may telegraph a tentacle strike. */
const KRAKEN_MIN_RANGE = 1;
const KRAKEN_MAX_RANGE = 5;

/**
 * Returns the orthogonal cross (center + N/S/W/E) centered on `center`,
 * excluding any cell outside the map. Walls are intentionally left in —
 * they only matter here as a possible (never occupiable) miss target, so
 * no special handling is needed for them. Exported
 * (phase-07-1-ranged-attack-telegraph) so the telegraph-rendering module
 * computes the exact same 5 cells used by the hit-detection below.
 */
export function tentacleCrossCells(map: GameState['map'], center: Vec2): Vec2[] {
  const candidates: Vec2[] = [
    center,
    { x: center.x, y: center.y - 1 },
    { x: center.x, y: center.y + 1 },
    { x: center.x - 1, y: center.y },
    { x: center.x + 1, y: center.y },
  ];
  return candidates.filter((pos) => isInBounds(map, pos));
}

/**
 * Resolves one kraken's action ('kraken_tentacle',
 * phase-06-kraken-telegraphed-tentacle-strike). The kraken itself never
 * moves and never makes a normal melee attack, on any turn, regardless of
 * adjacency. Priority, highest first:
 * 1. If already telegraphing (`tentacleTarget` set from a previous turn),
 *    strikes the cross centered on that exact stored coordinate this turn
 *    (never re-centered on the player's current position), clearing the
 *    field afterward win or miss. On a hit, applies damage (reusing normal
 *    HP/defeat handling) and, only if the player is still alive, attempts
 *    a deterministic 1-tile pull toward the kraken.
 * 2. Otherwise, if the player is within Chebyshev distance 1-5 (no line of
 *    sight required), telegraphs by storing the player's current
 *    coordinate (no other action that turn).
 * 3. Otherwise, waits with no event.
 */
function resolveKrakenEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const { player, map } = state;

  if (enemy.tentacleTarget) {
    const target = enemy.tentacleTarget;
    enemy.tentacleTarget = undefined;
    const area = tentacleCrossCells(map, target);
    const hit = area.some((pos) => pos.x === player.pos.x && pos.y === player.pos.y);
    const damage = hit ? getIncomingDamage(state, enemy.attack) : 0;
    events.push({
      type: 'kraken_tentacle_strike',
      enemyId: enemy.id ?? 0,
      enemyType: enemy.type,
      target,
      hit,
      damage,
    });

    if (hit) {
      player.hp = Math.max(0, player.hp - damage);
      if (player.hp === 0) player.alive = false;

      // Pull: only attempted if the player survived the hit.
      if (player.alive) {
        const dx = enemy.pos.x - player.pos.x;
        const dy = enemy.pos.y - player.pos.y;
        let moveX = 0;
        let moveY = 0;
        if (Math.abs(dx) >= Math.abs(dy)) {
          moveX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        } else {
          moveY = dy > 0 ? 1 : -1;
        }
        if (moveX !== 0 || moveY !== 0) {
          const dest: Vec2 = { x: player.pos.x + moveX, y: player.pos.y + moveY };
          const validDestination =
            isWalkable(map, dest) &&
            !(dest.x === enemy.pos.x && dest.y === enemy.pos.y) &&
            !state.enemies.some(
              (other) => isMovementBlockingEnemy(other) && other.pos.x === dest.x && other.pos.y === dest.y,
            );
          if (validDestination) {
            const from = { ...player.pos };
            player.pos = dest;
            events.push({
              type: 'player_pulled',
              sourceEnemyId: enemy.id ?? 0,
              enemyType: enemy.type,
              from,
              to: dest,
            });
          }
        }
      }
    }

    return { acted: true, attacked: hit };
  }

  const distance = chebyshevDistance(enemy.pos, player.pos);
  if (
    player.alive &&
    distance >= KRAKEN_MIN_RANGE &&
    distance <= KRAKEN_MAX_RANGE &&
    isWalkable(map, player.pos)
  ) {
    const target: Vec2 = { ...player.pos };
    enemy.tentacleTarget = target;
    events.push({ type: 'kraken_tentacle_aim', enemyId: enemy.id ?? 0, enemyType: enemy.type, target });
    return { acted: true, attacked: false };
  }

  return { acted: false, attacked: false };
}

/**
 * Dispatches an enemy's action by its species' behaviorType (see
 * enemy-def.ts) rather than switching on species id directly, so adding a
 * finished signature AI later only requires adding a new BehaviorType case
 * here plus updating that species' definition entry.
 *
 * - 'spider_cardinal': spider's 4-direction-only chase/attack, plus web
 *   placement and corner-crossing A (enemy-behavior-02).
 * - 'slow_melee': golem's every-other-turn chase/attack (enemy-behavior-01).
 * - 'fast_melee': sword's up-to-2-steps-per-turn chase/attack
 *   (enemy-behavior-01).
 * - 'recovery_melee': axe's attack-then-forced-wait chase/attack
 *   (enemy-behavior-01).
 * - 'bat_retreat': bat's attack-then-retreat-next-turn chase/attack
 *   (enemy-behavior-06).
 * - 'mummy_shamble': mummy's move-then-rest-next-turn chase/attack
 *   (phase-06-mummy-shambling-movement).
 * - 'cockatrice_gaze': cockatrice's telegraphed-line petrifying gaze
 *   (phase-06-cockatrice-petrifying-gaze).
 * - 'kraken_tentacle': kraken's telegraphed-cross tentacle strike with pull
 *   (phase-06-kraken-telegraphed-tentacle-strike).
 * - 'generic_melee' and 'placeholder': bok's 8-direction chase/attack
 *   ('placeholder' is a reserved fallback with no current species).
 * - 'stationary': a stricter no-op fallback that never acts at all (no
 *   current species uses this).
 */
function resolveOneEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  // Phase 23.1: a head-form skeleton takes no action at all — no
  // movement, no attack, no per-species book-keeping, no RNG — until it
  // reverts to 'body' (resolveSkeletonRevivals, checked once per world
  // turn). Checked before the aggro-range early-return below so a head
  // never even counts as "noticing" the player.
  if (enemy.type === 'skeleton' && enemy.skeletonForm === 'head') {
    return { acted: false, attacked: false };
  }
  const behaviorType = ENEMY_DEFINITIONS[enemy.type].behaviorType;
  if (behaviorType !== 'stationary' && !isAdjacent(enemy.pos, state.player.pos) && !isWithinAggroRange(enemy, state.player)) {
    // Phase 16.1: an enemy that hasn't noticed the player yet (further
    // than AGGRO_RANGE away, Chebyshev, and not already adjacent) does
    // nothing this turn — no movement, no attack, no per-species
    // book-keeping (web cooldown, retreat/rest flags, etc.), and
    // consumes no RNG. Previously every living enemy on the floor
    // beelined toward the player from the instant it spawned regardless
    // of distance, so once the map grew to 48x36 with more rooms (Phase
    // 16) a full floor's enemies could all converge on the player at
    // once well before the player ever saw most of them. This is a
    // simple numeric distance gate, not a line-of-sight/vision system
    // (out of scope) — an enemy on the far side of a wall within range
    // still "notices" the player, exactly as before this change, and
    // still has to path around walls once it starts chasing.
    return { acted: false, attacked: false };
  }
  switch (behaviorType) {
    case 'spider_cardinal':
      return resolveSpiderEnemy(state, enemy, events);
    case 'slow_melee':
      return resolveGolemEnemy(state, enemy, events);
    case 'fast_melee':
      return resolveSwordEnemy(state, enemy, events);
    case 'recovery_melee':
      return resolveAxeEnemy(state, enemy, events);
    case 'bat_retreat':
      return resolveBatEnemy(state, enemy, events);
    case 'mummy_shamble':
      return resolveMummyEnemy(state, enemy, events);
    case 'cockatrice_gaze':
      return resolveCockatriceEnemy(state, enemy, events);
    case 'kraken_tentacle':
      return resolveKrakenEnemy(state, enemy, events);
    case 'stationary':
      return { acted: false, attacked: false };
    case 'generic_melee':
    case 'placeholder':
    default:
      return resolveBokEnemy(state, enemy, events);
  }
}

/**
 * Phase 13.3b speed/action-gauge scheduler: the per-pass gauge gain every
 * living enemy receives, once per resolveEnemiesAction call, regardless
 * of species (no enemy-specific speed table this phase — confirmed_spec's
 * "全敵共通" / "敵種別による速度テーブルを作らない"). Shares its 100=
 * baseline unit convention with ability.ts's PLAYER_BASE_SPEED so that
 * rank 0 (playerSpeed also 100) reduces to "gauge reaches the threshold
 * exactly once per pass, with 0 remainder" — see resolveEnemiesAction's
 * own doc comment for why this exactly reproduces pre-Phase-13.3b
 * behavior.
 */
const ENEMY_BASE_SPEED = 100;

/**
 * Runs each living enemy's action zero, one, or multiple times this pass,
 * per the Phase 13.3b speed/action-gauge scheduler: each living enemy's
 * `actionGauge` (a required field on EnemyActor, always explicitly
 * initialized to 0 by createInitialEnemy — see types.ts's doc comment)
 * is incremented by ENEMY_BASE_SPEED
 * once at the start of its turn in this pass; then, while it remains >=
 * the player's current speed (ability.ts's getPlayerSpeed), playerSpeed
 * is subtracted and resolveOneEnemy is called once more — so a faster
 * player (higher getPlayerSpeed) makes enemies act less often on average,
 * and any leftover gauge below the threshold carries over to the next
 * pass unchanged (never rounded away). Enemies are still processed in
 * the same fixed state.enemies array order as before this phase; a given
 * enemy resolves all of its own due actions before the loop moves to the
 * next enemy. Stops immediately (breaking out of both the inner and
 * outer loop) the moment the player dies, exactly as before this phase —
 * and additionally stops an individual enemy's own while-loop early if
 * that specific enemy dies mid-loop (defensive; no current mechanic
 * causes this, but confirmed_spec's interruption.enemy_death requires
 * it). `resolveOneEnemy` itself, every behaviorType function it
 * dispatches to, and the RNG it may consume are completely unchanged by
 * this phase — a no-op result from an enemy's own internal AI logic
 * (golem's off-turn wait, mummy's post-move rest, axe's post-attack
 * recovery, etc.) still counts as exactly one consumed action-gauge
 * "turn" and is never retried or refunded.
 *
 * Rank-0 exact backward compatibility: at the default player speed (100,
 * ability.ts's PLAYER_BASE_SPEED) with every enemy's actionGauge starting
 * at 0, each pass computes `gauge = 0 + 100 = 100`, `100 >= 100` is true
 * exactly once (one call to resolveOneEnemy), then `100 - 100 = 0`
 * leaves no remainder — so every living enemy is resolved exactly once
 * per pass, in the same order, consuming RNG in the same sequence, as
 * the pre-Phase-13.3b single-call-per-enemy loop. This holds for however
 * many times resolveEnemiesAction itself is called within one player
 * turn (e.g. the movement_slow additional-enemy-phase below), since each
 * independent pass's remainder is exactly 0 at rank 0.
 */
function resolveEnemiesAction(
  state: GameState,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  // Phase 20.3 fix: before any card could end the player's turn early
  // (death/hanged_man's direct HP writes — see applyDeathCardUse/
  // applyHangedManCardUse), the player was always alive on entry here,
  // since every other death cause (enemy attack, poison, starvation) was
  // itself resolved no earlier than this same function or strictly after
  // it in processTurn's pipeline. That invariant no longer holds
  // unconditionally now that applyPlayerAction (which runs before this
  // call) can itself set state.player.alive = false. This guard restores
  // it explicitly: if the player is already dead entering this call, no
  // enemy takes any action or produces any event this turn — the shared
  // playerDefeated confirmation point (further down processTurn) is
  // reached with no further world-state mutation in between, exactly as
  // required for card-driven deaths (rogue-of-sun-card-effects-spec.md's
  // "既存の死亡原因ごとに個別実装を複製せず、死亡確定前の共通境界へ接続
  // する"). Every existing enemy-attack/damage calculation below this
  // guard is otherwise completely unchanged.
  if (!state.player.alive) {
    return { acted: false, attacked: false };
  }

  let acted = false;
  let attacked = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    // Phase 21.4: a dedicated monster-house enemy takes no action while
    // its monster house is still hidden — skipped before any RNG or
    // action-gauge consumption, so this never perturbs any other enemy's
    // action count/order, and never consumes RNG itself. Once revealed
    // (Phase 21.3's applyMonsterHouseReveal, which always runs before
    // this loop starts for the turn it happens on), this same loop
    // includes it exactly like any other living enemy from that point
    // on — no separate re-activation step exists or is needed.
    if (enemy.spawnSource === 'monster_house' && state.map.monsterHouse?.status === 'hidden') continue;
    const playerSpeed = getPlayerSpeed(state);
    enemy.actionGauge += ENEMY_BASE_SPEED;
    while (enemy.actionGauge >= playerSpeed) {
      enemy.actionGauge -= playerSpeed;
      const result = resolveOneEnemy(state, enemy, events);
      if (result.acted) acted = true;
      if (result.attacked) attacked = true;
      if (!enemy.alive) break;
      if (!state.player.alive) break;
    }
    if (!state.player.alive) break;
  }

  return { acted, attacked };
}

function pickChaseDirections(dx: number, dy: number) {
  // Prefer the direct diagonal/cardinal toward the player, then fall back
  // to the pure horizontal/vertical component.
  const dirs: { x: number; y: number; name: import('./types').Direction8 }[] = [];
  const nameFor = (x: number, y: number): import('./types').Direction8 | null => {
    if (x === 0 && y === -1) return 'N';
    if (x === 0 && y === 1) return 'S';
    if (x === 1 && y === 0) return 'E';
    if (x === -1 && y === 0) return 'W';
    if (x === 1 && y === -1) return 'NE';
    if (x === -1 && y === -1) return 'NW';
    if (x === 1 && y === 1) return 'SE';
    if (x === -1 && y === 1) return 'SW';
    return null;
  };

  const primary = nameFor(dx, dy);
  if (primary) dirs.push({ x: dx, y: dy, name: primary });
  if (dx !== 0) {
    const n = nameFor(dx, 0);
    if (n) dirs.push({ x: dx, y: 0, name: n });
  }
  if (dy !== 0) {
    const n = nameFor(0, dy);
    if (n) dirs.push({ x: 0, y: dy, name: n });
  }
  return dirs.map((d) => d.name);
}

/**
 * Processes exactly one player input as a turn, per the sequence:
 * 1) resolve player action, 2) confirm result (defeat), 3) resolve each
 * living enemy's action in order (stopping early if the player dies),
 * 4) confirm player defeat, 5) process natural HP regeneration if the
 * player survived, 6) check floor progression, 7) increment turn count.
 *
 * Invalid/unused inputs and blocked moves do not consume a turn and do not
 * advance enemy actions or natural regeneration.
 */
/**
 * Phase 11.3 hunger/starvation: advances hunger exactly once for a
 * successfully-consumed player turn (called from processTurn only when
 * `state.player.alive`). Reads hunger once at the top, before any change
 * this tick, so the branch taken reflects hunger's value at the *start*
 * of this turn:
 * - hunger >= 1 at the start: runs the decrease progression (and always
 *   resets starvationProgress to 0 — this is what implements the "no
 *   starvation damage on the same turn hunger drops from 1 to 0" grace
 *   rule, since a hunger-0 turn only ever reaches the starvation branch
 *   on the *next* successful turn).
 * - hunger === 0 at the start: runs the starvation progression instead
 *   (hungerDecreaseProgress is pinned at 0 — no point counting toward a
 *   decrease that can't go below 0).
 * Never uses RNG. Armor/evasion are never consulted for starvation
 * damage (fixed_specification.starvation: "防具の防御力で飢餓ダメージを
 * 軽減しない" / "乱数による回避・軽減を行わない") — this applies
 * player.hp -= STARVATION_DAMAGE directly, bypassing combat.ts entirely.
 */
function applyHungerProgression(state: GameState, events: GameEvent[]): void {
  const hunger = getHunger(state);

  if (hunger >= 1) {
    const progress = getHungerDecreaseProgress(state) + 1;
    if (progress >= HUNGER_DECREASE_INTERVAL) {
      state.hunger = Math.max(0, hunger - HUNGER_DECREASE_AMOUNT);
      state.hungerDecreaseProgress = 0;
      // Phase 15.2 recovery/satiety/status rebalance: pushed only on the
      // turn an actual 1-point decrease happens (never every turn) — see
      // events.ts's satiety_decreased doc comment.
      events.push({ type: 'satiety_decreased', amount: hunger - state.hunger, satietyAfter: state.hunger });
    } else {
      state.hungerDecreaseProgress = progress;
    }
    state.starvationProgress = 0;
  } else {
    const progress = getStarvationProgress(state) + 1;
    if (progress >= STARVATION_INTERVAL) {
      state.starvationProgress = 0;
      state.player.hp = Math.max(0, state.player.hp - STARVATION_DAMAGE);
      events.push({ type: 'starvation_damage', damage: STARVATION_DAMAGE });
      if (state.player.hp <= 0) {
        state.player.alive = false;
      }
    } else {
      state.starvationProgress = progress;
    }
    state.hungerDecreaseProgress = 0;
  }

  updateHungerWarnings(state, events);
}

/**
 * Pushes the one-time low(<=20)/zero(0) hunger warnings (Phase 11.3
 * notifications), tracked via GameState.hungerLowWarned/hungerZeroWarned
 * so each stays silent until hunger recovers back above its threshold
 * and dips again (fixed_specification.notifications: "同じ閾値に留まっ
 * ている間、毎ターン同じ警告を出さない" / "再度低下した場合は再通知して
 * よい"). Called once per applyHungerProgression invocation, after that
 * turn's hunger value is final.
 */
function updateHungerWarnings(state: GameState, events: GameEvent[]): void {
  const hunger = getHunger(state);

  if (hunger <= 0) {
    if (!state.hungerZeroWarned) {
      events.push({ type: 'hunger_zero_warning' });
      state.hungerZeroWarned = true;
    }
  } else {
    state.hungerZeroWarned = false;
  }

  if (hunger > 0 && hunger <= HUNGER_LOW_THRESHOLD) {
    if (!state.hungerLowWarned) {
      events.push({ type: 'hunger_low_warning' });
      state.hungerLowWarned = true;
    }
  } else if (hunger > HUNGER_LOW_THRESHOLD) {
    state.hungerLowWarned = false;
  }
}

/**
 * Applies poison's per-tick damage (Phase 12.3 poison trap), once per
 * successful player turn while poison is active. `skipThisTurn` is true
 * on the exact turn a poison_trap was triggered by this action
 * (trap_trigger_interactions.poison_trap's "poison_trapを踏んだターンに
 * 新規poisonダメージを発生させない") — covers both a fresh grant and a
 * refresh of already-carried-over poison, since either way the trigger
 * turn itself deals no damage, matching slow_trap/movement_slow's
 * analogous no-damage-on-grant-turn rule.
 *
 * Runs after hunger/starvation (poison_tick.processing_order's "飢餓処理
 * 後もHPが1以上の場合だけpoisonダメージを1回適用する") and only if the
 * player is currently alive with HP >= 1 — an already-fatal enemy attack
 * or starvation this same turn is never topped up with an extra poison
 * tick (poison_tick.processing_order's "敵攻撃または飢餓でHPが0になって
 * いる場合、poisonダメージを重ねない"). Ignores Actor.defense/armor
 * entirely and draws no RNG (poison_tick.damage_rules's "防御力、防具、
 * 命中率、回避率を参照しない" / "乱数を使わない"). `actualDamage` is
 * clamped to the player's actual remaining HP — never over-reports the
 * nominal strength (3) when less HP remains (poison_tick.damage_rules's
 * "記録するdamageは理論値3ではなく実際に減少したHP量とする").
 */
function applyPoisonTick(state: GameState, events: GameEvent[], skipThisTurn: boolean): void {
  if (skipThisTurn) return;
  if (!state.player.alive || state.player.hp <= 0) return;
  const active = getActiveEffect(state, 'poison');
  if (!active) {
    // Not currently poisoned: keep tick progress at 0 so a future grant
    // always starts its schedule cleanly (defensive — grant/refresh above
    // already resets this explicitly too).
    state.poisonTickProgress = 0;
    return;
  }

  // Phase 15.2 recovery/satiety/status rebalance: poison no longer ticks
  // every successful player turn — only once every POISON_TICK_INTERVAL
  // turns (see effects.ts's POISON_TICK_INTERVAL/getPoisonTickProgress).
  // A turn that only advances progress (without reaching the interval)
  // pushes no event and deals no damage.
  const progress = getPoisonTickProgress(state) + 1;
  if (progress < POISON_TICK_INTERVAL) {
    state.poisonTickProgress = progress;
    return;
  }
  state.poisonTickProgress = 0;

  const strength = active.strength;
  if (strength <= 0) return;

  const hpBefore = state.player.hp;
  const actualDamage = Math.min(strength, hpBefore);
  state.player.hp = Math.max(0, hpBefore - actualDamage);
  events.push({ type: 'poison_damage', actualDamage, hpBefore, hpAfter: state.player.hp });
  if (state.player.hp <= 0) {
    state.player.alive = false;
  }
}

/**
 * Phase 23.1: reverts every head-form skeleton whose
 * skeletonReviveAtTurn has been reached back to 'body' at full HP, in
 * fixed state.enemies order (deterministic; no RNG). A skeleton whose
 * own tile is occupied by the player or by another living body-form
 * actor is simply left as a head and re-checked the following world
 * turn — the revival position itself never moves. Because this walks
 * state.enemies in order and mutates in place, a skeleton revived
 * earlier in this same pass is already visible (as an occupant) to any
 * later skeleton's occupancy check on the same tile, so two head-form
 * skeletons stacked on one tile (heads never block movement/placement —
 * see EnemyActor.skeletonForm's doc comment) resolve deterministically
 * one at a time rather than racing. Other head-form skeletons never
 * count as occupants (heads don't block anything), only the player and
 * living body-form actors do.
 */
function resolveSkeletonRevivals(state: GameState, events: GameEvent[]): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.type !== 'skeleton' || enemy.skeletonForm !== 'head') continue;
    if (enemy.skeletonReviveAtTurn === undefined || state.turn < enemy.skeletonReviveAtTurn) continue;
    const occupied =
      (state.player.pos.x === enemy.pos.x && state.player.pos.y === enemy.pos.y) ||
      state.enemies.some(
        (other) =>
          other !== enemy &&
          other.alive &&
          !(other.type === 'skeleton' && other.skeletonForm === 'head') &&
          other.pos.x === enemy.pos.x &&
          other.pos.y === enemy.pos.y,
      );
    if (occupied) continue;
    enemy.skeletonForm = 'body';
    enemy.hp = enemy.maxHp;
    enemy.skeletonReviveAtTurn = undefined;
    events.push({ type: 'skeleton_revived', targetId: enemy.id ?? 0 });
  }
}

export function processTurn(state: GameState, action: PlayerAction): TurnResult {
  if (state.phase !== 'playing') {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      playerRegenAmount: 0,
      monsterHouseRevealed: false,
      events: [],
    };
  }

  // Inventory overlay open (Phase 08.2): normal move/wait/attack input is
  // rejected outright (no turn consumed) while the overlay is shown;
  // opening/closing/navigating the overlay and using an item go through
  // their own dedicated functions (see src/game/inventory.ts), not this
  // guard. 'use_item' itself is exempt so a successful use can still run
  // the full turn pipeline below.
  if (
    state.inventoryOpen &&
    action.type !== 'use_item' &&
    action.type !== 'equip_weapon' &&
    action.type !== 'equip_armor' &&
    action.type !== 'place_item' &&
    action.type !== 'discard_item'
  ) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      playerRegenAmount: 0,
      monsterHouseRevealed: false,
      events: [],
    };
  }

  // Ability allocation overlay open (Phase 13.2): normal move/wait/attack/
  // item input is rejected outright (no turn consumed) while the overlay
  // is shown. Unlike the inventory overlay above, ability allocation
  // never routes through processTurn/PlayerAction at all (see
  // ability.ts's allocateAbilityPoint) — there is no exempted action type
  // here, since this guard exists purely as a defensive second line
  // behind main.ts's own routing (allocation_core.requirements's "同じ
  // Enter入力がUIとゲーム処理へ二重伝播しない").
  if (state.abilityOverlayOpen) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      playerRegenAmount: 0,
      monsterHouseRevealed: false,
      events: [],
    };
  }

  const events: GameEvent[] = [];
  // Phase 12.2 additional-enemy-phase detection: captured before
  // applyPlayerAction runs (rather than adding new return fields to it)
  // so the extra-phase eligibility below can be derived purely from
  // before/after comparisons of already-observable state — the same
  // technique Phase 12.1's isBananaGrant used.
  const posBeforeAction = { ...state.player.pos };
  const movementSlowActiveBeforeAction = getEffectStrength(state, 'movement_slow') > 0;
  const trapsTriggeredBeforeAction = new Set(
    (state.traps ?? []).filter((t) => t.triggered).map((t) => t.id),
  );

  const { consumed, attacked, defeated } = applyPlayerAction(state, action, events);

  if (!consumed) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      playerRegenAmount: 0,
      monsterHouseRevealed: false,
      // Blocked moves push nothing (events stays []), but an unconsumed
      // item-use failure (e.g. full HP) still pushes an explanatory event
      // (Phase 08.2 apple_use.full_hp requirement: "使用できない理由を表
      // 示する") — so this reflects whatever applyPlayerAction actually
      // pushed rather than always discarding it.
      events,
    };
  }

  // Phase 21.3: monster house reveal, checked right after the player's
  // move is confirmed to have actually happened (same move-happened test
  // used by the additional-enemy-phase logic below) and before any enemy
  // action resolves this turn — see monster-house.ts's
  // applyMonsterHouseReveal doc comment for the full contract. Never
  // consumes RNG, never changes roomIndex, and only matters when this
  // move's source tile was outside the hidden monster house's room and
  // its destination tile is inside it.
  const moveHappenedForReveal =
    action.type === 'move' &&
    (state.player.pos.x !== posBeforeAction.x || state.player.pos.y !== posBeforeAction.y);
  const monsterHouseRevealed = moveHappenedForReveal
    ? applyMonsterHouseReveal(state.map, posBeforeAction, state.player.pos)
    : false;
  // Phase 21.7: fired exactly once, the same call where the status
  // transition itself just happened above — never re-derived from
  // state.map.monsterHouse.status later, so re-entry/reload/re-render
  // can never re-trigger it (there is no later read of that field this
  // event depends on).
  if (monsterHouseRevealed) {
    events.push({ type: 'monster_house_revealed' });
  }

  const { acted: enemyActed, attacked: enemyAttacked } = resolveEnemiesAction(state, events);

  // Phase 12.2 slow trap: an additional enemy action phase, using the
  // exact same resolveEnemiesAction entry point as the normal phase
  // above (implementation_policy's "追加敵フェーズの入口を一箇所に限定
  // する" — this is that one place), runs only when ALL of the following
  // hold:
  //   - the resolved action was 'move' and the player's tile actually
  //     changed (excludes whiffed/blocked moves, spider-web slow
  //     cancellation, and petrified skips — none of those move the
  //     player, so this comparison alone correctly excludes every one of
  //     them without needing to check player.slowed/petrified directly)
  //   - that move did not land on the exit tile (movement_rules.
  //     not_affected's "出口によるフロア遷移")
  //   - this exact move did not itself trigger a slow_trap (fixed_
  //     specification.effect.lifecycle's "罠発動ターン自体では敵の追加
  //     行動を発生させない" — detected by diffing each slow_trap's
  //     `triggered` flag against the pre-action snapshot, so this also
  //     correctly covers the rare case where movement_slow was already
  //     active from a previous floor's trap and this move simultaneously
  //     refreshes it via a second slow_trap). Phase 12.3 narrows this
  //     check from "any trap of any type" to "a slow_trap specifically"
  //     (trap_trigger_interactions.movement_slow's "現在のany trap
  //     triggered判定になっている場合、slow_trap triggered判定へ限定修正
  //     する") — triggering a poison_trap on this same move must NOT
  //     suppress the additional enemy phase when movement_slow was
  //     already independently active going into this action.
  //   - movement_slow was already active BEFORE this action started
  //     (movementSlowActiveBeforeAction) — a fresh grant this same turn
  //     never qualifies, per the same rule above
  //   - the player survived the first enemy phase (fixed_specification.
  //     additional_enemy_phase's "最初の敵フェーズでプレイヤーが死亡した
  //     場合は追加フェーズを実行しない"; the only way enemy actions alone
  //     can end the game is player death, so this single check also
  //     covers "ゲーム終了状態になった場合")
  const actualMoveHappened =
    action.type === 'move' &&
    (state.player.pos.x !== posBeforeAction.x || state.player.pos.y !== posBeforeAction.y);
  const reachedExitThisMove =
    actualMoveHappened && state.player.pos.x === state.exit.x && state.player.pos.y === state.exit.y;
  const trapsTriggeredThisAction = (state.traps ?? []).filter(
    (t) => t.triggered && !trapsTriggeredBeforeAction.has(t.id),
  );
  const slowTrapTriggeredThisAction = trapsTriggeredThisAction.some((t) => t.trapType === 'slow_trap');
  const poisonTrapTriggeredThisAction = trapsTriggeredThisAction.some((t) => t.trapType === 'poison_trap');
  const shouldRunAdditionalEnemyPhase =
    actualMoveHappened &&
    !reachedExitThisMove &&
    !slowTrapTriggeredThisAction &&
    movementSlowActiveBeforeAction &&
    state.player.alive;

  let extraEnemyActed = false;
  let extraEnemyAttacked = false;
  if (shouldRunAdditionalEnemyPhase) {
    const extra = resolveEnemiesAction(state, events);
    extraEnemyActed = extra.acted;
    extraEnemyAttacked = extra.attacked;
  }

  // Phase 11.3 hunger/starvation: runs once per consumed turn, after
  // enemy actions resolve (so enemies still act exactly once per player
  // turn, unchanged from before this phase) but only if the player
  // survived those enemy actions — starvation never applies to an
  // already-dead player, and never causes enemies to act an extra time.
  // Chocolate's own hunger recovery already happened inside
  // applyPlayerAction/applyChocolateUse above, so this sees the
  // post-recovery hunger value — which is what makes "no starvation
  // damage on the same action that used chocolate from 0" fall out
  // naturally (see applyChocolateUse's doc comment).
  if (state.player.alive) {
    applyHungerProgression(state, events);
  }

  // Phase 12.3 poison trap: applies poison's per-tick damage once per
  // successful player turn (poison_tick.processing_order's "飢餓処理後も
  // HPが1以上の場合だけpoisonダメージを1回適用する"), after hunger/
  // starvation above but before playerDefeated is confirmed below — see
  // applyPoisonTick's own doc comment for the full ordering rationale.
  applyPoisonTick(state, events, poisonTrapTriggeredThisAction);

  // Phase 20.3: `playerDefeated` is the single confirmation point every
  // *pre-existing* LIFE-reaching-0 cause funnels through this same turn —
  // normal enemy attacks (resolveEnemyAttackHit), the kraken tentacle,
  // starvation, and poison (applyPoisonTick just above) all set
  // state.player.alive = false no earlier than this same call, at or
  // before this line. Card-driven lethal causes (death/hanged_man) now
  // resolve judgement immediately after their own effect instead of
  // waiting for this point (see resolveDeathIfDefeated's doc comment for
  // why) — calling the same shared function here as well keeps this the
  // single implementation for every cause, and is a safe no-op if a card
  // already resolved (revived or not) earlier this turn: resolveDeathIfDefeated
  // returns immediately when the player is already alive, and never
  // double-consumes/double-triggers when the player is still dead (no
  // judgement was available either time). `let` (not `const`) because a
  // successful judgement trigger overwrites this back to false so the
  // gameover transition below and the regen/hunger `if (state.player.alive)`
  // guards further down all see the revived state consistently.
  let playerDefeated = !state.player.alive;
  if (playerDefeated) {
    resolveDeathIfDefeated(state, events);
    playerDefeated = !state.player.alive;
    if (playerDefeated) {
      events.push({ type: 'player_defeated' });
    }
  }

  let playerRegenerated = false;
  let playerRegenAmount = 0;
  if (state.player.alive) {
    // Phase 11.3: natural regen is entirely suspended while hunger is 0
    // (fixed_specification.natural_regeneration_interaction) — regenProgress
    // itself is left untouched (not reset) so it resumes exactly where it
    // left off once hunger recovers above 0.
    if (getHunger(state) >= 1 && state.player.hp < state.player.maxHp) {
      state.regenProgress += 1;
      if (state.regenProgress >= REGEN_TURNS_PER_HP) {
        // Phase 15.2 recovery/satiety/status rebalance: amount is now the
        // named REGEN_AMOUNT_PER_TICK constant (previously an inline
        // literal 10) — see docs/history/phase-15-2-recovery-satiety-
        // status-rebalance.md.
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + REGEN_AMOUNT_PER_TICK);
        state.regenProgress = 0;
        playerRegenerated = true;
        // Phase 16.2: captured as this tick's own isolated delta (not a
        // before/after whole-turn diff), so telemetry.ts can report the
        // regen tick's real contribution even on a turn that also heals
        // from another source (item use, etc.) in the same turn — see
        // docs/history/phase-16-early-game-balance.md's Phase 16.2
        // section for the bug this replaced (a coarse diff silently
        // folded any other same-turn healing into the regen total).
        playerRegenAmount = REGEN_AMOUNT_PER_TICK;
      }
    } else if (getHunger(state) >= 1) {
      // Full HP and not starving: existing behavior (progress resets so
      // it doesn't carry a stale partial tick into the next time HP
      // drops below max).
      state.regenProgress = 0;
    }
    // Hunger 0: regenProgress is left completely untouched (per
    // natural_regeneration_interaction's "満腹度0への遷移でregenProgress
    // を失わない" / "保持したregenProgressから再開する") — neither
    // incremented nor reset while starving.
  }

  // Phase 12.1 temporary-effect foundation: advances every active effect's
  // remaining duration by exactly 1, once per consumed turn
  // (fixed_specification.duration_and_turn_boundary.progression), after
  // enemy actions/hunger/regen have already run (order.progression) but
  // skipped entirely on the exact turn a banana use just granted or
  // refreshed attack_up — a fresh/refreshed effect must still read as its
  // full duration for this turn's HUD/next reads
  // (fixed_specification.banana.use_success's "バナナ使用ターン自体では
  // attack_upの残りターンを減らさない"). Detecting that case from the
  // already-computed `consumed` flag (rather than adding a return field to
  // applyPlayerAction/applyBananaUse) is safe here: applyBananaUse only
  // ever returns consumed: true on a successful grant/refresh, never on
  // any other outcome, so this check is unambiguous.
  //
  // Phase 12.2 extends this to a per-effect-id skip list (rather than an
  // all-or-nothing skip of the whole advanceEffectDurations call) so a
  // trap-triggering turn skips only movement_slow's decrement while any
  // simultaneously-active attack_up still decrements normally this same
  // turn (fixed_specification.compatibility.attack_up's "罠発動ターンの
  // 減算除外はmovement_slowだけに適用する / そのターンに既存attack_upが
  // 有効なら、attack_upは既存規則どおり減算する").
  const isBananaGrant = action.type === 'use_item' && action.itemId === 'banana' && consumed;
  const effectSkipIds: import('./types').EffectId[] = [];
  if (isBananaGrant) effectSkipIds.push('attack_up');
  if (slowTrapTriggeredThisAction) effectSkipIds.push('movement_slow');
  if (poisonTrapTriggeredThisAction) effectSkipIds.push('poison');
  const expiredEffects = advanceEffectDurations(state, effectSkipIds);
  for (const effectId of expiredEffects) {
    events.push({ type: 'effect_expired', effectId });
  }

  // Phase 22: the staircase is available from floor generation onward —
  // reaching it advances the floor (or ends the run in victory on the
  // final floor) regardless of whether any enemies on this floor are
  // still alive. See docs/history/phase-22-immediate-stairs-progression.md.
  // Progression requires that the player's own successful `move` action
  // is what carried them from a non-exit tile onto the exit tile this
  // turn (fixed_specification.trigger's "プレイヤーの成立した移動が階段
  // タイル上で終了した場合に進行判定する"). `actualMoveHappened` is
  // computed above, before the enemy phase runs, from the player's own
  // action alone — so it does not include enemy-phase relocations (e.g. a
  // kraken tentacle pull). Standing on the exit and waiting, attacking,
  // or using an item/weapon does not trigger progression, even if the
  // player arrived there passively earlier this same turn or a prior
  // one — only an actual move onto the tile does. (An earlier revision of
  // this check also allowed `wasOnExitBeforeAction` — already standing on
  // the exit at the start of the action — but that let a stray wait/
  // attack/item-use taken while already on the exit trigger progression,
  // and also let a passive relocation onto the exit "arm" progression for
  // whatever non-move action followed it. Both violate the trigger rule
  // above, so that allowance was removed.)
  const reachedExit =
    actualMoveHappened && state.player.pos.x === state.exit.x && state.player.pos.y === state.exit.y;

  state.turn += 1;
  // Web lifetime update comes last in the per-turn sequence (player
  // action -> enemy actions -> death/regen/floor checks -> turn increment
  // -> web lifetime), and uses the just-incremented turn count so a web
  // placed on turn T survives turns T..T+5 (6 total, including the
  // placement turn) and is removed starting turn T+6.
  expireWebs(state);
  // Phase 23.1: skeleton revival is a world-turn-based check (not tied
  // to any enemy's own action-gauge activations), so it runs exactly
  // once per processTurn call, right after the turn counter increments
  // — mirroring expireWebs' own placement in this per-turn sequence.
  resolveSkeletonRevivals(state, events);

  if (playerDefeated) {
    state.phase = 'gameover';
  } else if (reachedExit) {
    state.phase = state.floor >= state.totalFloors ? 'victory' : 'floor_cleared';
  }

  return {
    consumed: true,
    playerAttacked: attacked,
    enemyDefeated: defeated,
    // Phase 12.2: ORs in the additional enemy phase's own acted/attacked
    // flags so a caller (UI/telemetry) never loses visibility into the
    // extra phase's activity — telemetry.ts's own player-action counting
    // is unaffected (it counts the player's action, not enemy phases; see
    // fixed_specification.movement_rules.successful_slowed_movement's
    // "telemetry上のプレイヤー行動は1行動として扱う", which this does not
    // touch).
    enemyActed: enemyActed || extraEnemyActed,
    enemyAttacked: enemyAttacked || extraEnemyAttacked,
    playerDefeated,
    playerRegenerated,
    playerRegenAmount,
    monsterHouseRevealed,
    events,
  };
}

export function createInitialActor(
  pos: Vec2,
  hp: number,
  attack: number,
  defense: number = 0,
  accuracy: number = 90,
  evasion: number = 0,
): Actor {
  return { pos, hp, maxHp: hp, attack, defense, accuracy, evasion, facing: 'S', alive: true };
}

export function createInitialEnemy(
  type: EnemyType,
  pos: Vec2,
  hp: number,
  attack: number,
  spawnTurn: number = 0,
  id: number = 0,
  defense: number = 0,
  accuracy: number = 90,
  evasion: number = 0,
): EnemyActor {
  return {
    ...createInitialActor(pos, hp, attack, defense, accuracy, evasion),
    type,
    spawnTurn,
    recovering: false,
    id,
    webCooldown: 0,
    actionGauge: 0,
  };
}
