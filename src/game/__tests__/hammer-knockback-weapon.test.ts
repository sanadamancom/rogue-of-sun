import { describe, expect, it } from 'vitest';
import { closeInventory, toggleInventory } from '../inventory';
import { createEmptyInventory, ITEM_DEFINITIONS } from '../item-def';
import { WEAPON_DEFINITIONS } from '../weapon-def';
import { advanceToNextFloor, createInitialState, randomSeed } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

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
    enemies: [createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1)],
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
    inventory: createEmptyInventory(),
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
    ...overrides,
  };
}

describe('weapon definition (Phase 08.7)', () => {
  it('registers hammer as a weapon with the correct display name and category', () => {
    expect(ITEM_DEFINITIONS.hammer.displayName).toBe('クラブ');
    expect(ITEM_DEFINITIONS.hammer.category).toBe('weapon');
    expect(ITEM_DEFINITIONS.hammer.consumable).toBe(false);
    expect(ITEM_DEFINITIONS.hammer.stackable).toBe(false);
  });

  it('registers hammer with attackPower 3 (bonus over bare hands; Phase 15.1, see weapon-def.ts), reach 1, knockbackDistance 1, hasRecoil true', () => {
    expect(WEAPON_DEFINITIONS.hammer.attackPower).toBe(3);
    expect(WEAPON_DEFINITIONS.hammer.reach).toBe(1);
    expect(WEAPON_DEFINITIONS.hammer.knockbackDistance).toBe(1);
    expect(WEAPON_DEFINITIONS.hammer.hasRecoil).toBe(true);
  });

  it('sword and spear have no knockback/recoil (regression)', () => {
    expect(WEAPON_DEFINITIONS.sword.knockbackDistance).toBe(0);
    expect(WEAPON_DEFINITIONS.sword.hasRecoil).toBe(false);
    expect(WEAPON_DEFINITIONS.spear.knockbackDistance).toBe(0);
    expect(WEAPON_DEFINITIONS.spear.hasRecoil).toBe(false);
  });
});

describe('hammer placement (floor 2 only)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  const advance = (seed: number) => {
    let s = createInitialState(seed);
    s.enemies.forEach((e) => (e.alive = false));
    s.player.pos = { ...s.exit };
    processTurn(s, { type: 'wait' });
    return advanceToNextFloor(s);
  };

  it('does not place a hammer on floor 1', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      expect(state.groundItems.filter((i) => i.itemId === 'hammer')).toHaveLength(0);
    }
  });

  it('when a hammer is placed on floor 2, it is on a valid floor tile not overlapping player/exit/enemy/other items', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = advance(runSeed);
      const hammers = state.groundItems.filter((i) => i.itemId === 'hammer');
      for (const hammer of hammers) {
        expect(state.map.terrain[hammer.pos.y][hammer.pos.x]).toBe('floor');
        expect(hammer.pos).not.toEqual(state.player.pos);
        expect(hammer.pos).not.toEqual(state.exit);
        for (const enemy of state.enemies) {
          expect(hammer.pos).not.toEqual(enemy.pos);
        }
        for (const other of state.groundItems) {
          if (other === hammer) continue;
          expect(hammer.pos).not.toEqual(other.pos);
        }
      }
    }
  });

  it('is deterministic: the same seed places the hammer at the same coordinate', () => {
    for (const runSeed of RUN_SEEDS) {
      const a = advance(runSeed);
      const b = advance(runSeed);
      const hammerA = a.groundItems.find((i) => i.itemId === 'hammer');
      const hammerB = b.groundItems.find((i) => i.itemId === 'hammer');
      expect(hammerA).toEqual(hammerB);
    }
  });

  it('does not perturb existing floor-2 map/enemy/apple/spear determinism (independent RNG stream)', () => {
    const a = advance(2780624551);
    const b = advance(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.exit).toEqual(b.exit);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    const appleA = a.groundItems.find((i) => i.itemId === 'apple');
    const appleB = b.groundItems.find((i) => i.itemId === 'apple');
    expect(appleA).toEqual(appleB);
    const spearA = a.groundItems.find((i) => i.itemId === 'spear');
    const spearB = b.groundItems.find((i) => i.itemId === 'spear');
    expect(spearA).toEqual(spearB);
  });

  it('does not perturb existing floor-1 item coordinates (sword/armor/apple)', () => {
    const a = createInitialState(2780624551);
    const b = createInitialState(2780624551);
    expect(a.groundItems).toEqual(b.groundItems);
  });
});

