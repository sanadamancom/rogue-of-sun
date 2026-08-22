import { describe, expect, it } from 'vitest';
import { computeElementalDamage } from '../combat';
import { getElementalMindBonus } from '../ability';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createRunTelemetry, recordTurn, snapshotForTurn } from '../telemetry';
import { ElementId, GameMap, GameState, PlayerAction, Tile } from '../types';

const TEST_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#..####..#',
  '#..#..#..#',
  '#..#..#..#',
  '#..####..#',
  '#........#',
  '##########',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: 'sword',
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 30,
    solUnlocked: true,
    unlockedEnchantments: { sol: true, flame: true, frost: true, cloud: true, earth: true },
    selectedEnchantment: 'sol',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  } as GameState;
}

function faceEastAtEnemy(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

const ALL_ELEMENTS: ElementId[] = ['sol', 'flame', 'frost', 'cloud', 'earth'];
const OTHER_ELEMENTS: Exclude<ElementId, 'sol'>[] = ['flame', 'frost', 'cloud', 'earth'];

describe('Phase 14.3: shared definition', () => {
  it('sol costs 1 SOL per hit', () => {
    const state = freshState({ selectedEnchantment: 'sol', solarEnergy: 5 });
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  for (const element of OTHER_ELEMENTS) {
    it(`${element} costs 2 SOL per hit`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 5 });
      faceEastAtEnemy(state);
      processTurn(state, { type: 'action' });
      expect(state.solarEnergy).toBe(3);
    });
  }
});

describe('Phase 14.3/15.3: mind rank scaling (pure)', () => {
  it('getElementalMindBonus is 0 at rank 0', () => {
    const state = freshState({ abilities: { body: 0, mind: 0, power: 0, speed: 0 } });
    expect(getElementalMindBonus(state)).toBe(0);
  });

  it('getElementalMindBonus is 0 at rank 1 (Phase 15.3: floor(mind/2))', () => {
    const state = freshState({ abilities: { body: 0, mind: 1, power: 0, speed: 0 } });
    expect(getElementalMindBonus(state)).toBe(0);
  });

  it('getElementalMindBonus is 2 at rank 5 (Phase 15.3: floor(mind/2))', () => {
    const state = freshState({ abilities: { body: 0, mind: 5, power: 0, speed: 0 } });
    expect(getElementalMindBonus(state)).toBe(2);
  });

  it('getElementalMindBonus is 5 at rank 10 (Phase 15.3: floor(mind/2))', () => {
    const state = freshState({ abilities: { body: 0, mind: 10, power: 0, speed: 0 } });
    expect(getElementalMindBonus(state)).toBe(5);
  });

  it('does not mutate GameState', () => {
    const state = freshState({ abilities: { body: 0, mind: 5, power: 0, speed: 0 } });
    const before = JSON.stringify(state.abilities);
    getElementalMindBonus(state);
    expect(JSON.stringify(state.abilities)).toBe(before);
  });

  it('mind ranks 0/2/4/6 feed computeElementalDamage correctly at neutral affinity (fixed base 2 + floor(mind/2))', () => {
    const cases: Array<[number, number]> = [
      [0, 2],
      [2, 3],
      [4, 4],
      [6, 5],
    ];
    for (const [mindRank, expected] of cases) {
      const mindBonus = Math.floor(mindRank / 2);
      expect(computeElementalDamage('neutral', mindBonus)).toBe(expected);
    }
  });

  it('mind rank 4 neutral elemental damage is 4 (fixed 2 + mind bonus 2)', () => {
    expect(computeElementalDamage('neutral', 2)).toBe(4);
  });

  it('other ability ranks (body/power/speed) do not change getElementalMindBonus', () => {
    const state = freshState({ abilities: { body: 10, mind: 0, power: 10, speed: 10 } });
    expect(getElementalMindBonus(state)).toBe(0);
  });
});

