import { describe, expect, it } from 'vitest';
import { getNormalEquipmentCandidates } from '../equipment-loot';
import { getGroundItemPoolForFloor } from '../item-def';
import { selectEnemyDropItemId } from '../enemy-drop';

describe('Phase 24.6c4b availability route regression', () => {
  it('ground and equipment routes use the same absolute-depth boundary', () => {
    expect(getGroundItemPoolForFloor(4, 'descent')).not.toContain('spear');
    expect(getNormalEquipmentCandidates('spear', 0.4, { depth: 4, leg: 'descent' }).some((c) => c.definitionId === 'spear')).toBe(false);
    expect(getGroundItemPoolForFloor(5, 'descent')).toContain('spear');
    expect(getNormalEquipmentCandidates('spear', 0.5, { depth: 5, leg: 'descent' }).some((c) => c.definitionId === 'spear')).toBe(true);
  });

  it('uses canonical ground-pool boundaries independently of total run length', () => {
    expect(getGroundItemPoolForFloor(8, 'descent')).not.toContain('hammer');
    expect(getGroundItemPoolForFloor(9, 'descent')).toContain('hammer');
    expect(getGroundItemPoolForFloor(17, 'descent')).not.toContain('earth_enchantment');
    expect(getGroundItemPoolForFloor(18, 'descent')).toContain('earth_enchantment');
  });

  it('enemy-drop filtering never returns a deep item on floor 3', () => {
    for (let enemyId = 0; enemyId < 300; enemyId++) {
      const picked = selectEnemyDropItemId(3, 999, enemyId, 'descent');
      expect(['spear', 'hammer', 'frost_enchantment', 'cloud_enchantment', 'earth_enchantment']).not.toContain(picked);
    }
  });
});
