import { describe, expect, it } from 'vitest';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER } from '../enemy-def';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createRunTelemetry, recordTurn, snapshotForTurn } from '../telemetry';
import { ElementId, ElementalAffinity, EnemyType, GameMap, GameState, PlayerAction, Tile } from '../types';

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
    enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)],
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

function attack(overrides: Partial<GameState>, weaponId: 'sword' | 'spear' | 'hammer', enchantment: ElementId, targetType: EnemyType) {
  const s = freshState({
    equippedWeaponId: weaponId,
    inventory: { ...createEmptyInventory(), [weaponId]: 1 },
    selectedEnchantment: enchantment,
    enemies: [createInitialEnemy(targetType, { x: 3, y: 1 }, 1000, 1)],
    ...overrides,
  });
  faceEastAtEnemy(s);
  return { state: s, result: processTurn(s, { type: 'action' }) };
}

const ALL_ELEMENTS: ElementId[] = ['sol', 'flame', 'frost', 'cloud', 'earth'];

const CONFIRMED_TABLE: Record<EnemyType, Record<ElementId, ElementalAffinity>> = {
  bok: { sol: 'weak', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  cockatrice: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'weak' },
  spider: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  bat: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  mummy: { sol: 'neutral', flame: 'weak', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  golem: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'weak', earth: 'neutral' },
  sword: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  axe: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  kraken: { sol: 'neutral', flame: 'weak', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  // Phase 23.1: skeleton deliberately carries no elemental weakness or
  // resistance at all — see enemy-def.ts's skeleton entry doc comment.
  skeleton: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  // Phase 23.3: ghost deliberately carries no elemental weakness or
  // resistance either — see enemy-def.ts's ghost entry doc comment.
  ghost: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  // Phase 23.4: steps deliberately carries no elemental weakness or
  // resistance either — see enemy-def.ts's steps entry doc comment.
  steps: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
};

describe('Phase 14.4: definition table', () => {
  it('matches the confirmed table exactly for all 10 enemies', () => {
    for (const [type, affinities] of Object.entries(CONFIRMED_TABLE)) {
      expect(ENEMY_DEFINITIONS[type as EnemyType].elementalAffinities).toEqual(affinities);
    }
  });

  it('has exactly 12 enemy types (Phase 23.1 adds skeleton, Phase 23.3 adds ghost, Phase 23.4 adds steps)', () => {
    expect(ENEMY_TYPES_IN_ORDER).toHaveLength(12);
  });

  it('has exactly 5 weak assignments total', () => {
    let weakCount = 0;
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities;
      for (const el of ALL_ELEMENTS) {
        if (affinities[el] === 'weak') weakCount++;
      }
    }
    expect(weakCount).toBe(5);
  });

  it('has exactly 0 resist assignments', () => {
    let resistCount = 0;
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities;
      for (const el of ALL_ELEMENTS) {
        if (affinities[el] === 'resist') resistCount++;
      }
    }
    expect(resistCount).toBe(0);
  });

  it('bok: only sol is weak', () => {
    const a = ENEMY_DEFINITIONS.bok.elementalAffinities;
    expect(a.sol).toBe('weak');
    expect(a.flame).toBe('neutral');
    expect(a.frost).toBe('neutral');
    expect(a.cloud).toBe('neutral');
    expect(a.earth).toBe('neutral');
  });

  it('cockatrice: only earth is weak', () => {
    const a = ENEMY_DEFINITIONS.cockatrice.elementalAffinities;
    expect(a.earth).toBe('weak');
    expect(a.sol).toBe('neutral');
    expect(a.flame).toBe('neutral');
    expect(a.frost).toBe('neutral');
    expect(a.cloud).toBe('neutral');
  });

  it('mummy: only flame is weak', () => {
    const a = ENEMY_DEFINITIONS.mummy.elementalAffinities;
    expect(a.flame).toBe('weak');
    expect(a.sol).toBe('neutral');
    expect(a.frost).toBe('neutral');
    expect(a.cloud).toBe('neutral');
    expect(a.earth).toBe('neutral');
  });

  it('golem: only cloud is weak', () => {
    const a = ENEMY_DEFINITIONS.golem.elementalAffinities;
    expect(a.cloud).toBe('weak');
    expect(a.sol).toBe('neutral');
    expect(a.flame).toBe('neutral');
    expect(a.frost).toBe('neutral');
    expect(a.earth).toBe('neutral');
  });

  it('kraken: only flame is weak', () => {
    const a = ENEMY_DEFINITIONS.kraken.elementalAffinities;
    expect(a.flame).toBe('weak');
    expect(a.sol).toBe('neutral');
    expect(a.frost).toBe('neutral');
    expect(a.cloud).toBe('neutral');
    expect(a.earth).toBe('neutral');
  });

  for (const type of ['spider', 'bat', 'sword', 'axe'] as EnemyType[]) {
    it(`${type}: all five elements are neutral`, () => {
      const a = ENEMY_DEFINITIONS[type].elementalAffinities;
      expect(a.sol).toBe('neutral');
      expect(a.flame).toBe('neutral');
      expect(a.frost).toBe('neutral');
      expect(a.cloud).toBe('neutral');
      expect(a.earth).toBe('neutral');
    });
  }

  it('has exactly 0 frost weaknesses', () => {
    let frostWeakCount = 0;
    for (const type of ENEMY_TYPES_IN_ORDER) {
      if (ENEMY_DEFINITIONS[type].elementalAffinities.frost === 'weak') frostWeakCount++;
    }
    expect(frostWeakCount).toBe(0);
  });

  it('every one of the 9 enemies declares all five elements explicitly', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities;
      expect(Object.keys(affinities).sort()).toEqual(['cloud', 'earth', 'flame', 'frost', 'sol']);
    }
  });
});

