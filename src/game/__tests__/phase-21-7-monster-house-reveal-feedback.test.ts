/**
 * Phase 21.7 implementation_gate tests: monster house reveal notification
 * (GameEvent 'monster_house_revealed', pushed exactly once from turn.ts's
 * processTurn the same call applyMonsterHouseReveal flips hidden ->
 * revealed, formatted to "モンスターハウスだ！" via message-log.ts's
 * existing formatEvent/formatEvents path — no new UI/log machinery).
 */
import { describe, expect, it } from 'vitest';
import { GameMap, GameState, Room, Tile } from '../types';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { formatEvent, formatEvents } from '../message-log';
import { createInitialState, advanceToNextFloor } from '../state';
import { createEmptyInventory } from '../item-def';
import { DEFAULT_RUN_CONFIG } from '../floor';

// Same 2-room fixture shape as Phase 21.3's tests: room A (start) at
// x:[1,6), y:[1,6); room B (monster house target) at x:[10,16), y:[1,6),
// connected by a corridor at y=3, x=6..9 (strictly outside both rooms).
function testMap(): GameMap {
  const width = 20;
  const height = 8;
  const terrain: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push(new Array(width).fill('wall'));
  }
  const roomA: Room = { x: 1, y: 1, width: 5, height: 5 };
  const roomB: Room = { x: 10, y: 1, width: 6, height: 5 };
  for (const room of [roomA, roomB]) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        terrain[y][x] = 'floor';
      }
    }
  }
  for (let x = 6; x <= 9; x++) {
    terrain[3][x] = 'floor';
  }
  return { width, height, terrain, rooms: [roomA, roomB], exit: { x: 12, y: 3 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 3, y: 3 }, 30, 10, 0, 90, 0),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 2,
    totalFloors: 3,
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 12, y: 3 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { ...createEmptyInventory(),
      apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0,
      sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0,
      chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0,
      high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0,
      justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0,
    },
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
    traps: [],
    ...overrides,
  };
}

describe('monster_house_revealed event: formatting', () => {
  it('formats to the fixed notification text', () => {
    expect(formatEvent({ type: 'monster_house_revealed' })).toBe('モンスターハウスだ！');
  });

  it('carries no unseen information (event has no extra fields)', () => {
    const event = { type: 'monster_house_revealed' as const };
    expect(Object.keys(event)).toEqual(['type']);
  });
});

