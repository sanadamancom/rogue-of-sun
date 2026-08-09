import { ActiveEffect, EffectId, GameState, StatusAilmentId } from './types';

/**
 * Central per-species definition of a temporary status effect (Phase 12.1
 * common status-effect foundation). Single source of truth for
 * strength/duration so ItemDefinition, combat resolution (turn.ts), and
 * the HUD never repeat these numbers themselves — see the phase's
 * fixed_specification.active_effect_model.definitions requirement.
 */
export interface EffectDefinition {
  id: EffectId;
  /** Japanese label used by the HUD; the internal id is never shown as-is. */
  displayName: string;
  /** Flat bonus this effect grants while active (attack_up: +5 physical attack). */
  strength: number;
  /** Duration in successful player turns, counting from the turn after it's granted/refreshed. */
  duration: number;
}

// Phase 12.1 registered only 'attack_up'; Phase 12.2 adds 'movement_slow'
// (slow trap). Future effects (poison, defense up, etc. — explicitly out
// of scope this phase) are expected to extend this table rather than add
// parallel ad-hoc fields elsewhere.
export const EFFECT_DEFINITIONS: Record<EffectId, EffectDefinition> = {
  attack_up: {
    id: 'attack_up',
    displayName: '攻撃力上昇',
    // Phase 15.2 recovery/satiety/status rebalance: 5->1 (see
    // docs/history/phase-15-2-recovery-satiety-status-rebalance.md),
    // matching the Phase 15 balance draft's low-integer combat scale.
    strength: 1,
    duration: 20,
  },
  // Phase 12.2 slow trap: `strength` here does not mean a flat numeric
  // stat bonus (unlike attack_up) — it means "additional enemy action
  // phases run per successful player move while this effect is active"
  // (fixed_specification.effect.meaning_of_strength). turn.ts's
  // movement-phase logic reads it with that meaning; effects.ts itself
  // stays a generic id/strength/duration container and does not
  // interpret it.
  movement_slow: {
    id: 'movement_slow',
    displayName: '鈍足',
    strength: 1,
    duration: 10,
  },
  // Phase 12.3 poison trap: `strength` here means "HP damage applied per
  // tick while this effect is active" (fixed_specification.effect.
  // meaning_of_strength). turn.ts's poison-tick logic (applyPoisonTick)
  // reads it with that meaning; effects.ts itself stays a generic
  // id/strength/duration container and does not interpret it, exactly
  // like movement_slow's strength above.
  //
  // Phase 15.2 recovery/satiety/status rebalance: strength 3->1, and a
  // tick no longer fires every successful player turn — see
  // POISON_TICK_INTERVAL below and turn.ts's applyPoisonTick. duration
  // stays 10 (unchanged), but ticks now land only on turns 2/4/6/8/10
  // after grant/refresh (5 ticks total, 1 damage each = 5 total, down
  // from the old every-turn/3-damage/30-total). See docs/history/
  // phase-15-2-recovery-satiety-status-rebalance.md for the derivation.
  poison: {
    id: 'poison',
    displayName: '毒',
    strength: 1,
    duration: 10,
  },
  // Phase 20.0b card identification/seal foundation: reuses this exact
  // activeEffects/duration mechanism for "normal card use is locked out"
  // (rogue-of-sun-card-effects-spec.md's "封印状態では通常使用できない"),
  // rather than inventing a parallel status representation. `strength` is
  // unused/meaningless for this id (turn.ts's card-use gate only checks
  // presence via getActiveEffect, never reads strength) — kept at 0
  // rather than omitted so this entry has the same shape as every other
  // EffectDefinition. No production code currently grants `sealed` (per
  // rogue-of-sun-development-plan.md's "封印状態そのものの新しい付与元は
  // 追加しない" — this phase only wires up the *consequence* of being
  // sealed, not any new trap/enemy source that would cause it); duration
  // is a placeholder in the same range as movement_slow/poison above,
  // relevant only once/if a future phase adds an actual grant source.
  sealed: {
    id: 'sealed',
    displayName: '封印',
    strength: 0,
    duration: 10,
  },
  // Phase 20.3: emperor's temporary 50%-mitigation shield. `strength` is
  // unused (the mitigation rate is a fixed constant — see turn.ts's
  // EMPEROR_DAMAGE_REDUCTION — not a per-grant value); only presence and
  // remainingTurns matter, exactly like sealed above. Re-using this same
  // activeEffects/grantOrRefreshEffect mechanism (never-stacking refresh
  // to a fixed duration on reuse) is what "残りターンを5へ更新する...
  // 加算や多重stackはしない" requires, with no new duration-tracking
  // system.
  emperor_shield: {
    id: 'emperor_shield',
    displayName: '皇帝の加護',
    strength: 0,
    duration: 5,
  },
};

/**
 * Poison-specific tick interval (Phase 15.2 recovery/satiety/status
 * rebalance): a poison tick (see turn.ts's applyPoisonTick) only applies
 * damage once every POISON_TICK_INTERVAL consumed player turns, rather
 * than every turn — the single source of truth for this number, so nothing
 * else (telemetry, UI, tests) duplicates it. With duration 10, this
 * produces exactly 10 / POISON_TICK_INTERVAL = 5 damage ticks per full
 * poison duration.
 */
