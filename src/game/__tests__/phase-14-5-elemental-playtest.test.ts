import { describe, expect, it } from 'vitest';
import { formatEvent } from '../message-log';
import { ALL_ELEMENT_IDS, ELEMENT_DISPLAY_NAMES } from '../element-def';
import { ELEMENT_ENCHANTMENT_SOL_COST } from '../turn';
import { GameEvent } from '../events';
import { ElementId } from '../types';

describe('Phase 14.5: weak/neutral/resist message-log differentiation', () => {
  it('sol_enchantment_used: weak gets dedicated wording', () => {
    const ev: GameEvent = {
      type: 'sol_enchantment_used',
      weaponId: 'sword',
      enemyType: 'bok',
      solBefore: 5,
      solAfter: 4,
      baseDamage: 10,
      bonusDamage: 15,
      element: 'sol',
      affinity: 'weak',
    };
    expect(formatEvent(ev)).toBe('ソルの力が弱点を突いた！');
  });

  it('sol_enchantment_used: neutral keeps the original wording', () => {
    const ev: GameEvent = {
      type: 'sol_enchantment_used',
      weaponId: 'sword',
      enemyType: 'spider',
      solBefore: 5,
      solAfter: 4,
      baseDamage: 10,
      bonusDamage: 10,
      element: 'sol',
      affinity: 'neutral',
    };
    expect(formatEvent(ev)).toBe('ソルの力が攻撃に宿った。');
  });

  it('sol_enchantment_used: resist gets dedicated wording', () => {
    const ev: GameEvent = {
      type: 'sol_enchantment_used',
      weaponId: 'sword',
      enemyType: 'spider',
      solBefore: 5,
      solAfter: 4,
      baseDamage: 10,
      bonusDamage: 5,
      element: 'sol',
      affinity: 'resist',
    };
    expect(formatEvent(ev)).toBe('ソルの力が軽減された。');
  });

  const otherElements: Exclude<ElementId, 'sol'>[] = ['flame', 'frost', 'cloud', 'earth'];

  for (const element of otherElements) {
    it(`element_enchantment_used (${element}): weak gets dedicated wording`, () => {
      const ev: GameEvent = {
        type: 'element_enchantment_used',
        element,
        affinity: 'weak',
        weaponId: 'sword',
        enemyType: 'bok',
        solBefore: 5,
        solAfter: 3,
        physicalDamage: 10,
        elementalDamage: 15,
      };
      expect(formatEvent(ev)).toBe(`${ELEMENT_DISPLAY_NAMES[element]}の力が弱点を突いた！`);
    });

    it(`element_enchantment_used (${element}): neutral keeps the shared wording`, () => {
      const ev: GameEvent = {
        type: 'element_enchantment_used',
        element,
        affinity: 'neutral',
        weaponId: 'sword',
        enemyType: 'spider',
        solBefore: 5,
        solAfter: 3,
        physicalDamage: 10,
        elementalDamage: 10,
      };
      expect(formatEvent(ev)).toBe(`${ELEMENT_DISPLAY_NAMES[element]}の力が攻撃に宿った。`);
    });

    it(`element_enchantment_used (${element}): resist gets dedicated wording`, () => {
      const ev: GameEvent = {
        type: 'element_enchantment_used',
        element,
        affinity: 'resist',
        weaponId: 'sword',
        enemyType: 'spider',
        solBefore: 5,
        solAfter: 3,
        physicalDamage: 10,
        elementalDamage: 5,
      };
      expect(formatEvent(ev)).toBe(`${ELEMENT_DISPLAY_NAMES[element]}の力が軽減された。`);
    });
  }
});

describe('Phase 14.5: shared HUD data sources', () => {
  it('ALL_ELEMENT_IDS lists exactly the five elements', () => {
    expect(ALL_ELEMENT_IDS.slice().sort()).toEqual(['cloud', 'earth', 'flame', 'frost', 'sol'].sort());
  });

  it('ELEMENT_ENCHANTMENT_SOL_COST is exported and matches the confirmed per-element costs', () => {
    expect(ELEMENT_ENCHANTMENT_SOL_COST).toEqual({
      sol: 1,
      flame: 2,
      frost: 2,
      cloud: 2,
      earth: 2,
    });
  });

  it('every ALL_ELEMENT_IDS entry has an ELEMENT_DISPLAY_NAMES entry and an ELEMENT_ENCHANTMENT_SOL_COST entry', () => {
    for (const id of ALL_ELEMENT_IDS) {
      expect(ELEMENT_DISPLAY_NAMES[id]).toBeTruthy();
      expect(ELEMENT_ENCHANTMENT_SOL_COST[id]).toBeGreaterThan(0);
    }
  });
});