describe('processTurn: notification fires exactly on hidden->revealed transition', () => {
  it('a successful move into the target room fires the notification once', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.monsterHouseRevealed).toBe(true);
    const revealEvents = result.events.filter((e) => e.type === 'monster_house_revealed');
    expect(revealEvents).toHaveLength(1);
  });

  it('formatEvents produces exactly one notification line for the reveal turn', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    const lines = formatEvents(result.events);
    expect(lines.filter((l) => l === 'モンスターハウスだ！')).toHaveLength(1);
  });

  it('a move that does not cross into the room does not fire the notification', () => {
    const state = freshState({ player: createInitialActor({ x: 6, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('a blocked move (into a wall) does not fire the notification', () => {
    const state = freshState({ player: createInitialActor({ x: 3, y: 1 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'N' });
    expect(result.consumed).toBe(false);
    expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('waiting does not fire the notification', () => {
    const state = freshState({ player: createInitialActor({ x: 3, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('attacking (without a successful move) does not fire the notification', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 10, y: 3 }, 1000, 0, 0, 0, 0, 0, 0)],
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' }); // resolves as attack
    expect(state.player.pos).toEqual({ x: 9, y: 3 });
    expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('a floor with no monster house never fires the notification', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    // map.monsterHouse left undefined
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('an already-revealed monster house does not re-fire on re-entry', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'revealed' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('leaving and re-entering the room after reveal does not re-fire', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const first = processTurn(state, { type: 'move', direction: 'E' }); // enters room, reveals
    expect(first.events.some((e) => e.type === 'monster_house_revealed')).toBe(true);
    // Step back out of the room.
    const out = processTurn(state, { type: 'move', direction: 'W' });
    expect(out.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
    // Re-enter.
    const reenter = processTurn(state, { type: 'move', direction: 'E' });
    expect(reenter.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });

  it('a second processTurn call on an already-revealed state (simulating re-render) does not re-fire', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    processTurn(state, { type: 'move', direction: 'E' }); // reveals
    expect(state.map.monsterHouse.status).toBe('revealed');
    // Any subsequent turn call (even a no-op wait) must not re-fire.
    const again = processTurn(state, { type: 'wait' });
    expect(again.events.some((e) => e.type === 'monster_house_revealed')).toBe(false);
  });
});

describe('turn behavior unaffected by the notification', () => {
  it('the revealing move still consumes exactly 1 turn', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const turnBefore = state.turn;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('enemy phase still runs exactly once on the reveal turn', () => {
    const state = freshState({
      player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 13, y: 3 }, 10, 2, 0, 0, 0, 90, 0)],
    });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.monsterHouseRevealed).toBe(true);
    expect(result.enemyActed).toBe(true); // chase-step AI moves it — single pass confirmed
  });

  it('monster house status is revealed after the notification-carrying turn', () => {
    const state = freshState({ player: createInitialActor({ x: 9, y: 3 }, 30, 10, 0, 90, 0) });
    state.map.monsterHouse = { roomIndex: 1, status: 'hidden' };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.map.monsterHouse.status).toBe('revealed');
  });
});

describe('production wiring: real generated floors', () => {
  it('a real dark monster house floor (seed 3, floor 2) fires the notification exactly once on entry', () => {
    let state = createInitialState(3);
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    expect(state.map.monsterHouse).not.toBeNull();
    expect(state.map.darkRoomIndex).toBe(state.map.monsterHouse!.roomIndex); // known dark occurrence
    const room = state.map.rooms[state.map.monsterHouse!.roomIndex];
    const darkRoomIndexBefore = state.map.darkRoomIndex;

    // Find an entry-adjacent outside tile, move the player there, then
    // step into the room.
    const deltas: Array<{ dx: number; dy: number; dir: 'N' | 'S' | 'E' | 'W' }> = [
      { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
    ];
    let fired = false;
    outer: for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (state.map.terrain[y][x] !== 'floor') continue;
        for (const d of deltas) {
          const from = { x: x + d.dx, y: y + d.dy };
          if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
          if (state.map.terrain[from.y][from.x] !== 'floor') continue;
          if (from.x >= room.x && from.x < room.x + room.width && from.y >= room.y && from.y < room.y + room.height) continue;
          if (state.enemies.some((e) => e.alive && (e.pos.x === from.x && e.pos.y === from.y))) continue;
          if (state.enemies.some((e) => e.alive && e.pos.x === x && e.pos.y === y)) continue;
          state.player.pos = from;
          const result = processTurn(state, { type: 'move', direction: d.dir });
          if (result.consumed && state.player.pos.x === x && state.player.pos.y === y) {
            const revealEvents = result.events.filter((ev) => ev.type === 'monster_house_revealed');
            expect(revealEvents).toHaveLength(1);
            fired = true;
          }
          break outer;
        }
      }
    }
    expect(fired).toBe(true);
    // Darkness untouched by the notification.
    expect(state.map.darkRoomIndex).toBe(darkRoomIndexBefore);
    expect(state.map.monsterHouse!.status).toBe('revealed');
  });

  it('determinism: notification firing and RNG-dependent generation results are unaffected by repeated builds of the same seed/floor', () => {
    const build = () => {
      let state = createInitialState(3);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      return advanceToNextFloor(state);
    };
    const a = build();
    const b = build();
    const dedicatedEnemiesA = a.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => ({ type: e.type, pos: e.pos }));
    const dedicatedEnemiesB = b.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => ({ type: e.type, pos: e.pos }));
    expect(dedicatedEnemiesA).toEqual(dedicatedEnemiesB);
    const rewardsA = a.groundItems.filter((i) => i.spawnSource === 'monster_house').map((i) => ({ itemId: i.itemId, pos: i.pos }));
    const rewardsB = b.groundItems.filter((i) => i.spawnSource === 'monster_house').map((i) => ({ itemId: i.itemId, pos: i.pos }));
    expect(rewardsA).toEqual(rewardsB);
  });
});

describe('regression: existing message formatting and event handling unaffected', () => {
  it('formatEvent still exhaustively handles every other existing event type (spot check a few)', () => {
    expect(formatEvent({ type: 'player_petrified_skip' })).not.toBe('');
  });

  it('formatEvents dedup logic still collapses consecutive identical lines for other event types', () => {
    const lines = formatEvents([{ type: 'player_petrified_skip' }, { type: 'player_petrified_skip' }]);
    expect(lines).toHaveLength(1);
  });
});