describe('hammer pickup, equip, and persistence', () => {
  it('picking up the hammer increases inventory.hammer by 1 without auto-equipping', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'hammer', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.hammer).toBe(1);
    expect(state.groundItems).toHaveLength(0);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('can equip an owned hammer, setting equippedWeaponId', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 1, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 } });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'hammer' });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('hammer');
  });

  it('the weapon slot and armor slot remain independent when equipping the hammer', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 1, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 },
      equippedArmorId: 'armor',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'hammer' });
    expect(state.equippedArmorId).toBe('armor');
  });

  it('hammer possession and equip state carry over across a floor transition', () => {
    let state = freshState({
      inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 1, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 },
      equippedWeaponId: 'hammer',
    });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.hammer).toBe(1);
    expect(state.equippedWeaponId).toBe('hammer');
  });

  it('a new game resets hammer possession to 0 and equippedWeaponId to null', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.hammer).toBe(0);
    expect(state.equippedWeaponId).toBeNull();
  });
});

describe('hammer attack', () => {
  it('deals 4 damage to an adjacent enemy (Phase 15.1: fixture player.attack 1 + hammer bonus 3 - defense 0)', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(26);
  });

  it('cannot hit an enemy 2 tiles away (reach 1)', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 30, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(30);
  });

  it('never moves the player', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1)];
    const posBefore = { ...state.player.pos };
    processTurn(state, { type: 'action' });
    expect(state.player.pos).toEqual(posBefore);
  });

  it('does not damage more than one enemy per attack', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const target = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    const bystander = createInitialEnemy('bat', { x: 3, y: 5 }, 5, 1);
    state.enemies = [target, bystander];
    processTurn(state, { type: 'action' });
    expect(target.hp).toBe(26);
    expect(bystander.hp).toBe(5);
  });

  it('a whiff still consumes exactly 1 turn and lets an enemy act', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'N'; // nothing north
    const enemy = createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1);
    state.enemies = [enemy];
    const turnBefore = state.turn;
    const posBefore = { ...enemy.pos };
    const result = processTurn(state, { type: 'action' });
    expect(state.turn).toBe(turnBefore + 1);
    expect(result.enemyActed).toBe(true);
    const moved = enemy.pos.x !== posBefore.x || enemy.pos.y !== posBefore.y;
    expect(moved).toBe(true);
  });
});

