import { getEnemyPopulationForDepth } from './enemy-depth-bands';

/** Canonical regular-reinforcement tuning for the full 26-floor run. */
export interface ReinforcementRule {
  cadenceTurns: number;
  capBonus: number;
}

export function getReinforcementRule(floor: number): ReinforcementRule {
  return {
    cadenceTurns: getEnemyPopulationForDepth(floor).reinforcementIntervalTurns,
    capBonus: 2,
  };
}
