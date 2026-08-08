import { describe, expect, it } from 'vitest';
import {
  getMinimapTrapMarkers,
  MINIMAP_TRAP_TRIGGERED_ALPHA,
  MINIMAP_TRAP_UNTRIGGERED_ALPHA,
} from '../minimap';
import { advanceToNextFloor, createInitialState } from '../state';
import { TrapTile } from '../types';

describe('minimap trap markers (Phase 18.2 audit)', () => {
  it('a hidden (revealed=false) trap produces no marker', () => {
    const trap: TrapTile = { id: 0, pos: { x: 3, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    expect(getMinimapTrapMarkers([trap])).toHaveLength(0);
  });

  it('a revealed_untriggered trap (revealed=true, triggered=false) is included', () => {
    const trap: TrapTile = { id: 0, pos: { x: 3, y: 3 }, revealed: true, triggered: false, trapType: 'slow_trap' };
    const markers = getMinimapTrapMarkers([trap]);
    expect(markers).toHaveLength(1);
    expect(markers[0].pos).toEqual({ x: 3, y: 3 });
  });

  it('a triggered_inactive trap (revealed=true, triggered=true) is included', () => {
    const trap: TrapTile = { id: 0, pos: { x: 3, y: 3 }, revealed: true, triggered: true, trapType: 'poison_trap' };
    const markers = getMinimapTrapMarkers([trap]);
    expect(markers).toHaveLength(1);
    expect(markers[0].pos).toEqual({ x: 3, y: 3 });
  });

  it('revealed_untriggered and triggered_inactive are visually distinguishable (different alpha)', () => {
    const untriggered: TrapTile = { id: 0, pos: { x: 3, y: 3 }, revealed: true, triggered: false, trapType: 'slow_trap' };
    const triggered: TrapTile = { id: 1, pos: { x: 5, y: 3 }, revealed: true, triggered: true, trapType: 'slow_trap' };
    const markers = getMinimapTrapMarkers([untriggered, triggered]);
    const untriggeredMarker = markers.find((m) => m.pos.x === 3)!;
    const triggeredMarker = markers.find((m) => m.pos.x === 5)!;
    expect(untriggeredMarker.alpha).toBe(MINIMAP_TRAP_UNTRIGGERED_ALPHA);
    expect(triggeredMarker.alpha).toBe(MINIMAP_TRAP_TRIGGERED_ALPHA);
    expect(untriggeredMarker.alpha).not.toBe(triggeredMarker.alpha);
  });

  it('a clairvoyance-revealed trap (revealed=true) still produces a marker with no other input than the trap itself', () => {
    // The function's signature takes only the traps array — no
    // exploredTiles/visibility/dark-room parameter exists to gate on, so
    // a trap revealed by clairvoyance in never-explored territory is
    // indistinguishable here from one revealed by stepping on it; both
    // simply have revealed=true and produce a marker.
    const trap: TrapTile = { id: 0, pos: { x: 12, y: 5 }, revealed: true, triggered: false, trapType: 'poison_trap' };
    const markers = getMinimapTrapMarkers([trap]);
    expect(markers).toHaveLength(1);
  });

  it('markers carry only position and alpha — never terrain, wall, or room data', () => {
    const trap: TrapTile = { id: 0, pos: { x: 3, y: 3 }, revealed: true, triggered: false, trapType: 'slow_trap' };
    const [marker] = getMinimapTrapMarkers([trap]);
    expect(Object.keys(marker).sort()).toEqual(['alpha', 'pos']);
  });

  it('is independent of any exploredTiles/visibility/dark-room state (no such parameter exists)', () => {
    // getMinimapTrapMarkers.length reflects its parameter count; asserting
    // it here pins the "traps only" signature so a future edit can't
    // silently add a gating parameter without this test failing first.
    expect(getMinimapTrapMarkers.length).toBe(1);
  });

  it('a fresh floor never surfaces the previous floor\'s revealed trap markers', () => {
    const state = createInitialState(4242);
    for (const trap of state.traps ?? []) {
      trap.revealed = true;
      trap.triggered = true;
    }
    const beforeMarkers = getMinimapTrapMarkers(state.traps);
    expect(beforeMarkers.length).toBeGreaterThan(0);

    const next = advanceToNextFloor(state);
    const nextMarkers = getMinimapTrapMarkers(next.traps);
    // Every marker on the new floor must come from a freshly revealed=false
    // trap set, i.e. there should be none at all yet (nothing stepped on
    // or clairvoyance-used this floor).
    expect(nextMarkers).toHaveLength(0);
  });

  it('handles an undefined traps array (pre-Phase-18.1 GameState shape) as no markers', () => {
    expect(getMinimapTrapMarkers(undefined)).toHaveLength(0);
  });
});