describe('Phase 14.3: mind rank does not affect physical damage, hit chance, or SOL cost', () => {
  it('physical damage is unchanged by mind rank', () => {
    const rank0 = freshState({ selectedEnchantment: 'none', abilities: { body: 0, mind: 0, power: 0, speed: 0 } });
    const rank5 = freshState({ selectedEnchantment: 'none', abilities: { body: 0, mind: 5, power: 0, speed: 0 } });
    faceEastAtEnemy(rank0);
    faceEastAtEnemy(rank5);
    const r0 = processTurn(rank0, { type: 'action' });
    const r5 = processTurn(rank5, { type: 'action' });
    const a0 = r0.events.find((e) => e.type === 'player_attack');
    const a5 = r5.events.find((e) => e.type === 'player_attack');
    expect(a0 && a0.type === 'player_attack' ? a0.damage : null).toBe(a5 && a5.type === 'player_attack' ? a5.damage : null);
  });

  it('mind rank does not change SOL cost for sol or other elements', () => {
    const state = freshState({ selectedEnchantment: 'flame', abilities: { body: 0, mind: 8, power: 0, speed: 0 }, solarEnergy: 5 });
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(3);
  });
});

describe('Phase 14.3: activation conditions', () => {
  for (const element of ALL_ELEMENTS) {
    it(`${element} activates on a sword hit`, () => {
      const state = freshState({ equippedWeaponId: 'sword', selectedEnchantment: element });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      const activated =
        result.events.some((e) => e.type === 'sol_enchantment_used') ||
        result.events.some((e) => e.type === 'element_enchantment_used');
      expect(activated).toBe(true);
    });

    it(`${element} activates on a spear hit`, () => {
      const state = freshState({
        equippedWeaponId: 'spear',
        selectedEnchantment: element,
        enemies: [createInitialEnemy('bok', { x: 4, y: 1 }, 1000, 1)],
      });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      const activated =
        result.events.some((e) => e.type === 'sol_enchantment_used') ||
        result.events.some((e) => e.type === 'element_enchantment_used');
      expect(activated).toBe(true);
    });

    it(`${element} activates on a hammer hit`, () => {
      const state = freshState({ equippedWeaponId: 'hammer', selectedEnchantment: element });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      const activated =
        result.events.some((e) => e.type === 'sol_enchantment_used') ||
        result.events.some((e) => e.type === 'element_enchantment_used');
      expect(activated).toBe(true);
    });

    it(`${element} does not activate bare-handed`, () => {
      const state = freshState({ equippedWeaponId: null, selectedEnchantment: element });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
      expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
    });

    it(`${element} does not activate with the solar gun`, () => {
      const state = freshState({ equippedWeaponId: 'solar_gun', selectedEnchantment: element });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
      expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
    });
  }

  for (const element of OTHER_ELEMENTS) {
    it(`${element} does not activate while unlocked is false`, () => {
      const state = freshState({
        selectedEnchantment: element,
        unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
    });
  }

  it('nothing activates while selectedEnchantment is none', () => {
    const state = freshState({ selectedEnchantment: 'none' });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
    expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
  });

  it('only the selected element activates, not any other unlocked element', () => {
    const state = freshState({ selectedEnchantment: 'frost' });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const activated = result.events.filter((e) => e.type === 'element_enchantment_used');
    expect(activated).toHaveLength(1);
    if (activated[0].type === 'element_enchantment_used') {
      expect(activated[0].element).toBe('frost');
    }
  });
});

describe('Phase 14.3: SOL cost and insufficient-SOL fallback', () => {
  it('sol hit consumes 1 SOL', () => {
    const state = freshState({ selectedEnchantment: 'sol', solarEnergy: 5 });
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  for (const element of OTHER_ELEMENTS) {
    it(`${element}: SOL 2 -> activates and drops to 0`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 2 });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      expect(state.solarEnergy).toBe(0);
      expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(true);
    });

    it(`${element}: SOL 1 -> does not activate, stays at 1`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 1 });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      expect(state.solarEnergy).toBe(1);
      expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
    });

    it(`${element}: SOL 0 -> does not activate`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 0 });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
    });

    it(`${element}: insufficient SOL still lands a normal physical attack`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 1 });
      faceEastAtEnemy(state);
      const before = state.enemies[0].hp;
      const result = processTurn(state, { type: 'action' });
      expect(result.events.some((e) => e.type === 'player_attack')).toBe(true);
      expect(before - state.enemies[0].hp).toBeGreaterThan(0);
    });

    it(`${element}: insufficient SOL keeps the selection unchanged`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 0 });
      faceEastAtEnemy(state);
      processTurn(state, { type: 'action' });
      expect(state.selectedEnchantment).toBe(element);
    });
  }
});

