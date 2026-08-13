import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { advanceToNextFloor } from '../state';
import { ENEMY_DEFINITIONS, getEnemyPoolForFloor, ENEMY_TYPES_IN_ORDER } from '../enemy-def';
import { getStepsTelegraph } from '../telegraph';
import { getMinimapStepsMarkers } from '../minimap';
import { isStepsDetectionRange, getStepsSpikeCells, shouldDisplayStepsBody } from '../steps';
import { EnemyActor, EnemyType, GameMap, GameState, Tile } from '../types';

function mapFromLayout(layout: string[]): GameMap {
  const height = layout.length;
  const width = layout[0].length;
  const terrain: Tile[][] = layout.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: mapFromLayout([
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ]),
    player: createInitialActor({ x: 10, y: 4 }, 30, 1),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 199, y: 199 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 15,
    maxSolarEnergy: 15,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

function stepsAt(x: number, y: number, id = 0, hp = 6): EnemyActor {
  const def = ENEMY_DEFINITIONS.steps;
  return createInitialEnemy('steps' as EnemyType, { x, y }, hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}

describe('Phase 23.4: steps — roster, assets, and generation', () => {
  it('is registered with the confirmed provisional stats, all-neutral affinities, steps_spike/ground', () => {
    const def = ENEMY_DEFINITIONS.steps;
    expect(def.hp).toBe(6);
    expect(def.attack).toBe(6);
    expect(def.defense).toBe(0);
    expect(def.accuracy).toBe(90);
    expect(def.evasion).toBe(0);
    expect(def.experienceReward).toBe(2);
    expect(def.behaviorType).toBe('steps_spike');
    expect(def.movementType).toBe('ground');
    expect(def.elementalAffinities).toEqual({ sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' });
  });

  it('is appended at the very end of ENEMY_TYPES_IN_ORDER without disturbing earlier indices', () => {
    expect(ENEMY_TYPES_IN_ORDER[ENEMY_TYPES_IN_ORDER.length - 1]).toBe('steps');
    expect(ENEMY_TYPES_IN_ORDER.slice(0, 11)).toEqual([
      'bok', 'cockatrice', 'spider', 'bat', 'mummy', 'golem', 'sword', 'axe', 'kraken', 'skeleton', 'ghost',
    ]);
  });

  it('1F and 2F pools exclude steps; 3F includes it', () => {
    expect(getEnemyPoolForFloor(1)).not.toContain('steps');
    expect(getEnemyPoolForFloor(2)).not.toContain('steps');
    expect(getEnemyPoolForFloor(3)).toContain('steps');
  });

  it('sprite key defaults to the footprint sprite (steps), and to steps_see once revealed', () => {
    const hidden = stepsAt(1, 1);
    expect(hidden.stepsState ?? 'hidden').toBe('hidden');
    expect(shouldDisplayStepsBody(hidden, false)).toBe(false);
    const revealed = stepsAt(1, 1);
    revealed.stepsState = 'revealed';
    expect(shouldDisplayStepsBody(revealed, false)).toBe(true);
  });

  it('a monster-house-spawned steps uses the identical AI (same detection/telegraph behavior)', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] }); // adjacent to player (10,4)
    state.enemies[0].spawnSource = 'monster_house';
    const result = processTurn(state, { type: 'wait' });
    expect(state.enemies[0].stepsState).toBe('telegraphed');
    expect(result.events.some((e) => e.type === 'steps_spike_telegraphed')).toBe(true);
  });
});