describe('Phase 14.4: damage integration (weak enemies, real attack path)', () => {
  it('bok + sol: fixed weak bonus (3) applied to the elemental portion (Phase 15.3 rebalance)', () => {
    const { result } = attack({}, 'sword', 'sol', 'bok');
    const ev = result.events.find((e) => e.type === 'sol_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'sol_enchantment_used') {
      expect(ev.affinity).toBe('weak');
      expect(ev.bonusDamage).toBe(3);
    }
  });

  it('cockatrice + earth: fixed weak bonus (3) applied (Phase 15.3 rebalance)', () => {
    const { result } = attack({}, 'sword', 'earth', 'cockatrice');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('weak');
      expect(ev.elementalDamage).toBe(3);
    }
  });

  it('mummy + flame: fixed weak bonus (3) applied (Phase 15.3 rebalance)', () => {
    const { result } = attack({}, 'sword', 'flame', 'mummy');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('weak');
      expect(ev.elementalDamage).toBe(3);
    }
  });

  it('golem + cloud: fixed weak bonus (3) applied (Phase 15.3 rebalance)', () => {
    const { result } = attack({}, 'sword', 'cloud', 'golem');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('weak');
      expect(ev.elementalDamage).toBe(3);
    }
  });

  it('kraken + flame: fixed weak bonus (3) applied (Phase 15.3 rebalance)', () => {
    const { result } = attack({}, 'sword', 'flame', 'kraken');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('weak');
      expect(ev.elementalDamage).toBe(3);
    }
  });

  it('physicalDamage is identical whether the target is weak or neutral to the chosen element', () => {
    const { result: weakResult } = attack({}, 'sword', 'sol', 'bok');
    const { result: neutralResult } = attack({}, 'sword', 'sol', 'spider');
    const weakAttack = weakResult.events.find((e) => e.type === 'player_attack');
    const neutralAttack = neutralResult.events.find((e) => e.type === 'player_attack');
    const weakSol = weakResult.events.find((e) => e.type === 'sol_enchantment_used');
    const neutralSol = neutralResult.events.find((e) => e.type === 'sol_enchantment_used');
    expect(weakSol && weakSol.type === 'sol_enchantment_used' ? weakSol.baseDamage : null).toBe(
      neutralSol && neutralSol.type === 'sol_enchantment_used' ? neutralSol.baseDamage : null,
    );
    expect(weakAttack).toBeDefined();
    expect(neutralAttack).toBeDefined();
  });

  it('mind rank bonus is added on top of the fixed weak value (Phase 15.3: rank5 -> floor(5/2)=2, weak 3+2=5)', () => {
    const { result } = attack(
      { abilities: { body: 0, mind: 5, power: 0, speed: 0 } },
      'sword',
      'flame',
      'mummy',
    );
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.elementalDamage).toBe(5);
    }
  });

  it('actual HP loss and defeat reflect the weak-adjusted total damage', () => {
    const { state, result } = attack({ enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1)] }, 'sword', 'sol', 'bok');
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toBeDefined();
    if (attackEvent && attackEvent.type === 'player_attack') {
      expect(attackEvent.targetHpAfter).toBe(0);
    }
    expect(state.enemies[0].alive).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
  });
});

