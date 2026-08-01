import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn, REGEN_TURNS_PER_HP } from '../turn';
import { GameMap, GameState, Tile } from '../types';

// Small fixed layout retained only for these turn-processing unit tests;
// production maps now come from mapgen.ts.
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

function freshState(): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    enemies: [
      createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1),
      createInitialEnemy('bok', { x: 8, y: 6 }, 2, 1),
    ],
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
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, chocolate: 0 },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
  };
}

describe('turn processing', () => {
  it('moves an enemy toward the player on a normal move turn', () => {
    const state = freshState();
    const enemyStart = { ...state.enemies[0].pos };
    processTurn(state, { type: 'move', direction: 'E' });
    const dx = Math.abs(state.enemies[0].pos.x - enemyStart.x);
    const dy = Math.abs(state.enemies[0].pos.y - enemyStart.y);
    expect(dx + dy).toBeGreaterThan(0);
  });

  it('does not consume a turn on a blocked move', () => {
    const state = freshState();
    state.player.pos = { x: 0, y: 1 }; // against the outer wall
    const result = processTurn(state, { type: 'move', direction: 'W' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(0);
  });

  it('resolves an attack via the X action toward an adjacent enemy', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.player.facing = 'E';
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[1].pos = { x: 0, y: 0 };
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(state.player.pos).toEqual({ x: 4, y: 4 }); // player does not step in
    expect(state.enemies[0].hp).toBe(1);
  });

  it('moving toward an adjacent enemy no longer attacks (Phase 08.6): it is simply a blocked move', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[1].pos = { x: 0, y: 0 };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(false);
    expect(result.playerAttacked).toBe(false);
    expect(state.enemies[0].hp).toBe(2);
    expect(state.player.facing).toBe('E'); // facing still updates on a blocked move
  });

  it('attacks only the single targeted enemy, leaving the other untouched', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.player.facing = 'E';
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[1].pos = { x: 4, y: 5 };
    processTurn(state, { type: 'action' });
    expect(state.enemies[0].hp).toBe(1);
    expect(state.enemies[1].hp).toBe(2);
  });

  it('removes the enemy from the board once its HP reaches 0', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.player.facing = 'E';
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[0].hp = 1;
    state.enemies[1].pos = { x: 0, y: 0 };
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyDefeated).toBe(true);
    expect(state.enemies[0].alive).toBe(false);
  });

  it('does not let a defeated enemy act (no counter-attack) while other enemies stay far away', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.player.facing = 'E';
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[0].hp = 1;
    state.enemies[1].pos = { x: 0, y: 0 };
    const result = processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(false);
    expect(result.playerDefeated).toBe(false);
  });

  it('advances the turn count on attack and wait', () => {
    const state = freshState();
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(1);
  });

  it('lets a living enemy act after a normal player move', () => {
    const state = freshState();
    const before = { ...state.enemies[0].pos };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.enemies[0].pos).not.toEqual(before);
  });

  it('sets gameover when player HP reaches 0', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[1].pos = { x: 0, y: 0 };
    state.player.hp = 1;
    // Player waits; adjacent enemy attacks and defeats the player.
    const result = processTurn(state, { type: 'wait' });
    expect(result.playerDefeated).toBe(true);
    expect(state.phase).toBe('gameover');
  });

  it('stops later enemies from acting once the player is defeated mid-turn', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.player.hp = 1;
    state.enemies[0].pos = { x: 5, y: 4 }; // adjacent, will defeat the player
    state.enemies[1].pos = { x: 4, y: 3 }; // also adjacent; would attack if it got a turn
    const before = { ...state.enemies[1] };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('gameover');
    // The second enemy never got to act because the player died first.
    expect(state.enemies[1].facing).toBe(before.facing);
  });

  it('ignores unrelated key-derived actions without consuming a turn', () => {
    // Simulated by not calling processTurn at all for unmapped keys;
    // this is enforced at the input-mapping layer (see input.test.ts).
    const state = freshState();
    expect(state.turn).toBe(0);
  });
});

describe('enemy collision', () => {
  it('does not let two enemies occupy the same tile', () => {
    const state = freshState();
    state.player.pos = { x: 0, y: 1 };
    state.enemies[0].pos = { x: 2, y: 1 };
    state.enemies[1].pos = { x: 3, y: 1 };
    for (let i = 0; i < 10; i++) {
      processTurn(state, { type: 'wait' });
      expect(state.enemies[0].pos).not.toEqual(state.enemies[1].pos);
    }
  });
});

describe('natural HP regeneration', () => {
  it('starts with regenProgress at 0', () => {
    const state = freshState();
    expect(state.regenProgress).toBe(0);
  });

  it('heals HP (Phase 10.2: +10 per interval, clamped to maxHp) after REGEN_TURNS_PER_HP consumed actions while damaged, and resets progress', () => {
    const state = freshState();
    state.enemies.forEach((e) => (e.pos = { x: 0, y: 0 }));
    state.player.maxHp = 5;
    state.player.hp = 2;
    let result;
    for (let i = 0; i < REGEN_TURNS_PER_HP - 1; i++) {
      result = processTurn(state, { type: 'wait' });
      expect(result.playerRegenerated).toBe(false);
    }
    expect(state.player.hp).toBe(2);
    result = processTurn(state, { type: 'wait' });
    expect(result!.playerRegenerated).toBe(true);
    expect(state.player.hp).toBe(5); // +10 clamped to this fixture's maxHp (5)
    expect(state.regenProgress).toBe(0);
  });

  it('does not increase regenProgress on a blocked move', () => {
    const state = freshState();
    state.player.pos = { x: 0, y: 1 };
    state.player.maxHp = 5;
    state.player.hp = 2;
    processTurn(state, { type: 'move', direction: 'W' }); // blocked by wall
    expect(state.regenProgress).toBe(0);
  });

  it('does not exceed maxHp', () => {
    const state = freshState();
    state.enemies.forEach((e) => (e.pos = { x: 0, y: 0 }));
    state.player.maxHp = 3;
    state.player.hp = 3;
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      processTurn(state, { type: 'wait' });
    }
    expect(state.player.hp).toBe(3);
    expect(state.regenProgress).toBe(0);
  });

  it('does not reset regenProgress when the player takes damage', () => {
    const state = freshState();
    state.player.maxHp = 5;
    state.player.hp = 4;
    state.player.pos = { x: 4, y: 4 };
    state.enemies[0].pos = { x: 5, y: 4 }; // adjacent: will attack every turn
    state.enemies[1].pos = { x: 0, y: 0 };
    processTurn(state, { type: 'wait' }); // progress -> 1, hp -> 3 (attacked)
    expect(state.regenProgress).toBe(1);
    processTurn(state, { type: 'wait' }); // progress -> 2
    expect(state.regenProgress).toBe(2);
  });

  it('does not regenerate on the turn the player dies', () => {
    const state = freshState();
    state.player.maxHp = 5;
    state.player.hp = 1;
    state.regenProgress = REGEN_TURNS_PER_HP - 1;
    state.player.pos = { x: 4, y: 4 };
    state.enemies[0].pos = { x: 5, y: 4 };
    state.enemies[1].pos = { x: 0, y: 0 };
    const result = processTurn(state, { type: 'wait' });
    expect(result.playerDefeated).toBe(true);
    expect(result.playerRegenerated).toBe(false);
  });
});