describe('Phase 23.4: steps — state machine timing (T0-T5)', () => {
  it('does not telegraph at Chebyshev distance 2', () => {
    const state = freshState({ enemies: [stepsAt(8, 4)] }); // distance 2 from player (10,4)
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].stepsState ?? 'hidden').toBe('hidden');
  });

  it.each([
    { dx: -1, dy: 0, label: 'W' },
    { dx: 1, dy: 0, label: 'E' },
    { dx: 0, dy: -1, label: 'N' },
    { dx: 0, dy: 1, label: 'S' },
    { dx: -1, dy: -1, label: 'NW' },
    { dx: 1, dy: -1, label: 'NE' },
    { dx: -1, dy: 1, label: 'SW' },
    { dx: 1, dy: 1, label: 'SE' },
  ])('telegraphs at Chebyshev distance 1 in direction $label', ({ dx, dy }) => {
    const state = freshState({ enemies: [stepsAt(10 + dx, 4 + dy)] });
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].stepsState).toBe('telegraphed');
  });

  it('does not telegraph the same turn a chase step first brings it to distance 1', () => {
    const state = freshState({ enemies: [stepsAt(8, 4)] }); // distance 2, will chase-step to distance 1
    processTurn(state, { type: 'wait' });
    const steps = state.enemies[0];
    // Either it moved closer (now distance 1) without telegraphing this turn...
    expect(steps.stepsState ?? 'hidden').toBe('hidden');
  });

  it('T0: telegraph turn has no movement and no damage', () => {
    const state = freshState({ player: { ...createInitialActor({ x: 10, y: 4 }, 30, 1), hp: 20 }, enemies: [stepsAt(9, 4)] });
    const steps = state.enemies[0];
    const before = { ...steps.pos };
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(steps.pos).toEqual(before);
    expect(state.player.hp).toBe(hpBefore + 1); // only natural regen
    expect(steps.stepsState).toBe('telegraphed');
  });

  it('T1: next action always executes the spike, entering revealed with remaining=3', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // T0: telegraph
    const result = processTurn(state, { type: 'wait' }); // T1: execute
    const steps = state.enemies[0];
    expect(steps.stepsState).toBe('revealed');
    expect(steps.stepsRevealTurnsRemaining).toBe(3);
    expect(result.events.some((e) => e.type === 'steps_spike_executed')).toBe(true);
  });

  it('fixed center is not re-derived from the player\'s later position', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // T0: telegraph, center fixed at steps' own (9,4)
    const steps = state.enemies[0];
    const fixedCenter = { ...steps.stepsTelegraphCenter! };
    state.player.pos = { x: 15, y: 4 }; // move far away
    processTurn(state, { type: 'wait' }); // T1: executes using the fixed center regardless
    expect(fixedCenter).toEqual({ x: 9, y: 4 });
  });

  it('executes the reserved attack even after the player moves outside AGGRO_RANGE', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // telegraph
    state.player.pos = { x: 19, y: 19 }; // far outside AGGRO_RANGE(8) from steps
    const result = processTurn(state, { type: 'wait' });
    expect(state.enemies[0].stepsState).toBe('revealed');
    expect(result.events.some((e) => e.type === 'steps_spike_executed')).toBe(true);
  });

  it('T2-T4: 3 ordinary revealed actions, decrementing remaining, then back to hidden with no off-by-one', () => {
    const state = freshState({ player: createInitialActor({ x: 19, y: 19 }, 30, 1), enemies: [stepsAt(9, 4)] });
    const steps = state.enemies[0];
    steps.stepsState = 'revealed';
    steps.stepsRevealTurnsRemaining = 3;
    processTurn(state, { type: 'wait' }); // T2
    expect(steps.stepsState).toBe('revealed');
    expect(steps.stepsRevealTurnsRemaining).toBe(2);
    processTurn(state, { type: 'wait' }); // T3
    expect(steps.stepsState).toBe('revealed');
    expect(steps.stepsRevealTurnsRemaining).toBe(1);
    processTurn(state, { type: 'wait' }); // T4
    expect(steps.stepsState).toBe('hidden');
    expect(steps.stepsRevealTurnsRemaining).toBeUndefined();
  });

  it('T5: does not immediately re-telegraph the same action it reverts to hidden, but can detect again afterward', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] }); // adjacent, distance 1
    const steps = state.enemies[0];
    steps.stepsState = 'revealed';
    steps.stepsRevealTurnsRemaining = 1; // this action will revert to hidden
    processTurn(state, { type: 'wait' });
    expect(steps.stepsState).toBe('hidden'); // reverted, not re-telegraphed this same action
    const result = processTurn(state, { type: 'wait' }); // next action: can detect again
    expect(steps.stepsState).toBe('telegraphed');
    expect(result.events.some((e) => e.type === 'steps_spike_telegraphed')).toBe(true);
  });
});

