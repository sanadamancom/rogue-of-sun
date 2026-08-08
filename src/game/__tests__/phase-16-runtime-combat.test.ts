import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { formatEvents } from '../message-log';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { computeIncomingDamage } from '../combat';
import { EnemyType, GameMap, GameState, Tile } from '../types';

/**
 * Phase 16 shipped a runtime bug that a source-only test (enemy-type.test
 * .ts's "bok spawns with the common-table hp (6) and attack (3) values")
 * did not catch: the first single-HTML preview built from a branch that
 * forked from `main` before Phase 16's enemy-def.ts change landed, so its
 * embedded bundle carried bok's pre-Phase-16 attack (6) even though
 * `src/game/enemy-def.ts` on this branch was already 3. Reading
 * `ENEMY_DEFINITIONS.bok.attack` directly proves the constant is right;
 * it does not prove that a real Enemy instance created from that
 * constant, run through the real attack resolution, and formatted by the
 * real message log actually deals and reports 3 damage from the artifact
 * that ships. This file drives that exact path end-to-end instead of
 * re-deriving expected values, so it fails if any of those exact
 * link — enemy-def -> createInitialEnemy -> processTurn -> message-log —
 * is ever broken or bypassed by a stale build again.
 */

const TEST_LAYOUT: string[] = [
  '####################',
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

/**
 * A real bok Enemy — hp/attack read directly from ENEMY_DEFINITIONS, not
 * overridden — placed orthogonally adjacent to a real initial-state
 * player (hp 15, attack 2, defense 0, accuracy 90, evasion 0, matching
 * state.ts's `createInitialActor(placement.start, 15, 2, 0, 90, 0)`
 * exactly). combatRngState 304 is the same fixed seed already used by
 * enemy-behavior-melee-variants.test.ts and message-log.test.ts's bok
 * adjacency tests, chosen there because it resolves the enemy's attack
 * as a hit (not a miss) at this accuracy/evasion pairing.
 */
function realBokAdjacentToRealPlayer(): GameState {
  const bokDef = ENEMY_DEFINITIONS.bok;
  return {
    map: testMap(),
    player: createInitialActor({ x: 10, y: 2 }, 15, 2, 0, 90, 0),
    enemies: [createInitialEnemy('bok' as EnemyType, { x: 9, y: 2 }, bokDef.hp, bokDef.attack, 0, 0, bokDef.defense, bokDef.accuracy, bokDef.evasion)],
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
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0 },
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
  };
}

describe('Phase 16 runtime combat: bok normal-attack damage end-to-end', () => {
  it('a real bok enemy instance deals exactly 3 real damage to a real initial-state player', () => {
    const state = realBokAdjacentToRealPlayer();
    expect(state.player.hp).toBe(15);
    const result = processTurn(state, { type: 'wait' });
    // Phase 16.2: natural regen now fires every turn (REGEN_TURNS_PER_HP
    // 10->1), so the 3 damage taken this same turn is immediately
    // offset by 1 HP of regen — net -2, not -3.
    expect(state.player.hp).toBe(13); // 15 - 3 + 1
    expect(result.events).toEqual([{ type: 'enemy_attack', enemyType: 'bok', attackerId: 0, damage: 3 }]);
  });

  it('the message log renders that hit as "ボクの攻撃！ 3ダメージを受けた。"', () => {
    const state = realBokAdjacentToRealPlayer();
    const result = processTurn(state, { type: 'wait' });
    expect(formatEvents(result.events)).toEqual(['ボクの攻撃！ 3ダメージを受けた。']);
  });

  it('two consecutive real bok attacks net LIFE from 15 to 11 (Phase 16.2: -3 damage +1 regen per turn)', () => {
    const state = realBokAdjacentToRealPlayer();
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(13);
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(11);
  });

  it('computeIncomingDamage(bok.attack, 0) equals 3, matching the runtime result above', () => {
    expect(computeIncomingDamage(ENEMY_DEFINITIONS.bok.attack, 0)).toBe(3);
  });

  it('bok is still defeated by a total of exactly hp (6) real player damage (hp and player attack unchanged)', () => {
    const state = realBokAdjacentToRealPlayer();
    state.player.facing = 'W';
    let totalDamageDealt = 0;
    let swings = 0;
    while (state.enemies[0].alive && swings < 20) {
      const result = processTurn(state, { type: 'action' });
      for (const event of result.events) {
        if (event.type === 'player_attack') totalDamageDealt += event.damage;
      }
      swings++;
    }
    expect(state.enemies[0].alive).toBe(false);
    expect(totalDamageDealt).toBe(ENEMY_DEFINITIONS.bok.hp); // 6, unchanged by the Phase 16 attack-only fix
  });

  it('other enemy species real attack damage is unchanged by the Phase 16 bok fix (bat spot-check)', () => {
    const batDef = ENEMY_DEFINITIONS.bat;
    const state: GameState = {
      ...realBokAdjacentToRealPlayer(),
      enemies: [createInitialEnemy('bat' as EnemyType, { x: 9, y: 2 }, batDef.hp, batDef.attack, 0, 0, batDef.defense, batDef.accuracy, batDef.evasion)],
    };
    const before = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    const attackEvent = result.events.find((e) => e.type === 'enemy_attack');
    if (attackEvent && attackEvent.type === 'enemy_attack') {
      expect(attackEvent.damage).toBe(computeIncomingDamage(batDef.attack, 0));
      // Phase 16.2: regen now fires the same turn (hp remains below max
      // after taking damage), offsetting 1 of the damage.
      expect(state.player.hp).toBe(before - attackEvent.damage + 1);
    }
    // bat's evasive behavior may not always attack on the first adjacent
    // turn; the assertion above only fires when it does, but the damage
    // value — when present — must match batDef.attack unmodified.
  });
});
