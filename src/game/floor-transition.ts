export type Leg = 'descent' | 'ascent';
export type OtencoState = 'sealed' | 'rescued';

type FloorPosition = {
  depth: number;
  leg: Leg;
  totalFloors: number;
};

function validateFloorPosition({ depth, leg, totalFloors }: FloorPosition): void {
  if (!Number.isInteger(totalFloors) || totalFloors < 2) {
    throw new RangeError(`Invalid depth=${depth}, leg=${leg}, totalFloors=${totalFloors}`);
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > totalFloors) {
    throw new RangeError(`Invalid depth=${depth}, leg=${leg}, totalFloors=${totalFloors}`);
  }
}

export function transitionFloor(input: FloorPosition & { otencoState: OtencoState }): { depth: number; leg: Leg } | 'runComplete' {
  validateFloorPosition(input);

  const { depth, leg, totalFloors, otencoState } = input;
  if (leg === 'descent') {
    return depth === totalFloors
      ? otencoState === 'rescued'
        ? { depth: totalFloors - 1, leg: 'ascent' }
        : { depth, leg: 'descent' }
      : { depth: depth + 1, leg: 'descent' };
  }

  return depth === 1 ? 'runComplete' : { depth: depth - 1, leg: 'ascent' };
}

export function floorVisitOrdinal(input: FloorPosition): number {
  validateFloorPosition(input);
  return input.leg === 'descent'
    ? input.depth
    : 2 * input.totalFloors - input.depth;
}