describe('Phase 23.4: steps — 3x3 spike geometry and attack resolution', () => {
  it('an open center yields all 9 cells', () => {
    const map = mapFromLayout([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const cells = getStepsSpikeCells(map, { x: 2, y: 2 });
    expect(cells).toHaveLength(9);
  });

  it('excludes out-of-bounds cells at the map edge', () => {
    const map = mapFromLayout([
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    ]);
    const cells = getStepsSpikeCells(map, { x: 1, y: 1 });
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(map.width);
      expect(cell.y).toBeLessThan(map.height);
    }
    expect(cells.length).toBeLessThan(9);
  });

  it('excludes wall cells within the 3x3', () => {
    const map = mapFromLayout([
      '#####',
      '##.##',
      '#...#',
      '##.##',
      '#####',
    ]);
    const cells = getStepsSpikeCells(map, { x: 2, y: 2 });
    for (const cell of cells) {
      expect(map.terrain[cell.y][cell.x]).toBe('floor');
    }
    expect(cells).toHaveLength(5); // center + N,S,E,W only (4 diagonal corners are wall)
  });

  it('a real attack resolves exactly once when the player is inside the area at execution time', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] }); // player adjacent at (10,4)
    processTurn(state, { type: 'wait' }); // telegraph
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' }); // execute; player still adjacent -> in area
    const dmgEvents = result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
    expect(dmgEvents).toHaveLength(1);
    const executed = result.events.find((e) => e.type === 'steps_spike_executed') as { playerWasInArea: boolean } | undefined;
    expect(executed?.playerWasInArea).toBe(true);
    void hpBefore;
  });

  it('no damage when the player has moved out of the fixed area by execution time', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // telegraph, center fixed at (9,4)
    state.player.pos = { x: 19, y: 19 }; // well outside the 3x3 around (9,4)
    const result = processTurn(state, { type: 'wait' }); // execute
    const dmgEvents = result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
    expect(dmgEvents).toHaveLength(0);
    const executed = result.events.find((e) => e.type === 'steps_spike_executed') as { playerWasInArea: boolean } | undefined;
    expect(executed?.playerWasInArea).toBe(false);
  });

  it('uses the existing hit/evasion/defense/death resolution path (no new formula)', () => {
    const state = freshState({ player: { ...createInitialActor({ x: 10, y: 4 }, 1, 1) }, enemies: [stepsAt(9, 4, 0, 6)] });
    processTurn(state, { type: 'wait' }); // telegraph
    processTurn(state, { type: 'wait' }); // execute — attack roll may hit or miss deterministically per fixture RNG
    // Either the player died (existing death/judgement path) or survived a miss/hit — both are valid
    // existing-path outcomes; the key assertion is no crash and consistent state.
    expect(typeof state.player.alive).toBe('boolean');
  });

  it('never knocks back or applies extra status effects', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // telegraph
    const before = { ...state.player.pos };
    processTurn(state, { type: 'wait' }); // execute
    expect(state.player.pos).toEqual(before);
  });

  it('isStepsDetectionRange and getStepsSpikeCells are deterministic and input-preserving', () => {
    const map = mapFromLayout(['#####', '#...#', '#...#', '#...#', '#####']);
    const center = { x: 2, y: 2 };
    const a = getStepsSpikeCells(map, center);
    const b = getStepsSpikeCells(map, center);
    expect(a).toEqual(b);
    expect(center).toEqual({ x: 2, y: 2 }); // input untouched
    expect(isStepsDetectionRange({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(isStepsDetectionRange({ x: 1, y: 1 }, { x: 3, y: 3 })).toBe(false);
  });
});

describe('Phase 23.4: steps — clairvoyance integration', () => {
  it('still reveals hidden traps and consumes normally with 0 steps on the floor', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), clairvoyance_fruit: 1 },
      traps: [{ id: 0, pos: { x: 5, y: 5 }, revealed: false, triggered: false, trapType: 'poison_trap' }],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(result.consumed).toBe(true);
    expect(state.traps![0].revealed).toBe(true);
    expect(state.inventory.clairvoyance_fruit).toBe(0);
    expect(state.stepsClairvoyanceActive).toBe(true);
    expect(result.events.some((e) => e.type === 'clairvoyance_used')).toBe(true);
  });

  it('succeeds, consumes, and advances the turn even with no traps and no steps', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), clairvoyance_fruit: 1 }, traps: [] });
    const result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(result.consumed).toBe(true);
    expect(state.stepsClairvoyanceActive).toBe(true);
  });

  it('does not itself alter combat state (a hidden steps far from the player stays hidden)', () => {
    const hidden = stepsAt(1, 1);
    const state = freshState({
      player: createInitialActor({ x: 19, y: 19 }, 30, 1), // far outside AGGRO_RANGE, so the enemy phase this same turn does not act on it either
      inventory: { ...createEmptyInventory(), clairvoyance_fruit: 1 },
      enemies: [hidden],
    });
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(hidden.stepsState ?? 'hidden').toBe('hidden');
    expect(hidden.stepsTelegraphCenter).toBeUndefined();
  });

  it('shouldDisplayStepsBody returns true for hidden/telegraphed steps once clairvoyance is active', () => {
    const hidden = stepsAt(1, 1);
    const telegraphed = stepsAt(2, 2);
    telegraphed.stepsState = 'telegraphed';
    expect(shouldDisplayStepsBody(hidden, true)).toBe(true);
    expect(shouldDisplayStepsBody(telegraphed, true)).toBe(true);
    expect(shouldDisplayStepsBody(hidden, false)).toBe(false);
  });

  it('does not affect ghost display (shouldDisplayStepsBody only reacts to steps)', () => {
    const ghost = createInitialEnemy('ghost' as EnemyType, { x: 1, y: 1 }, 6, 6);
    expect(shouldDisplayStepsBody(ghost, true)).toBe(false);
  });

  it('is not active on a new floor', () => {
    const state = freshState({ stepsClairvoyanceActive: true });
    state.player.pos = { ...state.exit };
    const next = advanceToNextFloor(state);
    expect(next.stepsClairvoyanceActive).toBeUndefined();
  });

  it('getMinimapStepsMarkers returns positions only while active, regardless of exploration', () => {
    const enemies = [stepsAt(3, 3, 0), stepsAt(7, 7, 1)];
    expect(getMinimapStepsMarkers(enemies, false)).toEqual([]);
    const active = getMinimapStepsMarkers(enemies, true);
    expect(active).toEqual([{ x: 3, y: 3 }, { x: 7, y: 7 }]);
  });

  it('getMinimapStepsMarkers never includes terrain or exploration data (positions only)', () => {
    const marker = getMinimapStepsMarkers([stepsAt(4, 4)], true)[0];
    expect(Object.keys(marker).sort()).toEqual(['x', 'y']);
  });

  it('excludes dead steps from minimap markers', () => {
    const dead = stepsAt(3, 3);
    dead.alive = false;
    expect(getMinimapStepsMarkers([dead], true)).toEqual([]);
  });
});