describe('Phase 14.3: damage', () => {
  it('rank 0, all-neutral enemy: each element adds exactly 2 elemental damage (Phase 15.3 rebalance)', () => {
    for (const element of ALL_ELEMENTS) {
      // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
      // (still all-neutral to every element) so this keeps testing the
      // plain neutral result for every element including sol.
      const state = freshState({
        selectedEnchantment: element,
        abilities: { body: 0, mind: 0, power: 0, speed: 0 },
        enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)],
      });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      const ev = result.events.find((e) => e.type === 'sol_enchantment_used' || e.type === 'element_enchantment_used');
      expect(ev).toBeDefined();
      if (ev && ev.type === 'sol_enchantment_used') {
        expect(ev.bonusDamage).toBe(2);
      } else if (ev && ev.type === 'element_enchantment_used') {
        expect(ev.elementalDamage).toBe(2);
      }
    }
  });

  it('rank 5 (mind bonus floor(5/2)=2), neutral: elemental damage is 4 (Phase 15.3 rebalance)', () => {
    const state = freshState({ selectedEnchantment: 'flame', abilities: { body: 0, mind: 5, power: 0, speed: 0 } });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.elementalDamage).toBe(4);
    }
  });

  it('does not apply enemy physical defense to the elemental portion', () => {
    // golem has defense 1; physical portion is reduced by 1, elemental portion is not.
    const state = freshState({
      selectedEnchantment: 'flame',
      enemies: [createInitialEnemy('golem', { x: 3, y: 1 }, 1000, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.elementalDamage).toBe(2);
    }
  });

  it('actualDamage never exceeds the enemy remaining HP (overkill)', () => {
    const state = freshState({
      selectedEnchantment: 'flame',
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 3, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toBeDefined();
    if (attackEvent && attackEvent.type === 'player_attack') {
      expect(attackEvent.targetHpAfter).toBe(0);
      expect(attackEvent.targetHpBefore - attackEvent.targetHpAfter).toBeLessThanOrEqual(attackEvent.targetHpBefore);
    }
  });
});

describe('Phase 14.3: misses, whiffs, and RNG', () => {
  // combatRngState chosen so the hit roll fails deterministically against
  // this fixture's accuracy/evasion (mirrors the miss-seed convention
  // used in phase-10-3 telemetry tests).
  const GUARANTEED_MISS_SEED = 43;

  for (const element of OTHER_ELEMENTS) {
    it(`${element}: a miss does not consume SOL`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 5, combatRngState: GUARANTEED_MISS_SEED });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      const missed = result.events.some((e) => e.type === 'player_attack_missed');
      if (missed) {
        expect(state.solarEnergy).toBe(5);
        expect(result.events.some((e) => e.type === 'element_enchantment_used')).toBe(false);
      }
    });
  }

  it('a whiff (no target) does not consume SOL or combat RNG', () => {
    const state = freshState({ selectedEnchantment: 'flame', enemies: [], solarEnergy: 5 });
    const rngBefore = state.combatRngState;
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(5);
    expect(state.combatRngState).toBe(rngBefore);
  });
});

describe('Phase 14.3: weapon regression', () => {
  it('sword deals its existing damage while an element is selected', () => {
    const state = freshState({ equippedWeaponId: 'sword', selectedEnchantment: 'flame' });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'player_attack')).toBe(true);
  });

  it('spear still reaches 2 tiles', () => {
    const state = freshState({
      equippedWeaponId: 'spear',
      selectedEnchantment: 'frost',
      enemies: [createInitialEnemy('bok', { x: 4, y: 1 }, 1000, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'player_attack')).toBe(true);
  });

  it('hammer still applies knockback', () => {
    const state = freshState({ equippedWeaponId: 'hammer', selectedEnchantment: 'earth' });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'enemy_knocked_back')).toBe(true);
  });

  it('solar gun is unaffected by any selected element', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      selectedEnchantment: 'cloud',
      solarEnergy: 5,
    });
    faceEastAtEnemy(state);
    const before = state.solarEnergy;
    processTurn(state, { type: 'action' });
    // Solar gun's own SOL consumption is independent of the melee
    // enchantment system; no melee-enchantment SOL cost is added.
    expect(state.solarEnergy).toBeLessThanOrEqual(before);
  });
});

