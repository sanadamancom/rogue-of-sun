import { ElementId } from './types';

/**
 * Shared display data for each ElementId (Phase 14.2 five-element
 * acquisition/selection). A single source of truth for the Japanese
 * display name and a minimal placeholder glyph — Phase 14.1 only
 * defined the ElementId type itself, with no display concerns; this is
 * the first phase that needs to show an element to the player (ground
 * item glyphs, HUD selection label, message log lines), so it lives in
 * its own small module rather than being bolted onto item-def.ts (whose
 * ItemDefinition is about *items*, not elements themselves — sol's own
 * display name was previously hardcoded directly in item-def.ts's
 * sol_enchantment entry and message-log.ts's enchantment_toggled case;
 * both now read from here instead, so sol's name exists in exactly one
 * place same as the other four).
 *
 * Glyphs are deliberately plain single-character/emoji placeholders
 * (fixed_specification's "新規画像は追加しない" / "仮記号、短い属性名、
 * 単色表示などで四種類を区別可能にする") — completed visual design is
 * explicitly deferred to Phase 23.
 */
export const ELEMENT_DISPLAY_NAMES: Record<ElementId, string> = {
  sol: 'ソル',
  flame: 'フレイム',
  frost: 'フロスト',
  cloud: 'クラウド',
  earth: 'アース',
};

export const ELEMENT_GLYPHS: Record<ElementId, string> = {
  sol: '🔆',
  flame: '🔥',
  frost: '❄️',
  cloud: '☁️',
  earth: '🪨',
};