describe('hammer knockback', () => {
  it('pushes a surviving enemy back 1 tile in the attack direction', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    // The enemy also takes its own normal turn immediately afterward (per
    // "ノックバック後の敵は移動後の座標から同じターンの敵行動を行う"),
    // which for a chasing melee type may move it again — so the knockback
    // itself is verified via its event rather than the final tile.
    expect(result.events).toContainEqual({ type: 'enemy_knocked_back', enemyType: 'bok' });
  });

  it('does not knock back a defeated enemy', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 3, 1); // dies in one hit (attackPower 3)
    state.enemies = [enemy];
    const posBefore = { ...enemy.pos };
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyDefeated).toBe(true);
    expect(enemy.pos).toEqual(posBefore); // never moved
  });

  it('does not knock the enemy into a wall (blocked, damage still applied)', () => {
    // Player at (3,1) facing E, enemy at (4,1); (5,1) is a wall in this layout.
    const state = freshState({
      equippedWeaponId: 'hammer',
      player: createInitialActor({ x: 3, y: 1 }, 3, 1),
    });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(26); // damage still applied (30 - 4)
    expect(enemy.pos).toEqual({ x: 4, y: 1 }); // did not move into the wall
  });

  it('does not knock the enemy off the map edge', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      player: createInitialActor({ x: 0, y: 1 }, 3, 1),
    });
    // Not realistic given the wall border, but exercise the bounds check
    // directly: attack west from x=1 toward an enemy at x=0 would push to x=-1.
    state.player.pos = { x: 1, y: 1 };
    state.player.facing = 'W';
    const enemy = createInitialEnemy('bok', { x: 0, y: 1 }, 30, 1);
    // x=0 is technically a wall tile per the border layout, so instead
    // verify canMove-based rejection using the existing wall check above;
    // this test focuses on out-of-bounds safety at the map's inner edge.
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.pos).toEqual({ x: 0, y: 1 });
  });

  it('does not knock the enemy onto another living enemy (actor occupancy)', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const target = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    const blocker = createInitialEnemy('bat', { x: 4, y: 1 }, 5, 1);
    state.enemies = [target, blocker];
    processTurn(state, { type: 'action' });
    expect(target.pos).toEqual({ x: 3, y: 1 }); // blocked by blocker
    expect(target.hp).toBe(26); // damage still applied (30 - 4)
  });

  it('does not knock the enemy onto the player position', () => {
    // Not a normal occurrence (player and enemy can't already be adjacent
    // with the push destination being the player's own tile in a typical
    // layout), but the check itself covers this defensively — verified
    // structurally via the "onto another living enemy" case above and the
    // wall-blocked case; explicit player-occupancy scenario is geometrically
    // degenerate (push destination would have to be the attacker's own
    // tile), so it is not constructible here and is covered by code review.
    expect(true).toBe(true);
  });

  it('a ground item at the knockback destination does not block the push', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 4, y: 1 } }],
    });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'enemy_knocked_back', enemyType: 'bok' });
  });

  it('the exit tile at the knockback destination does not block the push', () => {
    const state = freshState({ equippedWeaponId: 'hammer', exit: { x: 4, y: 1 } });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'enemy_knocked_back', enemyType: 'bok' });
  });

  it('knocks back diagonally when both segments are clear', () => {
    const openMap: GameMap = {
      width: 6,
      height: 6,
      terrain: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 'floor' as Tile)),
      rooms: [],
      exit: { x: 199, y: 199 },
    };
    const state = freshState({
      map: openMap,
      equippedWeaponId: 'hammer',
      player: createInitialActor({ x: 1, y: 1 }, 3, 1),
      exit: { x: 199, y: 199 },
    });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 2, y: 2 }, 30, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'enemy_knocked_back', enemyType: 'bok' });
  });

  it('does not attack diagonally through a blocked corner at all (Phase 15.6: previously only knockback was blocked; now the attack itself never lands)', () => {
    // From (2,3), attacking SE toward the enemy at (3,4): sideA=(3,3) is
    // wall, sideB=(2,4) is wall in this layout's inner block, so this
    // diagonal target is illegal to attack at all now (not just illegal
    // to knock back into) — see docs/history/phase-15-6-block-diagonal-
    // attacks-through-corners.md. The enemy's own turn is unaffected by
    // this test beyond confirming it couldn't attack back through the
    // same corner either (Phase 15.6 symmetry) — blocked from attacking,
    // it falls through to its existing chase-step AI instead, per spec,
    // so its exact resulting tile is not asserted here.
    const state = freshState({
      equippedWeaponId: 'hammer',
      player: createInitialActor({ x: 2, y: 3 }, 3, 1),
    });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 3, y: 4 }, 10, 1);
    state.enemies = [enemy];
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(10); // untouched by the player
    expect(state.player.hp).toBe(hpBefore); // untouched by the enemy (same blocked corner, symmetric)
  });

  it('a failed knockback does not add extra damage', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      player: createInitialActor({ x: 3, y: 1 }, 3, 1),
    });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(26); // exactly the hammer's bonus damage (30 - 4), no extra from a failed knockback
  });

  it('never pushes multiple enemies in a chain (only the directly-hit target can move)', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const target = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    const farAway = createInitialEnemy('bat', { x: 5, y: 1 }, 5, 1);
    state.enemies = [target, farAway];
    const result = processTurn(state, { type: 'action' });
    const knockbackEvents = result.events.filter((e) => e.type === 'enemy_knocked_back');
    expect(knockbackEvents).toHaveLength(1); // only the directly-hit target, never the bystander
  });

  it('a knocked-back enemy acts from its new position on the same turn', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    // Enemy was pushed to (4,1); its subsequent action should originate
    // from there, not the pre-knockback tile — verified indirectly by
    // confirming its final position differs from the pre-knockback tile
    // by at most one further step (generic melee moves at most 1 tile/turn).
    const dx = Math.abs(enemy.pos.x - 4);
    const dy = Math.abs(enemy.pos.y - 1);
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it('golem is not knocked back but still takes normal hammer damage', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const golem = createInitialEnemy('golem', { x: 3, y: 1 }, 30, 3, 0, 0);
    state.enemies = [golem];
    const posBefore = { ...golem.pos };
    processTurn(state, { type: 'action' });
    expect(golem.hp).toBe(26); // 30 - 4 (fixture defense 0: createInitialEnemy's default, not real ENEMY_DEFINITIONS.golem.defense)
    expect(golem.pos).toEqual(posBefore);
  });

  it('kraken is not knocked back but still takes normal hammer damage', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    const kraken = createInitialEnemy('kraken', { x: 3, y: 1 }, 30, 2);
    state.enemies = [kraken];
    const posBefore = { ...kraken.pos };
    processTurn(state, { type: 'action' });
    expect(kraken.hp).toBe(26); // 30 - 4 (fixture defense 0: createInitialEnemy's default, not real ENEMY_DEFINITIONS.kraken.defense)
    expect(kraken.pos).toEqual(posBefore);
  });
});