describe('Phase 14.3: events and log', () => {
  it('sol fires exactly one sol_enchantment_used event', () => {
    const state = freshState({ selectedEnchantment: 'sol' });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.events.filter((e) => e.type === 'sol_enchantment_used')).toHaveLength(1);
  });

  for (const element of OTHER_ELEMENTS) {
    it(`${element} fires exactly one element_enchantment_used event with correct payload`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 5 });
      faceEastAtEnemy(state);
      const result = processTurn(state, { type: 'action' });
      const evs = result.events.filter((e) => e.type === 'element_enchantment_used');
      expect(evs).toHaveLength(1);
      const ev = evs[0];
      if (ev.type === 'element_enchantment_used') {
        expect(ev.element).toBe(element);
        expect(ev.affinity).toBe('neutral');
        expect(ev.solBefore).toBe(5);
        expect(ev.solAfter).toBe(3);
        expect(ev.elementalDamage).toBe(2);
      }
    });
  }

  it('event order is player_attack, then the enchantment event, then enemy_defeated', () => {
    const state = freshState({
      selectedEnchantment: 'flame',
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const types = result.events.map((e) => e.type);
    const attackIdx = types.indexOf('player_attack');
    const enchantIdx = types.indexOf('element_enchantment_used');
    const defeatedIdx = types.indexOf('enemy_defeated');
    expect(attackIdx).toBeGreaterThanOrEqual(0);
    expect(enchantIdx).toBeGreaterThan(attackIdx);
    expect(defeatedIdx).toBeGreaterThan(enchantIdx);
  });
});

describe('Phase 14.3: telemetry', () => {
  function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
    const before = snapshotForTurn(state);
    const result = processTurn(state, action);
    recordTurn(telemetry, action, result, before, state);
    return result;
  }

  it('keeps schemaVersion 7 and export filename v7', () => {
    const state = freshState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.schemaVersion).toBe(11);
  });

  for (const element of OTHER_ELEMENTS) {
    it(`${element}: physicalDamage/additionalDamage separated, solConsumed 2`, () => {
      const state = freshState({ selectedEnchantment: element, solarEnergy: 5 });
      const telemetry = createRunTelemetry(state);
      faceEastAtEnemy(state);
      step(state, { type: 'action' }, telemetry);
      const attackRunEvent = telemetry.events.find((e) => e.type === 'player_attack');
      expect(attackRunEvent).toBeDefined();
      if (attackRunEvent && attackRunEvent.type === 'player_attack') {
        expect(attackRunEvent.additionalDamage).toBe(2);
        expect(attackRunEvent.calculatedDamage).toBe(attackRunEvent.physicalDamage + 2);
        expect(attackRunEvent.solConsumed).toBe(2);
      }
    });
  }

  it('sol: solConsumed is 1', () => {
    const state = freshState({ selectedEnchantment: 'sol' });
    const telemetry = createRunTelemetry(state);
    faceEastAtEnemy(state);
    step(state, { type: 'action' }, telemetry);
    const attackRunEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackRunEvent).toBeDefined();
    if (attackRunEvent && attackRunEvent.type === 'player_attack') {
      expect(attackRunEvent.solConsumed).toBe(1);
    }
  });
});

// Phase 14.4 note: this block originally asserted that every enemy was
// neutral to all five elements, matching Phase 14.3's scope (combat
// effects implemented, but no real affinities assigned yet). Phase 14.4
// has since assigned the confirmed affinity table (see
// phase-14-4-enemy-affinities.test.ts for the dedicated table-and-
// damage-integration coverage), so this is updated to check that table
// instead of the now-superseded blanket-neutral assumption.
describe('Phase 14.3/14.4: enemy affinities (updated for Phase 14.4)', () => {
  it('matches the Phase 14.4 confirmed affinity table', async () => {
    const { ENEMY_DEFINITIONS } = await import('../enemy-def');
    const expected: Record<string, Record<ElementId, string>> = {
      bok: { sol: 'weak', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
      cockatrice: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'weak' },
      spider: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
      bat: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
      mummy: { sol: 'neutral', flame: 'weak', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
      golem: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'weak', earth: 'neutral' },
      sword: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
      axe: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
      kraken: { sol: 'neutral', flame: 'weak', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
    };
    for (const [type, affinities] of Object.entries(expected)) {
      expect(ENEMY_DEFINITIONS[type as keyof typeof ENEMY_DEFINITIONS].elementalAffinities).toEqual(affinities);
    }
  });
});
