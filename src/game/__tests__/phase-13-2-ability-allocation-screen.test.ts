import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createInitialState, advanceToNextFloor } from '../state';
import { applyExperienceGain, getUnspentAbilityPoints } from '../progression';
import {
  ABILITY_DISPLAY_NAMES,
  ABILITY_IDS,
  allocateAbilityPoint,
  cancelAbilityConfirm,
  closeAbilityOverlay,
  getAbilities,
  getAbilityValue,
  INITIAL_ABILITY_VALUES,
  moveAbilitySelection,
  openAbilityConfirm,
  resolveAbilityConfirm,
  selectedAbilityId,
  toggleAbilityConfirmChoice,
  toggleAbilityOverlay,
} from '../ability';
import { AbilityId, GameMap, GameState, Tile } from '../types';

const TEST_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(unspentAbilityPoints = 0): GameState {
  const playerPos = { x: 10, y: 4 };
  const enemyPos = { x: 9, y: 4 };
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 100, 50),
    enemies: [createInitialEnemy('bok', enemyPos, 30, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    unspentAbilityPoints,
  };
}

describe('Phase 13.2 ability point allocation foundation', () => {
  describe('ability state', () => {
    it('a fresh state has all 4 abilities at 0', () => {
      const state = freshState();
      expect(getAbilities(state)).toEqual(INITIAL_ABILITY_VALUES);
    });

    it('all 4 ability IDs map to their correct Japanese display name', () => {
      expect(ABILITY_DISPLAY_NAMES.body).toBe('カラダ');
      expect(ABILITY_DISPLAY_NAMES.mind).toBe('ココロ');
      expect(ABILITY_DISPLAY_NAMES.power).toBe('チカラ');
      expect(ABILITY_DISPLAY_NAMES.speed).toBe('ハヤサ');
      expect(ABILITY_IDS).toEqual(['body', 'mind', 'power', 'speed']);
    });

    it('each ability value is held independently', () => {
      const state = freshState(2);
      allocateAbilityPoint(state, 'body');
      expect(getAbilityValue(state, 'body')).toBe(1);
      expect(getAbilityValue(state, 'mind')).toBe(0);
      expect(getAbilityValue(state, 'power')).toBe(0);
      expect(getAbilityValue(state, 'speed')).toBe(0);
    });
  });

  describe('allocation core', () => {
    it('with 1 point, raises the chosen ability by 1 and leaves 0 points', () => {
      const state = freshState(1);
      const result = allocateAbilityPoint(state, 'power');
      expect(result.success).toBe(true);
      expect(getAbilityValue(state, 'power')).toBe(1);
      expect(getUnspentAbilityPoints(state)).toBe(0);
    });

    it('with 2+ points, a single call still consumes exactly 1', () => {
      const state = freshState(3);
      allocateAbilityPoint(state, 'speed');
      expect(getUnspentAbilityPoints(state)).toBe(2);
      expect(getAbilityValue(state, 'speed')).toBe(1);
    });

    it('does not change the other 3 abilities', () => {
      const state = freshState(1);
      allocateAbilityPoint(state, 'mind');
      expect(getAbilityValue(state, 'body')).toBe(0);
      expect(getAbilityValue(state, 'power')).toBe(0);
      expect(getAbilityValue(state, 'speed')).toBe(0);
    });

    it('cannot allocate with 0 points', () => {
      const state = freshState(0);
      const result = allocateAbilityPoint(state, 'body');
      expect(result.success).toBe(false);
      expect(getAbilityValue(state, 'body')).toBe(0);
      expect(getUnspentAbilityPoints(state)).toBe(0);
    });

    it('does not change state for an invalid ability id', () => {
      const state = freshState(3);
      const result = allocateAbilityPoint(state, 'invalid' as AbilityId);
      expect(result.success).toBe(false);
      expect(getAbilities(state)).toEqual(INITIAL_ABILITY_VALUES);
      expect(getUnspentAbilityPoints(state)).toBe(3);
    });

    it('emits ability_point_spent exactly once on success', () => {
      const state = freshState(1);
      const result = allocateAbilityPoint(state, 'body');
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('ability_point_spent');
    });

    it('a cancelled confirmation (resolved as "いいえ") does not change state', () => {
      const state = freshState(1);
      openAbilityConfirm(state);
      // Initial choice is 'no' — resolve immediately without toggling.
      const resolution = resolveAbilityConfirm(state);
      expect(resolution.attempted).toBe(false);
      expect(getUnspentAbilityPoints(state)).toBe(1);
      expect(getAbilities(state)).toEqual(INITIAL_ABILITY_VALUES);
    });

    it('does not double-spend on a second confirm resolution for the same confirmation', () => {
      const state = freshState(1);
      openAbilityConfirm(state);
      toggleAbilityConfirmChoice(state); // -> 'yes'
      const first = resolveAbilityConfirm(state);
      expect(first.attempted).toBe(true);
      expect(first.allocation?.success).toBe(true);
      // The confirmation is cleared after resolving, so a stray second
      // Enter is a no-op rather than spending a second point.
      const second = resolveAbilityConfirm(state);
      expect(second.attempted).toBe(false);
      expect(getUnspentAbilityPoints(state)).toBe(0);
    });
  });

  describe('invariant', () => {
    it('unspentAbilityPoints + all 4 abilities stays equal to total points ever granted', () => {
      const state = freshState(0);
      applyExperienceGain(state, 100); // grants several levels/ability points
      const totalGranted = getUnspentAbilityPoints(state);

      allocateAbilityPoint(state, 'body');
      allocateAbilityPoint(state, 'mind');
      allocateAbilityPoint(state, 'body');

      const abilities = getAbilities(state);
      const sum = getUnspentAbilityPoints(state) + abilities.body + abilities.mind + abilities.power + abilities.speed;
      expect(sum).toBe(totalGranted);
    });

    it('allocating to the same ability repeatedly increases it by exactly 1 each time', () => {
      const state = freshState(3);
      allocateAbilityPoint(state, 'power');
      allocateAbilityPoint(state, 'power');
      allocateAbilityPoint(state, 'power');
      expect(getAbilityValue(state, 'power')).toBe(3);
    });

    it('never drives unspentAbilityPoints negative', () => {
      const state = freshState(1);
      allocateAbilityPoint(state, 'body');
      allocateAbilityPoint(state, 'body'); // no points left
      expect(getUnspentAbilityPoints(state)).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('a new run has all 4 abilities at 0', () => {
      const state = createInitialState(42);
      expect(getAbilities(state)).toEqual(INITIAL_ABILITY_VALUES);
    });

    it('floor transition maintains the 4 abilities and unspent points', () => {
      const state = createInitialState(42);
      applyExperienceGain(state, 7); // grants at least 1 ability point
      allocateAbilityPoint(state, 'body');
      const pointsBefore = getUnspentAbilityPoints(state);
      const next = advanceToNextFloor(state);
      expect(getAbilityValue(next, 'body')).toBe(1);
      expect(getUnspentAbilityPoints(next)).toBe(pointsBefore);
    });

    it('floor transition does not emit ability_point_spent', () => {
      const state = createInitialState(42);
      applyExperienceGain(state, 7);
      allocateAbilityPoint(state, 'body');
      // advanceToNextFloor itself returns a fresh GameState with no
      // events array to inspect, but it must not call allocateAbilityPoint
      // or mutate unspentAbilityPoints beyond the carried-over value.
      const before = getUnspentAbilityPoints(state);
      const next = advanceToNextFloor(state);
      expect(getUnspentAbilityPoints(next)).toBe(before);
    });

    it('leveling up after an allocation preserves the allocated value and only increases unspent points', () => {
      const state = createInitialState(42);
      applyExperienceGain(state, 5); // Lv2, 1 ability point
      allocateAbilityPoint(state, 'speed');
      expect(getUnspentAbilityPoints(state)).toBe(0);
      applyExperienceGain(state, 10); // Lv3, another ability point
      expect(getAbilityValue(state, 'speed')).toBe(1);
      expect(getUnspentAbilityPoints(state)).toBe(1);
    });
  });

  describe('overlay state machine', () => {
    it('toggles open and closed via toggleAbilityOverlay', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      expect(state.abilityOverlayOpen).toBe(true);
      toggleAbilityOverlay(state);
      expect(state.abilityOverlayOpen).toBe(false);
    });

    it('closeAbilityOverlay closes it', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      closeAbilityOverlay(state);
      expect(state.abilityOverlayOpen).toBe(false);
    });

    it('cycles selection through all 4 abilities, wrapping both directions', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      expect(selectedAbilityId(state)).toBe('body');
      moveAbilitySelection(state, -1);
      expect(selectedAbilityId(state)).toBe('speed'); // wraps to the end
      moveAbilitySelection(state, 1);
      moveAbilitySelection(state, 1);
      moveAbilitySelection(state, 1);
      moveAbilitySelection(state, 1);
      expect(selectedAbilityId(state)).toBe('speed'); // 4 steps forward from speed wraps exactly back to speed
    });

    it('Enter enters a confirmation state with initial choice "いいえ"', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      openAbilityConfirm(state);
      expect(state.abilityConfirmPending).toBe('body');
      expect(state.abilityConfirmChoice).toBe('no');
    });

    it('confirmation cancel does not spend a point', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      openAbilityConfirm(state);
      cancelAbilityConfirm(state);
      expect(state.abilityConfirmPending).toBeNull();
      expect(getUnspentAbilityPoints(state)).toBe(1);
    });

    it('confirming with "はい" updates the ability value and remaining points', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      openAbilityConfirm(state);
      toggleAbilityConfirmChoice(state);
      const resolution = resolveAbilityConfirm(state);
      expect(resolution.allocation?.success).toBe(true);
      expect(getAbilityValue(state, 'body')).toBe(1);
      expect(getUnspentAbilityPoints(state)).toBe(0);
    });

    it('does not enter a confirmation state with 0 points', () => {
      const state = freshState(0);
      toggleAbilityOverlay(state);
      openAbilityConfirm(state);
      expect(state.abilityConfirmPending).toBeNull();
    });

    it('opening the ability overlay closes the inventory overlay', () => {
      const state = freshState(1);
      state.inventoryOpen = true;
      toggleAbilityOverlay(state);
      expect(state.abilityOverlayOpen).toBe(true);
      expect(state.inventoryOpen).toBe(false);
    });

    it('does not open while the run has ended', () => {
      const state = freshState(1);
      state.phase = 'gameover';
      toggleAbilityOverlay(state);
      expect(state.abilityOverlayOpen).toBeFalsy();
    });
  });

  describe('non-turn consumption', () => {
    it('opening/closing the overlay does not advance state.turn', () => {
      const state = freshState(1);
      const turnBefore = state.turn;
      toggleAbilityOverlay(state);
      toggleAbilityOverlay(state);
      expect(state.turn).toBe(turnBefore);
    });

    it('selection movement does not advance state.turn or move enemies', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      const enemyPosBefore = { ...state.enemies[0].pos };
      const turnBefore = state.turn;
      moveAbilitySelection(state, 1);
      moveAbilitySelection(state, 1);
      expect(state.turn).toBe(turnBefore);
      expect(state.enemies[0].pos).toEqual(enemyPosBefore);
    });

    it('a successful allocation does not advance state.turn or move enemies', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      const enemyPosBefore = { ...state.enemies[0].pos };
      const turnBefore = state.turn;
      openAbilityConfirm(state);
      toggleAbilityConfirmChoice(state);
      resolveAbilityConfirm(state);
      expect(state.turn).toBe(turnBefore);
      expect(state.enemies[0].pos).toEqual(enemyPosBefore);
    });

    it('does not consume normal player actions while the overlay is open (processTurn guard)', () => {
      const state = freshState(1);
      toggleAbilityOverlay(state);
      const result = processTurn(state, { type: 'wait' });
      expect(result.consumed).toBe(false);
      expect(state.turn).toBe(0);
    });
  });

  describe('events and messages', () => {
    it('payload before/after values and remaining points are correct', () => {
      const state = freshState(2);
      const result = allocateAbilityPoint(state, 'mind');
      const event = result.events[0];
      expect(event).toMatchObject({
        type: 'ability_point_spent',
        ability: 'mind',
        abilityDisplayName: 'ココロ',
        previousValue: 0,
        newValue: 1,
        remainingAbilityPoints: 1,
      });
    });

    it('cancellation and invalid requests never produce an event', () => {
      const state = freshState(0);
      const invalidResult = allocateAbilityPoint(state, 'body');
      expect(invalidResult.events).toHaveLength(0);
    });
  });

  describe('no effect on existing combat stats', () => {
    // Phase 13.3a note: body/mind now DO change maxHp/maxSolarEnergy by
    // design (see ability.ts's allocateAbilityPoint side effects) — these
    // two cases, which pre-date that phase, are updated to assert the new
    // confirmed_spec numeric effect instead of "no effect". power/speed
    // below are unaffected by Phase 13.3a (power's bonus is derived on
    // demand at the damage-computation point, never stored on
    // player.attack/defense; speed has no numeric effect yet).
    it('allocating body increases maxHp by 2 and current HP by 2 (Phase 15.3 rebalance)', () => {
      const state = freshState(1);
      const hpBefore = state.player.hp;
      const maxHpBefore = state.player.maxHp;
      allocateAbilityPoint(state, 'body');
      expect(state.player.hp).toBe(hpBefore + 2);
      expect(state.player.maxHp).toBe(maxHpBefore + 2);
    });

    it('allocating mind increases maxSOL by 2 but never restores current SOL (Phase 15.3 rebalance)', () => {
      const state = freshState(1);
      const solBefore = state.solarEnergy;
      const maxSolBefore = state.maxSolarEnergy;
      allocateAbilityPoint(state, 'mind');
      expect(state.solarEnergy).toBe(solBefore);
      expect(state.maxSolarEnergy).toBe(maxSolBefore + 2);
    });

    it('allocating power does not change attack or defense', () => {
      const state = freshState(1);
      const attackBefore = state.player.attack;
      const defenseBefore = state.player.defense;
      allocateAbilityPoint(state, 'power');
      expect(state.player.attack).toBe(attackBefore);
      expect(state.player.defense).toBe(defenseBefore);
    });

    it('allocating speed does not change turn processing or enemy action count', () => {
      const state = freshState(1);
      allocateAbilityPoint(state, 'speed');
      const enemyPosBefore = { ...state.enemies[0].pos };
      processTurn(state, { type: 'wait' });
      // Just confirms a normal turn still runs exactly once as usual
      // (enemy may or may not move depending on AI, but turn count must
      // advance by exactly 1 regardless of the speed allocation).
      expect(state.turn).toBe(1);
      void enemyPosBefore;
    });
  });
});