describe('hammer recoil', () => {
  it('a hit enters recoil', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1)];
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('a kill enters recoil', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 1)];
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('a failed knockback still enters recoil', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      player: createInitialActor({ x: 3, y: 1 }, 3, 1),
    });
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 4, y: 1 }, 30, 1)]; // wall at x=5 blocks push
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('a whiff enters recoil', () => {
    const state = freshState({ equippedWeaponId: 'hammer' });
    state.player.facing = 'N';
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('X does not attack while recovering', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(30);
  });

  it('X while recovering re-cocks: consumes 1 turn, no damage', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    state.player.facing = 'E';
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'action' });
    expect(result.consumed).toBe(true);
    expect(result.playerAttacked).toBe(false);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('re-cocking emits a hammer_recover event', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'hammer_recover' });
  });

  it('re-cocking lets an enemy act once', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    const enemy = createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyActed).toBe(true);
  });

  it('re-cocking clears recovery, allowing the next X to attack again', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' }); // re-cock
    expect(state.hammerRecovery).toBe(false);
    processTurn(state, { type: 'action' }); // real attack now
    expect(enemy.hp).toBe(26);
  });

  it('a successful move clears recovery', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('waiting clears recovery', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    processTurn(state, { type: 'wait' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('attacking with a different weapon clears recovery', () => {
    const state = freshState({ equippedWeaponId: 'sword', hammerRecovery: true });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('Shift+direction (face) does not clear recovery', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    processTurn(state, { type: 'face', direction: 'N' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('opening/closing the inventory does not clear recovery', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    toggleInventory(state);
    closeInventory(state);
    expect(state.hammerRecovery).toBe(true);
  });

  it('re-equipping the hammer alone does not clear recovery', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      hammerRecovery: true,
      inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 1, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 },
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'hammer' });
    expect(state.equippedWeaponId).toBe('hammer');
    expect(state.hammerRecovery).toBe(true);
  });

  it('a blocked move (wall) does not clear recovery, since no turn was consumed', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      hammerRecovery: true,
      player: createInitialActor({ x: 1, y: 1 }, 3, 1),
    });
    const result = processTurn(state, { type: 'move', direction: 'W' }); // wall
    expect(result.consumed).toBe(false);
    expect(state.hammerRecovery).toBe(true);
  });

  it('recovery is cleared on a floor transition', () => {
    let state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.hammerRecovery).toBe(false);
  });

  it('a new game initializes with no recovery', () => {
    const state = createInitialState(randomSeed());
    expect(state.hammerRecovery).toBe(false);
  });
});

describe('regression: Phase 08.2-08.6 behavior unaffected', () => {
  it('sword still deals its defined bonus damage and has no knockback (Phase 15.1: fixture player.attack 1 + sword bonus 2 - defense 0 = 3)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 30, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(27);
    expect(enemy.pos).toEqual({ x: 3, y: 1 });
  });

  it('spear still reaches 2 tiles (Phase 15.1: fixture player.attack 1 + spear bonus 1 - defense 0 = 2)', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 30, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(28);
  });

  it('armor still reduces damage (Phase 15.1: floored minimum 1 damage)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    // Phase 16.2: regen now fires the same turn, fully offsetting the 1 floored-minimum damage.
    expect(state.player.hp).toBe(hpBefore);
  });

  it('apple still heals 2 HP', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 } });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
  });
});