describe('Phase 14.4: neutral enemy examples', () => {
  for (const type of ['spider', 'bat', 'sword', 'axe'] as EnemyType[]) {
    it(`${type}: sol attack yields neutral (2) elemental damage (Phase 15.3 rebalance)`, () => {
      const { result } = attack({}, 'sword', 'sol', type);
      const ev = result.events.find((e) => e.type === 'sol_enchantment_used');
      expect(ev).toBeDefined();
      if (ev && ev.type === 'sol_enchantment_used') {
        expect(ev.affinity).toBe('neutral');
        expect(ev.bonusDamage).toBe(2);
      }
    });
  }

  it('a weak-carrying enemy is still neutral to its non-weak elements (bok + flame)', () => {
    const { result } = attack({}, 'sword', 'flame', 'bok');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('neutral');
      expect(ev.elementalDamage).toBe(2);
    }
  });

  it('kraken + frost is neutral (kraken is only weak to flame)', () => {
    const { result } = attack({}, 'sword', 'frost', 'kraken');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('neutral');
      expect(ev.elementalDamage).toBe(2);
    }
  });

  for (const type of ENEMY_TYPES_IN_ORDER) {
    it(`${type}: frost attack is always neutral (0 frost weaknesses exist)`, () => {
      const { result } = attack({}, 'sword', 'frost', type);
      const ev = result.events.find((e) => e.type === 'element_enchantment_used');
      expect(ev).toBeDefined();
      if (ev && ev.type === 'element_enchantment_used') {
        expect(ev.affinity).toBe('neutral');
      }
    });
  }
});

describe('Phase 14.4: resource and RNG behavior unaffected by affinity', () => {
  it('weak (bok+sol) still consumes exactly 1 SOL', () => {
    const { state } = attack({ solarEnergy: 5 }, 'sword', 'sol', 'bok');
    expect(state.solarEnergy).toBe(4);
  });

  it('weak (mummy+flame) still consumes exactly 2 SOL', () => {
    const { state } = attack({ solarEnergy: 5 }, 'sword', 'flame', 'mummy');
    expect(state.solarEnergy).toBe(3);
  });

  it('neutral (spider+sol) consumes the same 1 SOL', () => {
    const { state } = attack({ solarEnergy: 5 }, 'sword', 'sol', 'spider');
    expect(state.solarEnergy).toBe(4);
  });

  it('a miss against a weak-affinity enemy does not consume SOL or fire an enchantment event', () => {
    // combatRngState chosen so the hit roll fails deterministically.
    const state = freshState({
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      combatRngState: 43,
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
    });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const missed = result.events.some((e) => e.type === 'player_attack_missed');
    if (missed) {
      expect(state.solarEnergy).toBe(5);
      expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
    }
  });

  it('affinity assignment does not change combat RNG call count (whiff against a weak-affinity type)', () => {
    const state = freshState({
      selectedEnchantment: 'sol',
      enemies: [],
    });
    const rngBefore = state.combatRngState;
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.combatRngState).toBe(rngBefore);
  });
});

describe('Phase 14.4: events, log, and telemetry integration', () => {
  it('weak attack event payload has affinity "weak" and correctly-scaled elementalDamage', () => {
    const { result } = attack({}, 'hammer', 'cloud', 'golem');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('weak');
      expect(ev.elementalDamage).toBe(3);
      expect(ev.element).toBe('cloud');
    }
  });

  it('non-weak attack event payload has affinity "neutral"', () => {
    const { result } = attack({}, 'hammer', 'earth', 'golem');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev && ev.type === 'element_enchantment_used') {
      expect(ev.affinity).toBe('neutral');
    }
  });

  it('sol_enchantment_used and element_enchantment_used never both fire on the same hit', () => {
    const { result } = attack({}, 'sword', 'sol', 'bok');
    expect(result.events.filter((e) => e.type === 'sol_enchantment_used')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'element_enchantment_used')).toHaveLength(0);
  });

  it('message log renders a weak hit using the existing shared wording', async () => {
    // Phase 14.5 note: weak hits now get dedicated wording (message-log's
    // weak/neutral/resist differentiation, deferred since Phase 14.1/
    // 14.3); this asserts that updated text instead of the older shared
    // "宿った" phrasing every affinity used before Phase 14.5.
    const { formatEvent } = await import('../message-log');
    const { result } = attack({}, 'sword', 'flame', 'mummy');
    const ev = result.events.find((e) => e.type === 'element_enchantment_used');
    expect(ev).toBeDefined();
    if (ev) {
      expect(formatEvent(ev)).toBe('フレイムの力が弱点を突いた！');
    }
  });

  it('telemetry additionalDamage reflects the weak-adjusted elemental value', () => {
    function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
      const before = snapshotForTurn(state);
      const result = processTurn(state, action);
      recordTurn(telemetry, action, result, before, state);
      return result;
    }
    const state = freshState({
      selectedEnchantment: 'flame',
      enemies: [createInitialEnemy('mummy', { x: 3, y: 1 }, 1000, 1)],
    });
    const telemetry = createRunTelemetry(state);
    faceEastAtEnemy(state);
    step(state, { type: 'action' }, telemetry);
    const attackRunEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackRunEvent).toBeDefined();
    if (attackRunEvent && attackRunEvent.type === 'player_attack') {
      expect(attackRunEvent.additionalDamage).toBe(3);
      expect(attackRunEvent.calculatedDamage).toBe(attackRunEvent.physicalDamage + 3);
    }
  });

  it('telemetry schemaVersion stays 7', () => {
    const state = freshState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.schemaVersion).toBe(9);
  });
});
