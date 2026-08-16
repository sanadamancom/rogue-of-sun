import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { isCardIdentified, processTurn } from '../turn';
import { GameState, Room } from '../types';

function withCard(state: GameState, cardId: import('../types').ItemId, count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

function stateWithSingleRoom(): GameState {
  const state = createInitialState(1);
  const room: Room = { x: 5, y: 5, width: 6, height: 6 };
  state.map = { ...state.map, rooms: [room] };
  state.player.pos = { x: 7, y: 7 };
  return state;
}

function enemyAt(pos: { x: number; y: number }, hp = 20) {
  return {
    type: 'bok' as const,
    pos,
    hp,
    maxHp: hp,
    attack: 5,
    defense: 0,
    accuracy: 100,
    evasion: 0,
    facing: 'W' as const,
    alive: true,
    actionGauge: 0,
  };
}

describe('Phase 20.4: justice / devil / tower', () => {
  describe('justice', () => {
    it('deals max(1, maxLife - currentLife) damage to same-room enemies', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.player.hp = state.player.maxHp - 6;
      state.enemies = [enemyAt({ x: 8, y: 8 })];
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.enemies[0].hp).toBe(20 - 6);
    });

    it('deals 1 damage when LIFE is full', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.enemies = [enemyAt({ x: 8, y: 8 })];
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.enemies[0].hp).toBe(19);
    });

    it('affects every enemy in the same room', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.player.hp = state.player.maxHp - 4;
      state.enemies = [enemyAt({ x: 6, y: 6 }), enemyAt({ x: 9, y: 9 })];
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.enemies[0].hp).toBe(16);
      expect(state.enemies[1].hp).toBe(16);
    });

    it('excludes an enemy in a different room (camera-independent geometry)', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.map = { ...state.map, rooms: [...state.map.rooms, { x: 20, y: 20, width: 4, height: 4 }] };
      state.player.hp = state.player.maxHp - 4;
      const inRoom = enemyAt({ x: 6, y: 6 });
      const otherRoom = enemyAt({ x: 21, y: 21 });
      state.enemies = [inRoom, otherRoom];
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.enemies[0].hp).toBeLessThan(20);
      expect(state.enemies[1].hp).toBe(20);
    });

    it('excludes an enemy outside any room (corridor)', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.player.hp = state.player.maxHp - 4;
      const corridorEnemy = enemyAt({ x: 100, y: 100 });
      state.enemies = [corridorEnemy];
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.enemies[0].hp).toBe(20);
    });

    it('succeeds (consumes/identifies/advances turn) with 0 enemies in the room', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(result.consumed).toBe(true);
      expect(state.inventory.justice).toBe(0);
      expect(isCardIdentified(state, 'justice')).toBe(true);
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('succeeds on a corridor tile too (0 targets, still a normal success)', () => {
      const state = withCard(createInitialState(1), 'justice', 1);
      state.map = { ...state.map, rooms: [] };
      const result = processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(result.consumed).toBe(true);
    });

    it('defeats an enemy whose HP drops to 0, routing through the shared defeat path (experience gained)', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.player.hp = 1;
      state.enemies = [enemyAt({ x: 8, y: 8 }, 1)];
      const expBefore = state.experience ?? 0;
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.enemies[0].alive).toBe(false);
      expect(state.experience ?? 0).toBeGreaterThanOrEqual(expBefore);
    });

    it('does not consume RNG', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.enemies = [{ ...enemyAt({ x: 8, y: 8 }), actionGauge: -1000 }]; // prevent the enemy from also acting this turn
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('devil', () => {
    it('costs 3 SOL', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(state.solarEnergy).toBe(7);
    });

    it('fails completely when SOL is below 3', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 2;
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(result.consumed).toBe(false);
      expect(state.solarEnergy).toBe(2);
      expect(state.inventory.devil).toBe(1);
      expect(state.turn).toBe(turnBefore);
      expect(isCardIdentified(state, 'devil')).toBe(false);
    });

    it('deals 5 fixed damage to every enemy in the same room', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      state.enemies = [enemyAt({ x: 6, y: 6 }), enemyAt({ x: 9, y: 9 })];
      processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(state.enemies[0].hp).toBe(15);
      expect(state.enemies[1].hp).toBe(15);
    });

    it('succeeds with 0 enemies, still consuming SOL/card/turn', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(result.consumed).toBe(true);
      expect(state.solarEnergy).toBe(7);
      expect(state.inventory.devil).toBe(0);
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('succeeds on a corridor tile if resources suffice (0 targets)', () => {
      const state = withCard(createInitialState(1), 'devil', 1);
      state.map = { ...state.map, rooms: [] };
      state.solarEnergy = 10;
      const result = processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(result.consumed).toBe(true);
    });

    it('defeats enemies through the shared defeat path', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      state.enemies = [enemyAt({ x: 8, y: 8 }, 3)];
      processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(state.enemies[0].alive).toBe(false);
    });

    it('does not consume RNG', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('tower', () => {
    it('deals 3x player level damage to same-room enemies and the player', () => {
      const state = withCard(stateWithSingleRoom(), 'tower', 1);
      state.enemies = [enemyAt({ x: 8, y: 8 })];
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(state.enemies[0].hp).toBe(17);
      expect(state.player.hp).toBeLessThanOrEqual(hpBefore - 3 + 1);
    });

    it('affects only the player on a corridor tile (no room)', () => {
      const state = withCard(createInitialState(1), 'tower', 1);
      state.map = { ...state.map, rooms: [] };
      state.enemies = [enemyAt({ x: state.player.pos.x + 1, y: state.player.pos.y })];
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(state.enemies[0].hp).toBe(20);
      expect(state.player.hp).toBeLessThan(hpBefore + 1);
    });

    it('succeeds with 0 enemies (the player is always a target)', () => {
      const state = withCard(stateWithSingleRoom(), 'tower', 1);
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(result.consumed).toBe(true);
      expect(state.turn).toBe(turnBefore + 1);
    });

    it('emperor_shield never mitigates tower\'s self-damage', () => {
      let state = withCard(stateWithSingleRoom(), 'emperor', 1);
      processTurn(state, { type: 'use_item', itemId: 'emperor' });
      state = withCard(state, 'tower', 1);
      const hpBefore = state.player.hp;
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(hpBefore - state.player.hp).toBeLessThanOrEqual(3);
      expect(hpBefore - state.player.hp).toBeGreaterThanOrEqual(2);
    });

    it('completes damage to all enemies even if the player reaches 0 HP mid-resolution', () => {
      const state = withCard(stateWithSingleRoom(), 'tower', 1);
      state.player.hp = 1;
      state.enemies = [enemyAt({ x: 8, y: 8 }), enemyAt({ x: 9, y: 9 })];
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(state.enemies[0].hp).toBe(17);
      expect(state.enemies[1].hp).toBe(17);
      expect(state.player.hp).toBe(0);
    });

    it('with judgement held, revives the player after tower\'s self-damage', () => {
      let state = withCard(stateWithSingleRoom(), 'tower', 1);
      state = withCard(state, 'judgement', 1);
      state.player.hp = 1;
      const result = processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(result.events.some((e) => e.type === 'judgement_triggered')).toBe(true);
      expect(state.player.alive).toBe(true);
    });

    it('without judgement, dies normally from tower\'s self-damage', () => {
      const state = withCard(stateWithSingleRoom(), 'tower', 1);
      state.player.hp = 1;
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(state.player.alive).toBe(false);
      expect(state.phase).toBe('gameover');
    });

    it('defeated enemies route through the shared defeat path (experience awarded)', () => {
      const state = withCard(stateWithSingleRoom(), 'tower', 1);
      state.enemies = [enemyAt({ x: 8, y: 8 }, 2)];
      const expBefore = state.experience ?? 0;
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(state.enemies[0].alive).toBe(false);
      expect(state.experience ?? 0).toBeGreaterThanOrEqual(expBefore);
    });

    it('does not consume RNG', () => {
      const state = withCard(stateWithSingleRoom(), 'tower', 1);
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'tower' });
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('shared_room', () => {
    it('room membership uses dungeon-generation geometry, not a fixed camera window', () => {
      const state = stateWithSingleRoom();
      const target = enemyAt({ x: 9, y: 9 });
      state.enemies = [target];
      const s2 = withCard(state, 'devil', 1);
      s2.solarEnergy = 10;
      processTurn(s2, { type: 'use_item', itemId: 'devil' });
      expect(s2.enemies[0].hp).toBeLessThan(20);
    });

    it('an enemy just outside the room rectangle is excluded', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      state.enemies = [enemyAt({ x: 11, y: 7 })];
      processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(state.enemies[0].hp).toBe(20);
    });

    it('target list is a snapshot: a defeated enemy does not change processing of remaining targets', () => {
      const state = withCard(stateWithSingleRoom(), 'devil', 1);
      state.solarEnergy = 10;
      state.enemies = [enemyAt({ x: 6, y: 6 }, 3), enemyAt({ x: 9, y: 9 }, 20)];
      processTurn(state, { type: 'use_item', itemId: 'devil' });
      expect(state.enemies[0].alive).toBe(false);
      expect(state.enemies[1].hp).toBe(15);
    });

    it('same seed/operation sequence produces identical results', () => {
      const s1 = withCard(stateWithSingleRoom(), 'devil', 1);
      const s2 = withCard(stateWithSingleRoom(), 'devil', 1);
      s1.solarEnergy = 10;
      s2.solarEnergy = 10;
      s1.enemies = [enemyAt({ x: 6, y: 6 })];
      s2.enemies = [enemyAt({ x: 6, y: 6 })];
      processTurn(s1, { type: 'use_item', itemId: 'devil' });
      processTurn(s2, { type: 'use_item', itemId: 'devil' });
      expect(s1.enemies).toEqual(s2.enemies);
    });

    it('0-target success is uniform across justice/devil/tower', () => {
      const cases: Array<{ cardId: 'justice' | 'devil' | 'tower'; setup?: (s: GameState) => void }> = [
        { cardId: 'justice' },
        { cardId: 'devil', setup: (s) => { s.solarEnergy = 10; } },
        { cardId: 'tower' },
      ];
      for (const { cardId, setup } of cases) {
        const state = withCard(stateWithSingleRoom(), cardId, 1);
        setup?.(state);
        const result = processTurn(state, { type: 'use_item', itemId: cardId });
        expect(result.consumed).toBe(true);
      }
    });

    it('sealed state rejects all three cards completely', () => {
      const cases: Array<'justice' | 'devil' | 'tower'> = ['justice', 'devil', 'tower'];
      for (const cardId of cases) {
        let state = withCard(stateWithSingleRoom(), cardId, 1);
        state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
        state.solarEnergy = 10;
        const turnBefore = state.turn;
        const result = processTurn(state, { type: 'use_item', itemId: cardId });
        expect(result.consumed).toBe(false);
        expect(state.turn).toBe(turnBefore);
      }
    });

    it('not owning any of the three cards is a complete no-op', () => {
      const cases: Array<'justice' | 'devil' | 'tower'> = ['justice', 'devil', 'tower'];
      for (const cardId of cases) {
        const state = stateWithSingleRoom();
        const turnBefore = state.turn;
        const result = processTurn(state, { type: 'use_item', itemId: cardId });
        expect(result.consumed).toBe(false);
        expect(state.turn).toBe(turnBefore);
      }
    });
  });

  describe('regression', () => {
    it('all 17 cards remain outside every floor weighted loot pool', async () => {
      const { getWeightedGroundItemPoolForFloor } = await import('../item-def');
      const { CARD_IDS_IN_ORDER } = await import('../card-def');
      for (const floor of [1, 2, 3]) {
        const pool = getWeightedGroundItemPoolForFloor(floor, undefined, 3, 'short');
        for (const id of CARD_IDS_IN_ORDER) {
          expect(pool.some((c) => c.id === id)).toBe(false);
        }
      }
    });

    it('Phase 24.4c: if any of these cards appears via production floor generation, it is a plain GroundItem with no equipment/instance state attached (cards were unreachable in production before Phase 24.4c connected the loot routes — see docs/history/phase-24-4c-card-supply.md)', () => {
      let sawAny = false;
      for (let seed = 1; seed <= 100; seed++) {
        const state = createInitialState(seed);
        for (const item of state.groundItems) {
          if (['justice', 'devil', 'tower'].includes(item.itemId)) {
            sawAny = true;
            expect(item.equipmentInstanceId).toBeUndefined();
          }
        }
      }
      expect(sawAny).toBe(true);
    });

    it('room-wide card effects clean up correctly across a floor transition', () => {
      const state = withCard(stateWithSingleRoom(), 'justice', 1);
      state.enemies = [enemyAt({ x: 8, y: 8 })];
      processTurn(state, { type: 'use_item', itemId: 'justice' });
      const next = advanceToNextFloor(state);
      expect(next.inventory.justice).toBe(0);
    });

    it('Phase 20.0c/20.0d/20.1/20.2/20.3 mechanisms are unaffected', () => {
      const state = withCard(stateWithSingleRoom(), 'strength', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(result.consumed).toBe(true);
      expect(state.abilities?.power).toBe(1);
    });
  });
});