export const POISON_TICK_INTERVAL = 2;

/**
 * Progress toward the next poison damage tick (0..POISON_TICK_INTERVAL-1,
 * default 0 when absent) — mirrors hunger.ts's getHungerDecreaseProgress/
 * getStarvationProgress pattern. Reset to 0 whenever poison is granted or
 * refreshed (turn.ts's move handler) or whenever it triggers a tick or is
 * not currently active (turn.ts's applyPoisonTick), so a re-applied
 * poison always ticks on the same 2/4/6/8/10 schedule from its own grant
 * turn, matching the existing "refresh resets strength/remainingTurns
 * fully" rule this phase preserves rather than changes.
 */
export function getPoisonTickProgress(state: GameState): number {
  return state.poisonTickProgress ?? 0;
}

/**
 * The player's current active effects, or [] if the field is absent
 * (existing GameState fixtures across the test suite predate this phase
 * and never set it — see types.ts's GameState.activeEffects doc comment).
 * Pure/side-effect-free; never mutates state.
 */
export function getActiveEffects(state: GameState): ActiveEffect[] {
  return state.activeEffects ?? [];
}

/** The active instance of `id`, or undefined if not currently active. */
export function getActiveEffect(state: GameState, id: EffectId): ActiveEffect | undefined {
  return getActiveEffects(state).find((effect) => effect.id === id);
}

/**
 * The effective bonus strength currently granted by `id` (0 if not
 * active). Combat resolution (turn.ts's applyPlayerAttackToEnemy) reads
 * this instead of ever touching Actor.attack directly, per
 * fixed_specification.attack_up_effect's "Actor.attack自体を書き換えない"
 * / "効果切れ時に補正値を差し引く方式にせず、攻撃時に有効効果から算出する".
 */
export function getEffectStrength(state: GameState, id: EffectId): number {
  return getActiveEffect(state, id)?.strength ?? 0;
}

/**
 * Whether `id` is currently at its maximum (freshly granted/refreshed)
 * remaining duration — used by banana's use_failure guard
 * (fixed_specification.banana.use_failure: "attack_upの残りターンがすで
 * に20の場合は使用失敗").
 */
export function isEffectAtMaxDuration(state: GameState, id: EffectId): boolean {
  const effect = getActiveEffect(state, id);
  if (!effect) return false;
  return effect.remainingTurns >= EFFECT_DEFINITIONS[id].duration;
}

/**
 * Grants `id` if not currently active, or refreshes its remaining
 * duration back to the definition's full duration if it is (never
 * stacking strength — fixed_specification.duplicate_and_refresh:
 * "強度を+10へ重複加算しない" / "複数のattack_upレコードを作らない").
 * Strength is always (re)written from the current definition. Callers
 * (applyBananaUse) are responsible for having already checked
 * isEffectAtMaxDuration and rejected the use before calling this — this
 * function itself has no failure path.
 */
export function grantOrRefreshEffect(state: GameState, id: EffectId): 'granted' | 'refreshed' {
  const def = EFFECT_DEFINITIONS[id];
  if (!state.activeEffects) {
    state.activeEffects = [];
  }
  const existing = state.activeEffects.find((effect) => effect.id === id);
  if (existing) {
    existing.strength = def.strength;
    existing.remainingTurns = def.duration;
    return 'refreshed';
  }
  state.activeEffects.push({ id, strength: def.strength, remainingTurns: def.duration });
  return 'granted';
}

/**
 * Advances every active effect's remaining duration by exactly 1 (once
 * per successful player turn, per fixed_specification.duration_and_
 * turn_boundary.progression — never per-action-type-duplicated), removing
 * any that reach 0. `skipIds` (Phase 12.2 addition; defaults to none)
 * lists effect ids whose decrement should be skipped this call — used
 * when that specific effect was freshly granted/refreshed by the very
 * action that just resolved this turn (banana's "バナナ使用ターン自体
 * ではattack_upの残りターンを減らさない" and the slow trap's "罠発動
 * ターン自体では残り10を9へ減らさない"), so a fresh/refreshed effect
 * still reads as its full duration for this turn's HUD/next reads. Any
 * other simultaneously-active effect not named in `skipIds` still
 * decrements normally this same call (fixed_specification.compatibility.
 * attack_up's "罠発動ターンの減算除外はmovement_slowだけに適用する / その
 * ターンに既存attack_upが有効なら、attack_upは既存規則どおり減算する") —
 * this is why the skip is a per-effect id list rather than an
 * all-or-nothing call-level skip. Returns the ids that expired this call
 * so the caller (turn.ts's processTurn) can push a single
 * 'effect_expired' event per expiry. Determining which ids belong in
 * `skipIds` for a given turn is the caller's responsibility, not this
 * function's, since this function has no way to know which turn it's
 * being called for.
 */