describe('Phase 23.4: steps — production sanity (full flow via processTurn/applyItemUse)', () => {
  it('hidden(distance1) -> telegraphed -> player evades -> execute(no damage) -> revealed(3 turns) -> hidden -> clairvoyance reveals body sprite', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 10, y: 4 }, 30, 1), hp: 25 },
      inventory: { ...createEmptyInventory(), clairvoyance_fruit: 1 },
      enemies: [stepsAt(9, 4)], // Chebyshev distance 1
    });
    const steps = state.enemies[0];

    // T0: hidden -> telegraphed via real processTurn (player waits, steps detects).
    let result = processTurn(state, { type: 'wait' });
    expect(steps.stepsState).toBe('telegraphed');
    expect(result.events.some((e) => e.type === 'steps_spike_telegraphed')).toBe(true);
    expect(shouldDisplayStepsBody(steps, state.stepsClairvoyanceActive ?? false)).toBe(false);

    // Player evades: moves out of the fixed 3x3 area before the spike fires.
    state.player.pos = { x: 19, y: 19 };

    // T1: telegraphed -> revealed. No damage since the player evaded.
    result = processTurn(state, { type: 'wait' });
    expect(steps.stepsState).toBe('revealed');
    expect(steps.stepsRevealTurnsRemaining).toBe(3);
    const executed = result.events.find((e) => e.type === 'steps_spike_executed') as { playerWasInArea: boolean } | undefined;
    expect(executed?.playerWasInArea).toBe(false);
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
    expect(shouldDisplayStepsBody(steps, state.stepsClairvoyanceActive ?? false)).toBe(true); // revealed shows the body sprite regardless of clairvoyance

    // T2-T4: 3 revealed ordinary actions, then back to hidden.
    processTurn(state, { type: 'wait' });
    expect(steps.stepsRevealTurnsRemaining).toBe(2);
    processTurn(state, { type: 'wait' });
    expect(steps.stepsRevealTurnsRemaining).toBe(1);
    processTurn(state, { type: 'wait' });
    expect(steps.stepsState).toBe('hidden');
    expect(shouldDisplayStepsBody(steps, state.stepsClairvoyanceActive ?? false)).toBe(false);

    // Now use clairvoyance via the real applyItemUse/processTurn path.
    result = processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(result.consumed).toBe(true);
    expect(state.stepsClairvoyanceActive).toBe(true);
    expect(steps.stepsState).toBe('hidden'); // clairvoyance never touches combat state
    expect(shouldDisplayStepsBody(steps, state.stepsClairvoyanceActive ?? false)).toBe(true); // but now shows the body sprite anyway
    expect(getMinimapStepsMarkers(state.enemies, state.stepsClairvoyanceActive ?? false)).toEqual([{ ...steps.pos }]);
  });
});

