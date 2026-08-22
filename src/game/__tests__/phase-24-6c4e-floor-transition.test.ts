import { describe, expect, it } from 'vitest';
import { floorVisitOrdinal, transitionFloor, type Leg } from '../floor-transition';

describe('Phase 24.6c4e floor transition', () => {
  it.each([
    [{ depth: 1, leg: 'descent', totalFloors: 26 }, { depth: 2, leg: 'descent' }],
    [{ depth: 14, leg: 'descent', totalFloors: 26 }, { depth: 15, leg: 'descent' }],
    [{ depth: 26, leg: 'descent', totalFloors: 26 }, { depth: 25, leg: 'ascent' }],
    [{ depth: 14, leg: 'ascent', totalFloors: 26 }, { depth: 13, leg: 'ascent' }],
    [{ depth: 1, leg: 'ascent', totalFloors: 26 }, 'runComplete'],
  ] as const)('transitions $0', (input, expected) => {
    expect(transitionFloor(input)).toEqual(expected);
  });

  it('uses the same state machine for a three-floor run', () => {
    expect(transitionFloor({ depth: 1, leg: 'descent', totalFloors: 3 })).toEqual({ depth: 2, leg: 'descent' });
    expect(transitionFloor({ depth: 2, leg: 'descent', totalFloors: 3 })).toEqual({ depth: 3, leg: 'descent' });
    expect(transitionFloor({ depth: 3, leg: 'descent', totalFloors: 3 })).toEqual({ depth: 2, leg: 'ascent' });
    expect(transitionFloor({ depth: 2, leg: 'ascent', totalFloors: 3 })).toEqual({ depth: 1, leg: 'ascent' });
    expect(transitionFloor({ depth: 1, leg: 'ascent', totalFloors: 3 })).toBe('runComplete');
  });

  it.each(['descent', 'ascent'] as const)('rejects a one-floor run on the %s leg', (leg) => {
    expect(() => transitionFloor({ depth: 1, leg, totalFloors: 1 })).toThrow(RangeError);
  });

  it.each(['descent', 'ascent'] as const)('rejects out-of-range depths on the %s leg', (leg) => {
    for (const depth of [0, -1, 27]) {
      expect(() => transitionFloor({ depth, leg, totalFloors: 26 })).toThrowError(
        new RangeError(`Invalid depth=${depth}, leg=${leg}, totalFloors=26`),
      );
    }
  });
});

describe('Phase 24.6c4e floor visit ordinal', () => {
  it.each([
    [{ depth: 1, leg: 'descent', totalFloors: 26 }, 1],
    [{ depth: 26, leg: 'descent', totalFloors: 26 }, 26],
    [{ depth: 25, leg: 'ascent', totalFloors: 26 }, 27],
    [{ depth: 1, leg: 'ascent', totalFloors: 26 }, 51],
  ] as const)('derives $1 for $0', (input, expected) => {
    expect(floorVisitOrdinal(input)).toBe(expected);
  });

  it('increases monotonically through a complete five-floor run', () => {
    let position: { depth: number; leg: Leg } = { depth: 1, leg: 'descent' };
    const visits: Array<{ depth: number; leg: Leg; ordinal: number }> = [];

    while (true) {
      visits.push({
        ...position,
        ordinal: floorVisitOrdinal({ ...position, totalFloors: 5 }),
      });
      const next = transitionFloor({ ...position, totalFloors: 5 });
      if (next === 'runComplete') break;
      position = next;
    }

    expect(visits).toEqual([
      { depth: 1, leg: 'descent', ordinal: 1 },
      { depth: 2, leg: 'descent', ordinal: 2 },
      { depth: 3, leg: 'descent', ordinal: 3 },
      { depth: 4, leg: 'descent', ordinal: 4 },
      { depth: 5, leg: 'descent', ordinal: 5 },
      { depth: 4, leg: 'ascent', ordinal: 6 },
      { depth: 3, leg: 'ascent', ordinal: 7 },
      { depth: 2, leg: 'ascent', ordinal: 8 },
      { depth: 1, leg: 'ascent', ordinal: 9 },
    ]);
  });

  it.each(['descent', 'ascent'] as const)('rejects invalid ranges on the %s leg', (leg) => {
    expect(() => floorVisitOrdinal({ depth: 1, leg, totalFloors: 1 })).toThrow(RangeError);
    for (const depth of [0, -1, 27]) {
      expect(() => floorVisitOrdinal({ depth, leg, totalFloors: 26 })).toThrow(RangeError);
    }
  });
});