export function advanceEffectDurations(state: GameState, skipIds: EffectId[] = []): EffectId[] {
  const effects = state.activeEffects ?? [];
  const expired: EffectId[] = [];
  for (const effect of effects) {
    if (skipIds.includes(effect.id)) continue;
    effect.remainingTurns -= 1;
  }
  state.activeEffects = effects.filter((effect) => {
    if (effect.remainingTurns <= 0) {
      expired.push(effect.id);
      return false;
    }
    return true;
  });
  return expired;
}

/**
 * Explicitly removes every activeEffect record with id `id` (Phase 12.4
 * status-ailment removal foundation), distinct from advanceEffectDurations'
 * natural-expiry removal — callers must push their own 'effect_removed'
 * event (never 'effect_expired') for this, since which is correct
 * depends on *why* the effect ended, which this function has no way to
 * know. Removes ALL matching records if more than one somehow exists
 * (defensive; grantOrRefreshEffect never actually creates duplicates,
 * but this function doesn't rely on that invariant —
 * status_ailment_model.requirements's "同じEffectIdが不正に複数存在する
 * 場合は対象をすべて削除する"). Returns 'removed' if at least one
 * matching record was found and removed, or 'not_present' if none was
 * active. This operates only on activeEffects — see removeStatusAilment
 * below for the unified entry point that also covers the two special-
 * status ailments (spider_web/petrification) living outside
 * activeEffects. This is the *only* sanctioned way to mutate
 * state.activeEffects for removal purposes — turn.ts must never splice/
 * filter the array directly (implementation_policy's "状態異常解除処理を
 * activeEffects配列や専用状態を無秩序に直接変更しない").
 */
export function removeEffect(state: GameState, id: EffectId): 'removed' | 'not_present' {
  const effects = state.activeEffects ?? [];
  const hadEffect = effects.some((effect) => effect.id === id);
  state.activeEffects = effects.filter((effect) => effect.id !== id);
  return hadEffect ? 'removed' : 'not_present';
}

/**
 * Every currently-implemented status ailment id (Phase 12.4
 * classification), spanning both activeEffects-backed ids (poison,
 * movement_slow) and the two special-status ids living on
 * Actor.slowed/Actor.petrified instead (spider_web, petrification).
 * Deliberately excludes 'attack_up' — a beneficial effect, not an
 * ailment (status_ailment_model.requirements's "万能薬の対象を名前の
 * 否定判定で決めない" / "解除対象を明示的な一覧または分類として定義す
 * る": this array — an explicit allowlist — is that definition, not
 * "every EffectId except attack_up"). Panacea's cure logic
 * (turn.ts's applyPanaceaUse) iterates this array via
 * removeStatusAilment rather than re-deriving membership itself.
 * Extending this array (plus removeStatusAilment's switch and, for an
 * activeEffects-backed addition, nothing further — for a special-status
 * addition, a new Actor field and a new branch below) is how a future
 * status ailment gets added to panacea's coverage.
 */
export const STATUS_AILMENT_IDS: StatusAilmentId[] = ['poison', 'movement_slow', 'spider_web', 'petrification'];

/**
 * Removes the player's spider-web slowed status (enemy-behavior-02) if
 * currently set. Distinct data shape from activeEffects (a plain
 * Actor.slowed boolean, not an ActiveEffect record — see types.ts's
 * Actor.slowed doc comment), so this has its own small removal function
 * rather than going through removeEffect. Returns 'removed' if it was
 * active, 'not_present' otherwise.
 */
export function removeSpiderWebSlow(state: GameState): 'removed' | 'not_present' {
  if (state.player.slowed) {
    state.player.slowed = false;
    return 'removed';
  }
  return 'not_present';
}

/**
 * Removes the player's petrified status (phase-06-cockatrice-petrifying-
 * gaze) if currently set. Same reasoning as removeSpiderWebSlow — a
 * plain Actor.petrified boolean, not an activeEffects record. Returns
 * 'removed' if it was active, 'not_present' otherwise. Callers that need
 * "does removing this also cancel this turn's forced petrified skip"
 * semantics (turn.ts's applyPlayerAction petrified-branch) handle that
 * distinction themselves — this function only ever touches the flag.
 */
export function removePetrification(state: GameState): 'removed' | 'not_present' {
  if (state.player.petrified) {
    state.player.petrified = false;
    return 'removed';
  }
  return 'not_present';
}

/**
 * The single common entry point for removing any status ailment
 * (Phase 12.4), regardless of whether it's backed by activeEffects
 * (poison, movement_slow) or a special Actor field (spider_web,
 * petrification) — turn.ts's applyAntidoteUse/applyPanaceaUse call only
 * this function (never removeEffect/removeSpiderWebSlow/
 * removePetrification directly, though those remain exported for direct
 * use where only one specific ailment kind is ever relevant), so callers
 * never need their own id-based dispatch logic. Returns 'removed' or
 * 'not_present' exactly like the functions it delegates to.
 */
export function removeStatusAilment(state: GameState, id: StatusAilmentId): 'removed' | 'not_present' {
  if (id === 'spider_web') return removeSpiderWebSlow(state);
  if (id === 'petrification') return removePetrification(state);
  return removeEffect(state, id);
}