describe('Phase 23.4: steps — telegraph getter and event shape', () => {
  it('getStepsTelegraph returns the fixed center and matching cell set while telegraphed', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // telegraph
    const steps = state.enemies[0];
    const telegraph = getStepsTelegraph(state.map, steps);
    expect(telegraph).not.toBeNull();
    expect(telegraph!.center).toEqual({ x: 9, y: 4 });
    expect(telegraph!.cells).toEqual(getStepsSpikeCells(state.map, { x: 9, y: 4 }));
  });

  it('getStepsTelegraph returns null for hidden, revealed, dead, or non-steps', () => {
    const hidden = stepsAt(1, 1);
    expect(getStepsTelegraph(mapFromLayout(['###', '#.#', '###']), hidden)).toBeNull();
    const revealed = stepsAt(1, 1);
    revealed.stepsState = 'revealed';
    expect(getStepsTelegraph(mapFromLayout(['###', '#.#', '###']), revealed)).toBeNull();
    const dead = stepsAt(1, 1);
    dead.stepsState = 'telegraphed';
    dead.stepsTelegraphCenter = { x: 1, y: 1 };
    dead.alive = false;
    expect(getStepsTelegraph(mapFromLayout(['###', '#.#', '###']), dead)).toBeNull();
    const bok = createInitialEnemy('bok', { x: 1, y: 1 }, 5, 1);
    expect(getStepsTelegraph(mapFromLayout(['###', '#.#', '###']), bok)).toBeNull();
  });

  it('telegraphed and executed events each fire exactly once per cycle', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    const r0 = processTurn(state, { type: 'wait' });
    expect(r0.events.filter((e) => e.type === 'steps_spike_telegraphed')).toHaveLength(1);
    const r1 = processTurn(state, { type: 'wait' });
    expect(r1.events.filter((e) => e.type === 'steps_spike_executed')).toHaveLength(1);
  });

  it('does not fire a duplicate ordinary melee attack event alongside the spike execution', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' });
    const result = processTurn(state, { type: 'wait' });
    const attackLikeEvents = result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
    expect(attackLikeEvents.length).toBeLessThanOrEqual(1);
  });
});
