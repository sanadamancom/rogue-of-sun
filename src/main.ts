import Phaser from 'phaser';
import { toDirection4 } from './game/direction';
import { ENEMY_DEFINITIONS } from './game/enemy-def';
import { ITEM_DEFINITIONS } from './game/item-def';
import { CARD_DEFINITIONS, CARD_IDS_IN_ORDER } from './game/card-def';
import {
  beginCardTargetSelection,
  CardTargetSelectionState,
  confirmCardTargetSelection,
  describeCardTargetCandidate,
  isTargetSelectableItemId,
  moveCardTargetCursor,
  PendingCardTargetEffectHolder,
  refreshCardTargetSelection,
} from './game/card-target-selection';
import { ELEMENT_DISPLAY_NAMES, ALL_ELEMENT_IDS } from './game/element-def';
import { ARMOR_DEFINITIONS } from './game/armor-def';
import { WEAPON_DEFINITIONS } from './game/weapon-def';
import {
  closeInventory,
  inventoryEntries,
  INVENTORY_CAPACITY,
  moveInventorySelection,
  toggleInventory,
  selectedEquipmentInstanceId,
  selectedInventoryAction,
  selectedInventoryEntry,
  selectedItemId,
  totalInventoryCount,
  useSelectedInventoryItem,
} from './game/inventory';
import { formatEvent, formatEvents, MessageLog } from './game/message-log';
import { advanceToNextFloor, createInitialState, randomSeed } from './game/state';
import {
  buildExportFilename,
  buildTelemetryDocument,
  computeRunSummary,
  createRunTelemetry,
  finalizeRun,
  recordAbilityAllocation,
  recordFloorStarted,
  recordTurn,
  snapshotForTurn,
  RunTelemetry,
} from './game/telemetry';
import { getCockatriceTelegraph, getKrakenTelegraph, getGolemChargeTelegraph, getStepsTelegraph } from './game/telegraph';
import { getHunger, HUNGER_MAX } from './game/hunger';
import { getExperience, getExperienceRequirement, getLevel, getUnspentAbilityPoints, LEVEL_CAP } from './game/progression';
import {
  ABILITY_DISPLAY_NAMES,
  ABILITY_IDS,
  cancelAbilityConfirm,
  closeAbilityOverlay,
  formatAbilityEffectLine,
  getAbilities,
  moveAbilitySelection,
  openAbilityConfirm,
  resolveAbilityConfirm,
  toggleAbilityConfirmChoice,
  toggleAbilityOverlay,
} from './game/ability';
import { EFFECT_DEFINITIONS, getActiveEffects } from './game/effects';
import { processTurn, TurnResult, ELEMENT_ENCHANTMENT_SOL_COST, isCardIdentified, getSolarGunEffectiveElement, isGhostInsideWall } from './game/turn';
import { shouldDisplayStepsBody } from './game/steps';
import { DIRECTION_VECTORS, EnemyType, EnemyActor, GameState, GameMap, Direction8, Vec2 } from './game/types';
import { CAMERA_VIEW_WIDTH, CAMERA_VIEW_HEIGHT } from './game/camera';
import { canTakeDashStep, shouldStopDashAfterStep } from './game/dash';
import {
  routeKeyDown,
  InputContext,
  isTurnOnlyModifierKey,
  directionForKey,
  createRepeatTimer,
  startRepeat,
  stopRepeat,
  tickRepeat,
  RepeatTimer,
} from './game/input-router';
import { roomIndexContaining } from './game/mapgen';
import { getMinimapTrapMarkers, getMinimapStepsMarkers } from './game/minimap';
import { computeCurrentVisibility, isInRoomBounds, pointKey as visibilityPointKey } from './game/visibility';
import { DARK_ROOM_FLOOR_COLOR, DARK_ROOM_WALL_COLOR, darkRoomBand } from './game/dark-room-visuals';

// Phase 14.5 spec 5.2: 2 lines by default (was 3). Newest at the bottom,
// oldest pushed out once over capacity; overflow history is available via
// the new 記録 (records) menu screen instead of being shown inline.
const MESSAGE_LOG_CAPACITY = 2;

const TILE_SIZE = 48;
// Phase 14.5 UI/input overhaul: fixed logical resolution, not dynamically
// recomputed per window size (per the redesign direction — "TILE_SIZEその
// ものを画面サイズに応じて動的変更することを前提にしない"). The 9x7 field
// size is camera.ts's single source of truth (CAMERA_VIEW_WIDTH/HEIGHT);
// VIEWPORT_TILES_WIDE/HIGH below are aliases so the many existing call
// sites that already reference these names keep working unchanged.
const VIEWPORT_TILES_WIDE = CAMERA_VIEW_WIDTH;
const VIEWPORT_TILES_HIGH = CAMERA_VIEW_HEIGHT;
const FIELD_PIXEL_WIDTH = VIEWPORT_TILES_WIDE * TILE_SIZE;
const FIELD_PIXEL_HEIGHT = VIEWPORT_TILES_HIGH * TILE_SIZE;
// One HUD line (spec 5.1) and two message lines (spec 5.2), each as a
// fixed-height screen strip outside the field viewport (spec 5's "HUDと
// メッセージウィンドウは、フィールドを覆わない独立領域とする").
const HUD_HEIGHT = 30;
const MESSAGE_HEIGHT = 68;
const LOGICAL_WIDTH = FIELD_PIXEL_WIDTH;
const LOGICAL_HEIGHT = HUD_HEIGHT + FIELD_PIXEL_HEIGHT + MESSAGE_HEIGHT;

/**
 * Phase 14.5 UI/input overhaul color tokens (spec section 8): a single
 * source of truth so no screen hardcodes a near-duplicate hex value.
 * Structure follows SFC-Shiren, palette/mood follows Bokura no Taiyou
 * per the spec's "構造はシレン型、配色はボクタイ型" — these are original
 * hex values chosen to match the *description* in spec section 8 (ivory
 * panel / deep red-brown border / ochre-to-pale-orange inner line / dark
 * brown text / muted red-brown heading / sun-yellow SOL / etc.), not
 * colors sampled from any reference image (spec 3.3's "参照作品の画像、
 * 枠、フォント、アイコン、装飾の直接流用" is excluded).
 */
const COLORS = {
  panelBg: 0xf5ecd7,
  panelBgAlpha: 0.94,
  borderOuter: 0x7a2e1d,
  borderInner: 0xd9a441,
  textNormal: 0x3b2a1a,
  textHeading: 0x9a4630,
  textDisabled: 0x8a7a68,
  selectionBg: 0x7a2e1d,
  selectionText: 0xf5ecd7,
  hp: 0x3f9142,
  sol: 0xf2b705,
  hunger: 0xd98324,
  danger: 0xc0392b,
} as const;

// Sprite sheet layout (shared by player.png and bok_lv1.png):
// 3 columns (frames) x 4 rows (directions), each cell 24x32 px in the
// source art (unmodified). Slicing uses this native size so a frame never
// pulls in pixels from an adjacent frame; only the *display* width is
// stretched afterward via a non-uniform sprite scale (cheap GPU-side
// affine transform, same cost as a uniform scale — no extra texture
// memory or load time from enlarging the source asset).
// Row order: up, right, down, left.
const SPRITE_FRAME_WIDTH = 24;
const SPRITE_FRAME_HEIGHT = 32;
const SPRITE_SCALE_Y = 1.5;
// Target display width equal to the display height (SPRITE_FRAME_HEIGHT *
// SPRITE_SCALE_Y = 48), i.e. a square final sprite — not just 32 raw
// pixels, which would end up *narrower* than the original 24*1.5=36.
const SPRITE_DISPLAY_WIDTH = SPRITE_FRAME_HEIGHT * SPRITE_SCALE_Y;
const SPRITE_SCALE_X = SPRITE_DISPLAY_WIDTH / SPRITE_FRAME_WIDTH;
const FRAMES_PER_ROW = 3;
const IDLE_COLUMN = 1; // middle frame used as the standing pose

const DIRECTION4_ROW: Record<'N' | 'E' | 'S' | 'W', number> = {
  N: 0,
  E: 1,
  S: 2,
  W: 3,
};

function idleFrame(dir4: 'N' | 'E' | 'S' | 'W'): number {
  return DIRECTION4_ROW[dir4] * FRAMES_PER_ROW + IDLE_COLUMN;
}

function walkFrames(dir4: 'N' | 'E' | 'S' | 'W'): number[] {
  const base = DIRECTION4_ROW[dir4] * FRAMES_PER_ROW;
  // 1 -> 2 -> 3 -> 2 (looping mid-stride pattern), shown while moving.
  return [base, base + 1, base + 2, base + 1];
}

function walkAnimKey(spriteKey: string, dir4: 'N' | 'E' | 'S' | 'W'): string {
  return `${spriteKey}-walk-${dir4}`;
}

// Chroma key color used by the supplied enemy sprite sheets (exact match
// only; no threshold/approximate color matching).
const CHROMA_KEY_R = 0;
const CHROMA_KEY_G = 255;
const CHROMA_KEY_B = 0;

// 'player' and 'bok_lv1' already ship with real alpha transparency and are
// loaded directly as spritesheets (see preload()). Every other species'
// source PNG uses an opaque chroma-key background instead, so each one is
// loaded as a plain raw image here and re-derived into a transparent,
// frame-sliced spritesheet texture at runtime by createChromaKeyTexture(),
// without modifying any source file on disk.
const NATIVE_TRANSPARENT_SPRITE_KEYS = new Set(['player', 'bok_lv1']);

function rawKeyFor(spriteKey: string): string {
  return `${spriteKey}_raw`;
}

function textureKeyForEnemyType(type: EnemyType): string {
  return ENEMY_DEFINITIONS[type].spriteKey;
}

/**
 * Phase 23.1: sprite keys used by the game that are NOT any species'
 * own EnemyDefinition.spriteKey — currently just skeleton's separate
 * head sprite (public/assets/sprites/skeleton_head.png), which
 * spriteKeyForEnemy below selects only while a skeleton is in its
 * 'head' form. Kept as its own small list (rather than adding a fake
 * EnemyDefinition entry) so ENEMY_DEFINITIONS/ENEMY_TYPES_IN_ORDER stay
 * exactly "one entry per playable species" with no non-species entries
 * mixed in.
 */
const EXTRA_SPRITE_KEYS = ['skeleton_head', 'claygolem_rolling', 'steps_see'];

/** All distinct sprite sheet keys used by the current 10-species roster, in fixed roster order, plus any extra non-species sprite keys (EXTRA_SPRITE_KEYS). */
function allEnemySpriteKeys(): string[] {
  return [...Object.values(ENEMY_DEFINITIONS).map((def) => def.spriteKey), ...EXTRA_SPRITE_KEYS];
}

/**
 * Phase 23.1: the sprite sheet key to actually render `enemy` with —
 * the single, purely-descriptive boundary between EnemyActor state and
 * sprite selection referenced everywhere a sprite is drawn/retextured,
 * so no call site needs its own skeleton-specific branch (Stage 3's
 * "描画コード内へスケルトン専用ifを複数散在させない"). Every species
 * other than a head-form skeleton is identical to
 * textureKeyForEnemyType(enemy.type).
 */
function spriteKeyForEnemy(enemy: EnemyActor, clairvoyanceActive: boolean = false): string {
  if (enemy.type === 'skeleton' && enemy.skeletonForm === 'head') return 'skeleton_head';
  // Phase 23.2: rolling sprite only while a golem's charge is actually
  // telegraphed — idle and recovering both use the normal claygolem
  // sprite (weapon-def/sprite regression: this never changes which
  // terrain/traps a golem can cross, purely cosmetic).
  if (enemy.type === 'golem' && enemy.golemChargeState === 'telegraphed') return 'claygolem_rolling';
  // Phase 23.4: revealed-visibility body sprite (steps_see) whenever
  // this individual's own combat state is 'revealed', or unconditionally
  // whenever clairvoyance is active on the current floor — the single
  // shared display-eligibility check (shouldDisplayStepsBody), never
  // duplicated here or anywhere else.
  if (enemy.type === 'steps' && shouldDisplayStepsBody(enemy, clairvoyanceActive)) return 'steps_see';
  return textureKeyForEnemyType(enemy.type);
}

/**
 * Phase 23.3: the display alpha for `enemy` — the single pure boundary
 * deciding ghost's wall/floor half-transparency (fixed_spec's "ghost専
 * 用の表示可否とalphaを決めるpure helperを用意する"), so no per-call-site
 * ghost-specific branching is needed anywhere else. Every non-ghost
 * species, and a floor-standing ghost, always resolves to 1 — only a
 * wall-phased ghost (isGhostInsideWall) resolves to the minimal 0.5
 * semi-transparent placeholder (fixed_spec's "wall内表示はalpha 0.5の
 * 最小半透明表現とする" — completed translucency/floating visuals are
 * deferred to Phase 25). Overall sprite visibility (whether it's drawn
 * at all) is governed separately by the existing currentVisible gate
 * (snapActor/animateMove's `extraVisible`) — this only ever affects
 * opacity once something has already been decided visible.
 */
function ghostDisplayAlpha(map: GameMap, enemy: EnemyActor): number {
  return isGhostInsideWall(map, enemy) ? 0.5 : 1;
}

class MainScene extends Phaser.Scene {
  private state!: GameState;
  // Run telemetry (Phase 10.3.1): owned entirely by MainScene, never
  // stored on GameState (see telemetry.ts's module doc comment). Reset
  // wholesale on every new run in create()/restart(); never mutated by
  // anything except recordTurn/finalizeRun, both of which are pure with
  // respect to `this.state`.
  private telemetry!: RunTelemetry;
  // End-screen DOM overlay (Phase 10.3.1): a plain HTML element layered
  // over the Phaser canvas rather than rendered via Phaser Text/Graphics,
  // since the required report (weapon table, per-floor table, scrolling,
  // a keyboard-focusable save button) is far more naturally expressed as
  // ordinary HTML than as canvas drawing. Created once in create();
  // never destroyed, only shown/hidden.
  private endScreenOverlay!: HTMLDivElement;
  private endScreenShownForTelemetry: RunTelemetry | null = null;
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private exitGraphics!: Phaser.GameObjects.Graphics;
  private webGraphics!: Phaser.GameObjects.Graphics;
  // Phase 12.2 slow trap: revealed-trap markers only (untriggered traps
  // render as plain floor — nothing drawn for them at all). Its own
  // Graphics layer, same reasoning as webGraphics (created before actor
  // sprites so actors always render on top; redrawn each turn/reset).
  private trapGraphics!: Phaser.GameObjects.Graphics;
  // phase-07-1-ranged-attack-telegraph-reticle-only: two layers, both
  // created above the player/enemy sprites (layer_order: 床と地形 →
  // (アイテムなし) → プレイヤーと敵 → 標的マスの照準アイコン → 攻撃準備
  // 中の敵マーカー). No per-frame animation — both are static, redrawn
  // only once per turn/reset from drawTelegraphs().
  private telegraphReticleGraphics!: Phaser.GameObjects.Graphics;
  private telegraphMarkerGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private enemySprites: Phaser.GameObjects.Sprite[] = [];
  private hudText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private readonly messageLog = new MessageLog(MESSAGE_LOG_CAPACITY);
  /**
   * Uncapped-in-practice (soft-capped at MESSAGE_HISTORY_LIMIT) scene-local
   * history of every line ever pushed to messageLog, for the 記録
   * (records) menu screen's message history (spec 5.2's "一度に表示しき
   * れない履歴は「記録」から確認可能にする" / 9.7's message history
   * item). Never part of GameState or telemetry — purely a UI
   * convenience, reset alongside messageLog.clear() at every floor
   * change/restart (see pushMessage/pushMessages/clearMessages below,
   * the only way messageLog is ever touched).
   */
  private messageHistory: string[] = [];
  private readonly MESSAGE_HISTORY_LIMIT = 300;

  private pushMessage(line: string): void {
    this.messageLog.push(line);
    this.messageHistory.push(line);
    if (this.messageHistory.length > this.MESSAGE_HISTORY_LIMIT) {
      this.messageHistory = this.messageHistory.slice(this.messageHistory.length - this.MESSAGE_HISTORY_LIMIT);
    }
  }
  private pushMessages(lines: string[]): void {
    for (const line of lines) this.pushMessage(line);
  }
  private clearMessages(): void {
    this.messageLog.clear();
    this.messageHistory = [];
  }
  private logPanelBg!: Phaser.GameObjects.Graphics;
  private logPanelText!: Phaser.GameObjects.Text;
  // Phase 08.2: ground-item glyphs (plain emoji text, no image asset).
  private groundItemTexts: Phaser.GameObjects.Text[] = [];
  // Phase 08.6: minimal 8-direction facing marker (a small dot offset from
  // the player's tile center toward player.facing), since the player
  // sprite itself only distinguishes 4 directions (see toDirection4). No
  // new image asset — plain Graphics, same rule for all 8 directions.
  private facingMarker!: Phaser.GameObjects.Graphics;
  // Phase 14.5: the old Tab-toggled inventory overlay and P-toggled
  // ability overlay (their own dedicated Graphics+Text pairs) are
  // replaced by the unified small-window menu system below
  // (menuOverlayBg/Text + menuDetailBg/Text) — see createMenuOverlay.

  // ----- Phase 14.5 UI/input overhaul additions -----

  /**
   * Second Phaser camera covering the full logical canvas, used for
   * every screen-fixed UI element (HUD strip, message strip, minimap,
   * every menu window). `this.cameras.main` ("the world camera") is
   * instead clipped to just the field sub-rectangle via setViewport and
   * follows the player with bounds clamping — the existing 9x7-window
   * behavior the spec asks for. Each camera `.ignore()`s the other's
   * objects (see ignoreForWorldCamera/ignoreForUiCamera below) so
   * nothing is drawn twice and UI never scrolls with the world (redesign
   * direction's "HUDやメニューはworld cameraのscrollに追従させない" /
   * "二重表示されないようignore設定...で分離する").
   */
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;

  private ignoreForUiCamera(obj: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]): void {
    this.uiCamera.ignore(obj);
  }
  private ignoreForWorldCamera(obj: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]): void {
    this.cameras.main.ignore(obj);
  }

  /**
   * Per-floor, scene-local exploration memory (Phase 17.1's
   * `explored_not_visible` vs `unexplored` distinction, superseding the
   * old Phase 14.5 "have I ever had this tile inside the 9x7 camera
   * window" record). Deliberately NOT part of GameState: it never affects
   * gameplay, RNG, seeds, or telemetry — purely a rendering aid, reset
   * whenever the floor changes or the run restarts. Sized to the current
   * floor's map on each reset.
   */
  private exploredTiles: boolean[][] = [];
  /**
   * Per-turn `currently_visible` set (Phase 17.1), recomputed by
   * updateVisibility() from src/game/visibility.ts's pure
   * computeCurrentVisibility. Keys are `${x},${y}` (visibilityPointKey).
   * Rebuilt from scratch every call — never accumulated — since "currently
   * visible" only ever describes this exact turn/frame.
   */
  private currentVisible: Set<string> = new Set();
  private minimapGraphics!: Phaser.GameObjects.Graphics;

  private resetExploredTiles(): void {
    const { width, height } = this.state.map;
    this.exploredTiles = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  }

  /**
   * Recomputes this turn's `currently_visible` set (src/game/
   * visibility.ts's computeCurrentVisibility — whole room + each
   * connected corridor's first tile while standing in a room, or radius-4
   * symmetric-shadowcasting FOV otherwise) and folds every one of those
   * tiles into the per-floor exploration memory (`exploredTiles`), so a
   * tile once seen stays `explored_not_visible` after the player moves
   * away rather than reverting to `unexplored`. Pure-function visibility
   * math lives entirely in visibility.ts; this method only owns the
   * per-floor accumulation and the per-turn snapshot, matching Phase
   * 17.1's separation_of_responsibilities (visibility_module vs
   * exploration_owner vs renderer).
   */
  private updateVisibility(): void {
    const visible = computeCurrentVisibility(this.state.map, this.state.map.rooms, this.state.player.pos);
    this.currentVisible = new Set(visible.map(visibilityPointKey));
    for (const p of visible) {
      if (this.exploredTiles[p.y]) this.exploredTiles[p.y][p.x] = true;
    }
  }

  private isCurrentlyVisible(pos: { x: number; y: number }): boolean {
    return this.currentVisible.has(visibilityPointKey(pos));
  }

  // ----- Phase 14.5 input: dash / long-press repeat / F(turn-only) held state -----

  private fHeld = false;
  private moveRepeat: RepeatTimer = createRepeatTimer();
  private waitRepeat: RepeatTimer = createRepeatTimer();
  /** Direction currently being dashed (Shift held), or null when not dashing. */
  private dashDirection: Direction8 | null = null;
  private dashRepeat: RepeatTimer = createRepeatTimer();

  // ----- Phase 14.5 SFC-style small-window menu -----

  private menuScreen: 'closed' | 'root' | 'items' | 'item_actions' | 'card_target_selection' | 'ability' | 'status' | 'records' | 'other' | 'help' | 'confirm_quit' = 'closed';
  private menuRootIndex = 0;
  private itemActionIndex = 0;
  /** Phase 20.0d: transient UI state for temperance/star's target-selection screen — never a GameState field (see card-target-selection.ts's CardTargetSelectionState doc comment). */
  private cardTargetSelection: CardTargetSelectionState | null = null;
  /**
   * Phase 20.0d correction: encapsulated lifecycle holder for a
   * successful CardTargetEffectTransaction, awaiting a future commit
   * step (Phase 20.5a) — never a GameState field, never persisted.
   * Private storage inside PendingCardTargetEffectHolder itself (see
   * card-target-selection.ts); this field only ever calls that class's
   * own methods (`setFromTransaction`, `clear`, `peek`/`take`), never
   * assigns into its internals directly. Cleared via `.clear()` whenever
   * a new selection begins, on cancel, on a stale-target rejection, and
   * on restart — and (this phase) `.take()`/`.peek()` are never called
   * to commit anything into `this.state` — see the
   * 'card_target_selection' confirm handler.
   */
  private readonly pendingCardTargetEffect = new PendingCardTargetEffectHolder();
  private otherIndex = 0;
  private confirmQuitIndex = 0; // 0 = cancel (default), 1 = confirm
  private menuOverlayBg!: Phaser.GameObjects.Graphics;
  private menuOverlayText!: Phaser.GameObjects.Text;
  private menuDetailBg!: Phaser.GameObjects.Graphics;
  private menuDetailText!: Phaser.GameObjects.Text;

  constructor() {
    super('main');
  }

  preload(): void {
    this.load.spritesheet('player', 'assets/sprites/player.png', {
      frameWidth: SPRITE_FRAME_WIDTH,
      frameHeight: SPRITE_FRAME_HEIGHT,
    });
    this.load.spritesheet('bok_lv1', 'assets/sprites/bok_lv1.png', {
      frameWidth: SPRITE_FRAME_WIDTH,
      frameHeight: SPRITE_FRAME_HEIGHT,
    });
    // Every other species' source PNG has an opaque chroma-key background,
    // not real alpha transparency, so each is loaded as a plain
    // (non-spritesheet) raw image here; create() derives a transparent
    // spritesheet texture from each raw image at runtime (see
    // createChromaKeyTexture()), without modifying any source file.
    for (const spriteKey of allEnemySpriteKeys()) {
      if (NATIVE_TRANSPARENT_SPRITE_KEYS.has(spriteKey)) continue;
      this.load.image(rawKeyFor(spriteKey), `assets/sprites/${spriteKey}.png`);
    }
  }

  create(): void {
    this.state = createInitialState(randomSeed());
    this.telemetry = createRunTelemetry(this.state);

    // Phase 17.1: exploration memory and the current-turn visibility set
    // must exist before the very first drawTerrain/drawExit/
    // drawGroundItems call below, since those now read them (unexplored
    // tiles are not drawn at all).
    this.resetExploredTiles();
    this.updateVisibility();

    this.terrainGraphics = this.add.graphics();
    this.exitGraphics = this.add.graphics();
    this.webGraphics = this.add.graphics();
    this.trapGraphics = this.add.graphics();
    this.drawTerrain();
    this.drawExit();
    this.drawWebs();
    this.drawTraps();
    this.drawGroundItems();

    this.playerSprite = this.add.sprite(0, 0, 'player', idleFrame('S'));
    this.facingMarker = this.add.graphics();
    this.playerSprite.setScale(SPRITE_SCALE_X, SPRITE_SCALE_Y);
    this.createWalkAnimations('player');
    for (const spriteKey of allEnemySpriteKeys()) {
      if (!NATIVE_TRANSPARENT_SPRITE_KEYS.has(spriteKey)) {
        this.createChromaKeyTexture(spriteKey);
      }
      this.createWalkAnimations(spriteKey);
    }
    this.rebuildEnemySprites();
    // Above player/enemy sprites (created after them), per layer_order:
    // 標的マスの照準アイコン → 攻撃準備中の敵マーカー (marker last/topmost).
    this.telegraphReticleGraphics = this.add.graphics();
    this.telegraphMarkerGraphics = this.add.graphics();

    this.hudText = this.add
      .text(8, 6, '', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#3b2a1a',
      })
      .setScrollFactor(0);

    this.messageText = this.add
      .text(LOGICAL_WIDTH / 2, HUD_HEIGHT + FIELD_PIXEL_HEIGHT / 2, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 12, y: 8 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    this.createLogPanel();
    this.createMenuOverlay();
    this.createEndScreenOverlay();

    // Phase 14.5 minimap: a screen-fixed (scrollFactor 0) Graphics layer
    // sized to exactly the field viewport, drawn by the world camera
    // (see the ignore-partitioning below) so it visually sits inside the
    // 9x7 field without panning with it.
    this.minimapGraphics = this.add.graphics().setScrollFactor(0).setDepth(50);

    // ----- Phase 14.5: two-camera split (world vs UI) -----
    // this.cameras.main ("world camera") is clipped to just the field
    // sub-rectangle and follows the player with bounds clamping — the
    // existing Phaser camera-follow system already does exactly the
    // "center on player, clamp at map edges" behavior spec 6.1 asks for,
    // so no per-frame manual coordinate math is needed for it. Phase 17.1
    // replaced the old camera-window-based explored-map bookkeeping with
    // src/game/visibility.ts's real FOV (see updateVisibility()); camera.ts
    // now only defines the 9x7 viewport itself (CAMERA_VIEW_WIDTH/HEIGHT).
    const mapPixelWidth = this.state.map.width * TILE_SIZE;
    const mapPixelHeight = this.state.map.height * TILE_SIZE;
    this.cameras.main.setViewport(0, HUD_HEIGHT, FIELD_PIXEL_WIDTH, FIELD_PIXEL_HEIGHT);
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);
    this.cameras.main.startFollow(this.playerSprite, true, 1, 1);

    // this.uiCamera covers the whole logical canvas and never scrolls —
    // every screen-fixed UI element (HUD strip, message strip, minimap,
    // every menu window) is drawn only by this camera, never by the
    // (viewport-clipped, panning) world camera, so nothing renders twice
    // and the UI never scrolls with the world.
    this.uiCamera = this.cameras.add(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    this.ignoreForWorldCamera([
      this.hudText,
      this.messageText,
      this.logPanelBg,
      this.logPanelText,
      this.menuOverlayBg,
      this.menuOverlayText,
      this.menuDetailBg,
      this.menuDetailText,
    ]);
    this.ignoreForUiCamera([
      this.terrainGraphics,
      this.exitGraphics,
      this.webGraphics,
      this.trapGraphics,
      this.telegraphReticleGraphics,
      this.telegraphMarkerGraphics,
      this.playerSprite,
      this.facingMarker,
      this.minimapGraphics,
      ...this.enemySprites,
      ...this.groundItemTexts,
    ]);

    // ----- Phase 14.5: input-router-driven keyboard handling -----
    // Tracks physical key-held state manually only for 'f' (turn-only
    // modifier — not a real KeyboardEvent modifier flag like shift/ctrl,
    // which are read directly from the event) and for the currently-
    // dashing direction (Shift+direction), since both need to persist
    // across multiple frames/keydown events rather than being decided
    // once per keydown.
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      // Tab/legacy shortcuts are dropped from the documented control
      // scheme (spec 10.1's "Tabやpなどの画面別ショートカットはPhase
      // 14.5の正式操作から外す"), but Tab must still never move browser
      // focus off the canvas.
      if (event.key === 'Tab') {
        event.preventDefault();
        return;
      }
      if (isTurnOnlyModifierKey(event.key)) {
        this.fHeld = true;
        return;
      }
      if (event.repeat) return; // OS key-repeat is never used; only our own repeat timers are (spec 11.1).
      if (event.shiftKey && directionForKey(event.key) && this.state.phase === 'playing' && this.menuScreen === 'closed') {
        // Starting (or redirecting) a dash — handled directly here rather
        // than through routeKeyDown, since dash is a held/continuous
        // action driven by update()'s tickDash, not a single keydown
        // action. The initial step still comes from routeKeyDown's
        // ordinary move handling below.
        const dir = directionForKey(event.key);
        if (dir) this.dashDirection = dir;
      }
      this.handleRoutedKey(event.key, event.shiftKey, event.ctrlKey);
    });
    this.input.keyboard!.on('keyup', (event: KeyboardEvent) => {
      if (isTurnOnlyModifierKey(event.key)) {
        this.fHeld = false;
        return;
      }
      if (event.key === 'Shift') {
        this.dashDirection = null;
        this.dashRepeat = stopRepeat();
      }
      const dir = directionForKey(event.key);
      if (dir && this.moveRepeat.heldKey === dir) {
        this.moveRepeat = stopRepeat();
      }
      if ((event.key === ' ' || event.key.toLowerCase() === 'space' || event.key === '5') && this.waitRepeat.heldKey === 'wait') {
        this.waitRepeat = stopRepeat();
      }
    });

    this.refreshStaticView();
    this.snapActor(this.playerSprite, this.state.player);
    this.snapAllEnemies();
  }

  /**
   * Builds the provisional message-log panel docked to the bottom of the
   * screen: a simple translucent bar tall enough for MESSAGE_LOG_CAPACITY
   * lines, screen-fixed (unaffected by camera scroll). Deliberately no
   * scroll, expand button, icons, or color-coding per ui.requirements.
   */
  /**
   * HUD text for the current enchantment state (Phase 10.1 sol-only;
   * Phase 14.2 extends to all five elements; Phase 14.5 generalizes the
   * insufficient-SOL indicator from sol-only to whichever element is
   * selected, using ELEMENT_ENCHANTMENT_SOL_COST — turn.ts's single
   * source of truth for per-element SOL cost — so the check never
   * repeats or hardcodes a cost). Distinguishes "not yet unlocked" from
   * "unlocked but off" from "an element is active" from "selected but
   * SOL currently too low to activate" per ui.hud.required — the
   * selection itself is never hidden or reset just because SOL happens
   * to be insufficient. "not yet unlocked" checks every element (Phase
   * 14.2), not just solUnlocked, since flame/frost/cloud/earth can each
   * be unlocked (and selected) independently of sol.
   */
  private enchantHudLabel(): string {
    // Phase 23.1: the solar gun shows its own lens label instead of
    // melee's ENCHANT line — it always has an active element (never
    // "未取得"/"なし"/SOL不足, since its lens costs no extra SOL beyond
    // the weapon's own fixed solarCost) — fixed_spec's "近接武器装備時
    // の既存ENCHANT表示を壊さない" (the branch below is untouched for
    // every other weapon).
    if (this.state.equippedWeaponId === 'solar_gun') {
      const lens = getSolarGunEffectiveElement(this.state);
      return `LENS：${ELEMENT_DISPLAY_NAMES[lens]}`;
    }
    const anyUnlocked = Object.values(this.state.unlockedEnchantments).some((u) => u);
    if (!anyUnlocked) return 'ENCHANT：未取得';
    if (this.state.selectedEnchantment === 'none') return 'ENCHANT：なし';
    if (this.state.solarEnergy < ELEMENT_ENCHANTMENT_SOL_COST[this.state.selectedEnchantment]) {
      return `ENCHANT：${ELEMENT_DISPLAY_NAMES[this.state.selectedEnchantment]}（SOL不足）`;
    }
    return `ENCHANT：${ELEMENT_DISPLAY_NAMES[this.state.selectedEnchantment]}`;
  }

  /**
   * Compact list of which elements are currently unlocked (Phase 14.5:
   * ui.visible_information's "各属性の未解禁と解禁済みを判別できる" —
   * enchantHudLabel above only ever shows the one currently *selected*
   * element, so without this a player has no way to see which other
   * elements they've already unlocked and could switch to with 'F').
   * Deliberately minimal: a plain name list, no icons/highlighting,
   * matching the rest of the text HUD's style. Returns '未解禁' with
   * none listed rather than an empty string, so the HUD line never goes
   * silently blank.
   */
  private unlockedElementsHudLabel(): string {
    const unlocked = ALL_ELEMENT_IDS.filter((id) => this.state.unlockedEnchantments[id]);
    if (unlocked.length === 0) return '解禁：未解禁';
    return `解禁：${unlocked.map((id) => ELEMENT_DISPLAY_NAMES[id]).join('・')}`;
  }

  /**
   * HUD text for currently active temporary status effects (Phase 12.1
   * common status-effect foundation): '' when none are active (no segment
   * shown at all, per fixed_specification.hud.required's "有効時のみ状態
   * 効果表示を出す"), otherwise a leading-space-padded "効果: 攻撃↑ +5
   * (20)"-style segment for each active effect, joined together. Only
   * 'attack_up' exists this phase, so this only ever emits at most one
   * segment; the arrow glyph is a display-only shorthand distinct from
   * EFFECT_DEFINITIONS.displayName (never the internal id itself, per
   * "内部IDのattack_upをそのまま表示しない").
   */
  private effectsHudLabel(): string {
    const effects = getActiveEffects(this.state);
    if (effects.length === 0) return '';
    return effects
      .map((effect) => {
        const def = EFFECT_DEFINITIONS[effect.id];
        // Phase 12.2: movement_slow's strength (1) means "additional enemy
        // phases per successful move", not a displayable stat bonus like
        // attack_up's +5 — so its HUD segment omits the "+N" prefix
        // entirely (fixed_specification.hud's example "効果: 鈍足 (10)",
        // no plus sign), unlike attack_up's "+5 (20)".
        if (effect.id === 'movement_slow') {
          return `   効果: ${def.displayName} (${effect.remainingTurns})`;
        }
        // Phase 12.3: poison's strength (3) IS a displayable per-tick HP
        // loss, shown with a minus sign (fixed_specification.hud's
        // example "効果: 毒 -3 (10)") — distinct from attack_up's "+N"
        // gain notation, since poison is a drain rather than a bonus.
        if (effect.id === 'poison') {
          return `   効果: ${def.displayName} -${effect.strength} (${effect.remainingTurns})`;
        }
        const arrow = effect.id === 'attack_up' ? '攻撃↑' : def.displayName;
        return `   効果: ${arrow} +${effect.strength} (${effect.remainingTurns})`;
      })
      .join('');
  }

  private readonly LOG_PANEL_PADDING = 6;
  private readonly LOG_LINE_HEIGHT = 20;

  /**
   * Phase 14.5: the message window is now a fixed bottom strip
   * (LOGICAL_WIDTH x MESSAGE_HEIGHT, positioned right after the field)
   * rather than an overlay floating on top of the field itself (spec 5's
   * "HUDとメッセージウィンドウは、フィールドを覆わない独立領域とする").
   * Screen-fixed, UI-camera-only (see ignoreForWorldCamera in create()).
   */
  private createLogPanel(): void {
    const panelY = HUD_HEIGHT + FIELD_PIXEL_HEIGHT;

    this.logPanelBg = this.add.graphics().setScrollFactor(0);
    this.logPanelBg.fillStyle(COLORS.panelBg, COLORS.panelBgAlpha);
    this.logPanelBg.fillRect(0, panelY, LOGICAL_WIDTH, MESSAGE_HEIGHT);
    this.logPanelBg.lineStyle(2, COLORS.borderOuter, 1);
    this.logPanelBg.strokeRect(1, panelY + 1, LOGICAL_WIDTH - 2, MESSAGE_HEIGHT - 2);

    this.logPanelText = this.add
      .text(this.LOG_PANEL_PADDING, panelY + this.LOG_PANEL_PADDING, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#3b2a1a',
        lineSpacing: this.LOG_LINE_HEIGHT - 14,
        wordWrap: { width: LOGICAL_WIDTH - this.LOG_PANEL_PADDING * 2 },
      })
      .setScrollFactor(0);

    this.refreshLogPanel();
  }

  /** Redraws the log panel text from the current MessageLog contents. */
  private refreshLogPanel(): void {
    const lines = this.messageLog.visible;
    this.logPanelText.setText(lines.length > 0 ? lines.join('\n') : '');
  }

  /**
   * Derives a transparent, frame-sliced spritesheet texture named
   * `spriteKey` from the raw `${spriteKey}_raw` image at runtime: draws it
   * onto an offscreen canvas, zeroes the alpha of pixels matching the exact
   * chroma-key color (no thresholding, no other pixel changes), then
   * registers the canvas as a spritesheet texture. Runs once per Scene
   * lifetime per spriteKey (guarded by a texture-existence check so
   * restarts/floor changes never re-register it); the source PNG on disk is
   * never touched. Generalizes what was originally a spider-only method so
   * every non-natively-transparent species in the roster can share it.
   */
  private createChromaKeyTexture(spriteKey: string): void {
    if (this.textures.exists(spriteKey)) return;

    const rawKey = rawKeyFor(spriteKey);
    if (!this.textures.exists(rawKey)) {
      throw new Error(`Missing raw texture '${rawKey}'; cannot derive '${spriteKey}' spritesheet.`);
    }
    const rawImage = this.textures.get(rawKey).getSourceImage() as
      | HTMLImageElement
      | HTMLCanvasElement;
    const width = rawImage.width;
    const height = rawImage.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`Failed to acquire 2D context for '${spriteKey}' chroma-key texture generation.`);
    }

    ctx.drawImage(rawImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === CHROMA_KEY_R && data[i + 1] === CHROMA_KEY_G && data[i + 2] === CHROMA_KEY_B) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Registers the canvas directly as a new frame-sliced spritesheet
    // texture under `spriteKey`. (Passing the raw HTMLCanvasElement here,
    // not a pre-registered Phaser Texture, is required: Phaser's
    // addSpriteSheet ignores the `key` argument and reuses the source
    // texture's own key whenever `source` is already a Texture instance,
    // which would silently register this under a `_canvas`-suffixed key
    // instead of `spriteKey`.)
    const sheetTexture = this.textures.addSpriteSheet(spriteKey, canvas as unknown as HTMLImageElement, {
      frameWidth: SPRITE_FRAME_WIDTH,
      frameHeight: SPRITE_FRAME_HEIGHT,
    });
    if (!sheetTexture) {
      throw new Error(`Failed to register '${spriteKey}' chroma-key spritesheet texture.`);
    }
    // Preserve the game's pixel-art (nearest-neighbor) filtering, matching
    // textures loaded through the normal loader under pixelArt: true.
    this.textures.get(spriteKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  /**
   * Syncs `this.enemySprites` to the current roster by *resizing* the
   * existing sprite pool (re-texturing sprites that are kept, destroying
   * only the surplus, creating only the shortfall) instead of destroying
   * every sprite and creating a full fresh batch on every floor
   * transition. Bulk destroy-then-recreate of the whole roster in one
   * synchronous tick was the pattern present when floor transitions
   * started throwing an unexplained "Maximum call stack size exceeded"
   * from `this.add.sprite` (root cause not confirmed — this could not be
   * reproduced with a real browser in this environment — but the sheer
   * volume of GameObject churn per transition was the one clear
   * difference from the very first, successful call in create()).
   * Reducing that churn to just the per-floor enemy-count delta (Phase
   * 15.5's 6/7/8) removes most of the risk regardless of the exact
   * cause. Also still guarantees
   * `this.enemySprites.length === this.state.enemies.length` even if
   * sprite creation itself starts failing outright, so a later
   * `snapActor`/`animateMove` can never read `.setPosition` off
   * `undefined` again (see docs/history/fix-floor-transition-sprite-
   * crash.md).
   */
  private rebuildEnemySprites(): void {
    const enemies = this.state.enemies;

    while (this.enemySprites.length > enemies.length) {
      const sprite = this.enemySprites.pop()!;
      try {
        this.tweens.killTweensOf(sprite);
        sprite.destroy();
      } catch (error) {
        console.error('rebuildEnemySprites: failed to tear down a surplus enemy sprite', error);
      }
    }

    enemies.forEach((enemy, i) => {
      if (i >= this.enemySprites.length) return; // handled by the growth loop below
      try {
        this.tweens.killTweensOf(this.enemySprites[i]); // clear any in-flight move animation left over from the previous floor
        this.enemySprites[i].setTexture(spriteKeyForEnemy(enemy, this.state.stepsClairvoyanceActive), idleFrame('S'));
        this.enemySprites[i].setScale(SPRITE_SCALE_X, SPRITE_SCALE_Y);
        this.enemySprites[i].setVisible(true);
      } catch (error) {
        console.error(`rebuildEnemySprites: failed to retexture sprite ${i} for '${enemy.type}'`, error);
      }
    });

    while (this.enemySprites.length < enemies.length) {
      const enemy = enemies[this.enemySprites.length];
      try {
        const sprite = this.add.sprite(0, 0, spriteKeyForEnemy(enemy, this.state.stepsClairvoyanceActive), idleFrame('S'));
        sprite.setScale(SPRITE_SCALE_X, SPRITE_SCALE_Y);
        this.enemySprites.push(sprite);
      } catch (error) {
        console.error(`rebuildEnemySprites: failed to create a new sprite for '${enemy.type}' at index ${this.enemySprites.length}`, error);
        try {
          const placeholder = this.add.sprite(0, 0, '__DEFAULT');
          placeholder.setVisible(false);
          this.enemySprites.push(placeholder);
        } catch (fallbackError) {
          // Sprite creation itself is broken (not just this texture) —
          // further attempts in this loop will fail identically, so
          // stop instead of looping forever. Every index this leaves
          // unfilled is caught by the `!sprite` guards in
          // snapAllEnemies/applyTurnResult, which skip it instead of
          // crashing; enemySprites.length will stay short until the
          // next successful rebuild (next floor/restart).
          console.error('rebuildEnemySprites: even the placeholder sprite failed; giving up on filling the remaining roster this rebuild', fallbackError);
          break;
        }
      }
    }

    // uiCamera doesn't exist yet the very first time this runs (called
    // from create() before the camera split is set up); the initial
    // ignoreForUiCamera batch in create() covers that first roster
    // instead. Every later call (floor change/restart) re-applies it here
    // since sprites may be new GameObjects created by the growth loop
    // above (re-adding an already-ignored sprite is a harmless no-op).
    if (this.uiCamera) this.ignoreForUiCamera(this.enemySprites);
  }

  /**
   * Runs `snapActor` for every current enemy against its matching
   * sprite. Guards against `this.enemySprites` being shorter than
   * `this.state.enemies` (should not happen after the rebuildEnemySprites
   * fix above, but this keeps a mismatch from ever being a hard crash)
   * by skipping and logging rather than calling `.setPosition` on
   * `undefined`.
   */
  private snapAllEnemies(): void {
    this.state.enemies.forEach((enemy, i) => {
      const sprite = this.enemySprites[i];
      if (!sprite) {
        console.error(`snapAllEnemies: no sprite at index ${i} for ${this.state.enemies.length} enemies (enemySprites has ${this.enemySprites.length}); skipping instead of crashing`);
        return;
      }
      this.snapActor(sprite, enemy, spriteKeyForEnemy(enemy, this.state.stepsClairvoyanceActive), this.isCurrentlyVisible(enemy.pos), ghostDisplayAlpha(this.state.map, enemy));
    });
  }

  private createWalkAnimations(spriteKey: string): void {
    (['N', 'E', 'S', 'W'] as const).forEach((dir4) => {
      this.anims.create({
        key: walkAnimKey(spriteKey, dir4),
        frames: this.anims.generateFrameNumbers(spriteKey, { frames: walkFrames(dir4) }),
        frameRate: 4,
        repeat: -1,
      });
    });
  }

  /**
   * Warm, semi-transparent overlay color used to mark a sunlit floor tile
   * (Phase 09.3). Drawn only on top of floor tiles (never walls), after
   * the base floor fill, so it reads as a lighting difference rather than
   * a different tile type — never changes actor/item/exit rendering,
   * hit-testing, or coordinates.
   */
  private readonly SUNLIGHT_OVERLAY_COLOR = 0xffb454;
  private readonly SUNLIGHT_OVERLAY_ALPHA = 0.22;

  /**
   * Dark, memory-display fill for `explored_not_visible` terrain (Phase
   * 17.1 visual_design.policy: "単純な黒い半透明矩形の重ね掛けなど、既存
   * 描画方式への最小変更で実装する" — a flat, noticeably darker fill than
   * the current-visibility colors below, still distinct between floor and
   * wall so shape/layout stays legible from memory alone). No sunlight
   * overlay in this state — sunlight is a live lighting condition, not
   * part of what's remembered.
   */
  private readonly EXPLORED_DIM_WALL_COLOR = 0x161616;
  private readonly EXPLORED_DIM_FLOOR_COLOR = 0x0a0a0a;

  /**
   * Phase 17.1: terrain now has 3 states instead of always drawing every
   * tile — `unexplored` (nothing drawn at all), `explored_not_visible`
   * (dim memory colors, no sunlight), and `currently_visible` (the
   * original full-color rendering, sunlight overlay included). Reads
   * this.exploredTiles/this.currentVisible, both kept current by
   * updateVisibility() (always called earlier in the same
   * create()/resetSceneToCurrentState()/refreshStaticView() pass that
   * leads here).
   */
  /**
   * Phase 17.2 fix: dark-room `currently_visible` fill now uses a cool
   * blue-violet hue (src/game/dark-room-visuals.ts's DARK_ROOM_WALL_COLOR
   * / DARK_ROOM_FLOOR_COLOR, banded by distance) instead of a flat
   * darker-grey fill — the original grey-only version (0x262626/
   * 0x141414, kept only in this comment for history) tested as
   * indistinguishable from the game's already-black placeholder tiles
   * during the first playtest (see docs/history's "初回試遊" entry). The
   * actual band lookup happens per-tile below via darkRoomBand(), using
   * this.state.player.pos and each tile's own coordinates — never
   * precomputed or guessed independently of the existing darkRoomIndex/
   * isInRoomBounds membership check already used for `inDarkRoom`.
   */

  private drawTerrain(): void {
    const { map, sunlight, player } = this.state;
    const darkRoom = map.darkRoomIndex != null ? map.rooms[map.darkRoomIndex] : null;
    const playerInsideDarkRoom = darkRoom !== null && isInRoomBounds(darkRoom, player.pos);
    this.terrainGraphics.clear();
    for (let y = 0; y < map.height; y++) {
      const exploredRow = this.exploredTiles[y];
      for (let x = 0; x < map.width; x++) {
        if (!exploredRow?.[x]) continue; // unexplored: draw nothing
        const isWall = map.terrain[y][x] === 'wall';
        const visible = this.currentVisible.has(`${x},${y}`);

        if (visible) {
          const inDarkRoom = darkRoom !== null && isInRoomBounds(darkRoom, { x, y });
          let wallColor = 0x333333;
          let floorColor = 0x1c1c1c;
          if (inDarkRoom) {
            const band = darkRoomBand(playerInsideDarkRoom, player.pos, { x, y });
            wallColor = DARK_ROOM_WALL_COLOR[band];
            floorColor = DARK_ROOM_FLOOR_COLOR[band];
          }
          this.terrainGraphics.fillStyle(isWall ? wallColor : floorColor, 1);
          this.terrainGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          if (!isWall && sunlight[y]?.[x]) {
            this.terrainGraphics.fillStyle(this.SUNLIGHT_OVERLAY_COLOR, this.SUNLIGHT_OVERLAY_ALPHA);
            this.terrainGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        } else {
          this.terrainGraphics.fillStyle(isWall ? this.EXPLORED_DIM_WALL_COLOR : this.EXPLORED_DIM_FLOOR_COLOR, 1);
          this.terrainGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
        this.terrainGraphics.lineStyle(1, 0x000000, 0.4);
        this.terrainGraphics.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  /**
   * Shared color family for both the target reticle and the attacker
   * marker (telegraph_revision.attacker_marker: "標的アイコンと同系統の
   * 色と形状を使い、対応関係を示す"). The reticle is drawn larger/more
   * opaque than the marker so it stays the more prominent of the two
   * (telegraph_revision.attacker_marker: "標的マスの照準より目立たせない").
   */
  private readonly TELEGRAPH_COLOR = 0xffb020;
  private readonly RETICLE_RADIUS = TILE_SIZE * 0.26;
  private readonly RETICLE_TICK_LENGTH = TILE_SIZE * 0.1;
  private readonly RETICLE_DOT_RADIUS = TILE_SIZE * 0.035;
  private readonly MARKER_RADIUS = TILE_SIZE * 0.12;

  /**
   * Redraws both telegraph layers from the current state
   * (phase-07-1-ranged-attack-telegraph-reticle-only): a small reticle at
   * the fixed target tile for every currently-aiming cockatrice
   * (getCockatriceTelegraph) and currently-telegraphing kraken
   * (getKrakenTelegraph) — both null whenever that enemy isn't currently
   * telegraphing, so nothing is drawn for enemies merely in range or
   * acting normally — plus a small marker at the telegraphing enemy's own
   * position. Deliberately does not draw the ray/cross area itself (see
   * telegraph_revision.remove); the underlying range/hit-detection
   * functions in turn.ts are untouched and still compute the real attack
   * area for actual hit resolution. No animation: both layers are static
   * and only redrawn once per turn/reset (no update()-driven pulse),
   * matching target_reticle's "点滅、脈動、回転などのアニメーションは追
   * 加しない".
   */
  private drawTelegraphs(): void {
    this.telegraphReticleGraphics.clear();
    this.telegraphMarkerGraphics.clear();

    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;

      const cockatriceTelegraph = getCockatriceTelegraph(this.state.map, enemy);
      if (cockatriceTelegraph) {
        this.drawReticle(cockatriceTelegraph.targetTile);
        this.drawAttackerMarker(enemy.pos);
        continue;
      }

      const krakenTelegraph = getKrakenTelegraph(this.state.map, enemy);
      if (krakenTelegraph) {
        this.drawReticle(krakenTelegraph.center);
        this.drawAttackerMarker(enemy.pos);
        continue;
      }

      const golemChargeTelegraph = getGolemChargeTelegraph(this.state.map, enemy);
      if (golemChargeTelegraph) {
        this.drawReticle(golemChargeTelegraph.targetTile);
        this.drawAttackerMarker(enemy.pos);
        continue;
      }

      const stepsTelegraph = getStepsTelegraph(this.state.map, enemy);
      if (stepsTelegraph) {
        this.drawStepsSpikeWarning(stepsTelegraph.cells);
        this.drawAttackerMarker(enemy.pos);
      }
    }
  }

  /**
   * Phase 23.4: steps' 3x3 spike-attack warning — unlike drawReticle
   * (a single fixed point), this highlights every affected floor cell
   * (fixed_spec's "対象floorセルをすべて描く", since the player needs to
   * see the whole avoidable area, not just a center point). Wall cells
   * are never passed in here at all (getStepsSpikeCells already
   * excludes them), so nothing is ever drawn on a wall tile. Uses a
   * red-family color distinct from TELEGRAPH_COLOR's orange so the two
   * telegraph kinds stay visually distinguishable; a thin outline plus
   * a low-alpha fill keeps the floor pattern and any actor sprite on
   * the cell still readable underneath. No animation (matches every
   * other telegraph layer's "点滅、脈動、回転などのアニメーションは追
   * 加しない" — redrawn once per turn/reset only).
   */
  private readonly STEPS_WARNING_COLOR = 0xff4040;
  private readonly STEPS_WARNING_INSET = TILE_SIZE * 0.08;

  private drawStepsSpikeWarning(cells: Vec2[]): void {
    const g = this.telegraphReticleGraphics;
    const inset = this.STEPS_WARNING_INSET;
    const size = TILE_SIZE - inset * 2;
    for (const cell of cells) {
      const x = cell.x * TILE_SIZE + inset;
      const y = cell.y * TILE_SIZE + inset;
      g.lineStyle(2, this.STEPS_WARNING_COLOR, 0.85);
      g.strokeRect(x, y, size, size);
      g.fillStyle(this.STEPS_WARNING_COLOR, 0.18);
      g.fillRect(x, y, size, size);
    }
  }

  /**
   * Draws the target reticle at a single fixed tile: a thin ring, four
   * short corner ticks just outside it, and a small center dot — per
   * target_reticle's suggested "細い円、四隅の短線、中央の小点などによる
   * 簡素な形状". Small enough to leave the player/enemy sprite and floor
   * pattern readable even when it overlaps them.
   */
  private drawReticle(tile: { x: number; y: number }): void {
    const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
    const r = this.RETICLE_RADIUS;
    const tick = this.RETICLE_TICK_LENGTH;
    const g = this.telegraphReticleGraphics;

    g.lineStyle(2, this.TELEGRAPH_COLOR, 0.85);
    g.strokeCircle(cx, cy, r);
    g.lineBetween(cx, cy - r - tick, cx, cy - r);
    g.lineBetween(cx, cy + r, cx, cy + r + tick);
    g.lineBetween(cx - r - tick, cy, cx - r, cy);
    g.lineBetween(cx + r, cy, cx + r + tick, cy);

    g.fillStyle(this.TELEGRAPH_COLOR, 0.9);
    g.fillCircle(cx, cy, this.RETICLE_DOT_RADIUS);
  }

  /**
   * Draws the small attacker marker near a telegraphing enemy's own tile
   * (top-right of the sprite, per attacker_marker: "敵スプライトの頭上ま
   * たは右上へ置く"), using the same color family as the reticle but
   * smaller/lighter so it stays the less prominent of the two.
   */
  private drawAttackerMarker(pos: { x: number; y: number }): void {
    const cx = pos.x * TILE_SIZE + TILE_SIZE * 0.78;
    const cy = pos.y * TILE_SIZE + TILE_SIZE * 0.22;
    const g = this.telegraphMarkerGraphics;

    g.lineStyle(2, this.TELEGRAPH_COLOR, 0.75);
    g.strokeCircle(cx, cy, this.MARKER_RADIUS);
    g.fillStyle(this.TELEGRAPH_COLOR, 0.55);
    g.fillCircle(cx, cy, this.MARKER_RADIUS * 0.45);
  }

  /**
   * Phase 17.1 rendering_rules.entities.exit: normal color while
   * currently visible, a dimmer "remembered" alpha once explored but no
   * longer visible (a fixed landmark, unlike enemies/items — see the
   * rationale comment on rendering_rules), and not drawn at all while
   * still unexplored.
   */
  private readonly EXPLORED_EXIT_ALPHA = 0.35;

  private drawExit(): void {
    const { exit } = this.state;
    this.exitGraphics.clear();
    if (!this.exploredTiles[exit.y]?.[exit.x]) return;
    const alpha = this.isCurrentlyVisible(exit) ? 1 : this.EXPLORED_EXIT_ALPHA;
    this.exitGraphics.fillStyle(0xffd54a, alpha);
    this.exitGraphics.fillRect(
      exit.x * TILE_SIZE + TILE_SIZE * 0.15,
      exit.y * TILE_SIZE + TILE_SIZE * 0.15,
      TILE_SIZE * 0.7,
      TILE_SIZE * 0.7,
    );
  }

  /**
   * Draws each active spider web as a simple asset-free floor decoration:
   * a translucent diamond outline with a couple of cross-hatch lines,
   * suggesting a web without needing new art. Drawn on its own Graphics
   * layer created before any actor sprite, so actors always render on top
   * (never fully hidden). Redrawn every turn (webs can appear/expire) and
   * on scene reset. Deliberately shows no per-web remaining-turns number
   * (no persistent numeric HUD for this).
   */
  private drawWebs(): void {
    this.webGraphics.clear();
    for (const web of this.state.webs) {
      const cx = web.pos.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = web.pos.y * TILE_SIZE + TILE_SIZE / 2;
      const r = TILE_SIZE * 0.32;

      this.webGraphics.lineStyle(2, 0xcfd8ff, 0.75);
      // Diamond outline.
      this.webGraphics.beginPath();
      this.webGraphics.moveTo(cx, cy - r);
      this.webGraphics.lineTo(cx + r, cy);
      this.webGraphics.lineTo(cx, cy + r);
      this.webGraphics.lineTo(cx - r, cy);
      this.webGraphics.closePath();
      this.webGraphics.strokePath();
      // Cross-hatch.
      this.webGraphics.lineBetween(cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6);
      this.webGraphics.lineBetween(cx - r * 0.6, cy + r * 0.6, cx + r * 0.6, cy - r * 0.6);
    }
  }

  /**
   * Draws only revealed traps (Phase 18.1: `revealed=true`, either
   * `revealed_untriggered` or `triggered_inactive` — `revealed=false`
   * traps are skipped entirely and render identically to plain floor,
   * per fixed_specification.trap.rendering's original "未発動時は通常床
   * と完全に同じ表示にする", now keyed off `revealed` instead of
   * `triggered` since discovery and triggering are no longer the same
   * instant in principle, even though this phase's only discovery path
   * still sets both together).
   *
   * `triggered_inactive` keeps the exact pre-18.1 visuals unchanged
   * (fixed_specification.trap.rendering's "発動後は新規外部画像を使わず、
   * 既存描画方式に合う簡素な罠記号を表示する"): slow_trap's dull-orange
   * circle-with-X, poison_trap's purple diamond-with-dot.
   *
   * `revealed_untriggered` (Phase 18.1 new state) uses the same base
   * shape per trapType so its species stays identifiable, but in a
   * thinner, undecorated warning-yellow outline with no fill and no
   * X/center-dot — visually distinct at a glance from the inert
   * triggered mark so a player can tell "known, still live" apart from
   * "known, already spent" without reading trapType text.
   *
   * Redrawn every turn/reset like drawWebs.
   */
  private drawTraps(): void {
    this.trapGraphics.clear();
    for (const trap of this.state.traps ?? []) {
      if (!trap.revealed) continue;
      const cx = trap.pos.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = trap.pos.y * TILE_SIZE + TILE_SIZE / 2;
      const r = TILE_SIZE * 0.28;

      if (!trap.triggered) {
        // revealed_untriggered: thin warning-yellow outline only, no
        // fill/X/dot — deliberately less "finished" looking than the
        // triggered marks below.
        this.trapGraphics.lineStyle(1.5, 0xd4c93a, 0.85);
        if (trap.trapType === 'poison_trap') {
          this.trapGraphics.beginPath();
          this.trapGraphics.moveTo(cx, cy - r);
          this.trapGraphics.lineTo(cx + r, cy);
          this.trapGraphics.lineTo(cx, cy + r);
          this.trapGraphics.lineTo(cx - r, cy);
          this.trapGraphics.closePath();
          this.trapGraphics.strokePath();
        } else {
          this.trapGraphics.strokeCircle(cx, cy, r);
        }
        continue;
      }

      if (trap.trapType === 'poison_trap') {
        this.trapGraphics.lineStyle(2, 0x9b4dca, 0.85);
        // Diamond outline.
        this.trapGraphics.beginPath();
        this.trapGraphics.moveTo(cx, cy - r);
        this.trapGraphics.lineTo(cx + r, cy);
        this.trapGraphics.lineTo(cx, cy + r);
        this.trapGraphics.lineTo(cx - r, cy);
        this.trapGraphics.closePath();
        this.trapGraphics.strokePath();
        // Center dot.
        this.trapGraphics.fillStyle(0x9b4dca, 0.9);
        this.trapGraphics.fillCircle(cx, cy, r * 0.22);
        continue;
      }

      this.trapGraphics.lineStyle(2, 0xc97a3a, 0.85);
      this.trapGraphics.strokeCircle(cx, cy, r);
      this.trapGraphics.lineBetween(cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6);
      this.trapGraphics.lineBetween(cx - r * 0.6, cy + r * 0.6, cx + r * 0.6, cy - r * 0.6);
    }
  }

  /**
   * Draws each floor's ground item(s) as a plain emoji glyph (Phase 08.2
   * apple_placement/asset substitution: user-approved emoji in place of a
   * processed sprite asset), destroying and rebuilding the text objects
   * each call since ground items can appear/disappear (pickup) between
   * calls and there are always very few of them.
   *
   * Phase 17.1 rendering_rules.entities.floor_items: only drawn while
   * `currently_visible` — never a remembered/last-seen ghost, since an
   * item can be picked up by the time the player returns (rationale
   * comment on rendering_rules).
   */
  private drawGroundItems(): void {
    this.groundItemTexts.forEach((t) => t.destroy());
    this.groundItemTexts = this.state.groundItems
      .filter((item) => this.isCurrentlyVisible(item.pos))
      .map((item) => {
        const glyph = ITEM_DEFINITIONS[item.itemId].glyph;
        const cx = item.pos.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = item.pos.y * TILE_SIZE + TILE_SIZE / 2;
        return this.add
          .text(cx, cy, glyph, { fontSize: `${Math.round(TILE_SIZE * 0.6)}px` })
          .setOrigin(0.5);
      });
    if (this.uiCamera) this.ignoreForUiCamera(this.groundItemTexts);
  }

  /**
   * Phase 14.5 spec section 7: the always-on, semi-transparent explored
   * map. Drawn each refresh from this.exploredTiles (per-floor,
   * scene-local — see resetExploredTiles/markCameraWindowExplored) plus
   * whatever is *currently* inside the 9x7 camera window for
   * enemies/items/the exit, since there is no pre-existing memory rule
   * for those (spec 7.3's documented fallback: "既存ルールが未定義の場合、
   * 現在見えている対象だけを表示し、画面外へ移動した敵の現在位置を追跡
   * 表示しない"). Never reads or writes GameState — purely reads it.
   */
  /**
   * Phase 17.1: minimap terrain/exit still use this.exploredTiles (a
   * discovered tile stays on the minimap forever, matching
   * minimap.rules's "explored地形は表示する" / "出口は一度探索済みになれ
   * ば表示を維持する" — unchanged from the prior camera-window-explored
   * behavior). Enemies/items now gate on this.currentVisible (the real
   * FOV) instead of the old 9x7 camera-window rectangle, per
   * minimap.rules's "敵/床アイテムはcurrently_visibleの場合だけ表示する"
   * — the same visibility state the main field view uses, not a
   * separately reimplemented rule.
   */
  private drawMinimap(): void {
    const { map } = this.state;
    const tileW = FIELD_PIXEL_WIDTH / map.width;
    const tileH = FIELD_PIXEL_HEIGHT / map.height;
    this.minimapGraphics.clear();

    for (let y = 0; y < map.height; y++) {
      const exploredRow = this.exploredTiles[y];
      if (!exploredRow) continue;
      for (let x = 0; x < map.width; x++) {
        if (!exploredRow[x]) continue;
        if (map.terrain[y][x] === 'wall') continue;
        const inRoom = roomIndexContaining(map.rooms, { x, y }) !== -1;
        this.minimapGraphics.fillStyle(0xffffff, inRoom ? 0.22 : 0.13);
        this.minimapGraphics.fillRect(x * tileW, y * tileH, Math.ceil(tileW), Math.ceil(tileH));
      }
    }

    if (this.exploredTiles[this.state.exit.y]?.[this.state.exit.x]) {
      this.minimapGraphics.fillStyle(0xffe066, 0.9);
      this.minimapGraphics.fillRect(this.state.exit.x * tileW, this.state.exit.y * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }

    // Phase 18.2: revealed traps (both revealed_untriggered and
    // triggered_inactive — never hidden ones) always draw here,
    // independent of this.exploredTiles/isCurrentlyVisible — a
    // clairvoyance-revealed trap in never-explored territory must still
    // show its marker (minimap's "千里眼で発見した罠は、未探索領域にあっ
    // ても罠記号だけ表示する") without this loop ever touching
    // exploredTiles itself, so no surrounding floor/wall/room shape is
    // newly disclosed by drawing it (minimap's "罠記号の表示によって周囲
    // の床、壁、部屋形状を新たに描画しない"). Drawn before
    // enemies/items/player below so those more important symbols always
    // paint over a trap marker on the same tile, never the reverse
    // (minimap's "罠記号がプレイヤー、敵、出口などの重要記号を不当に隠さ
    // ない描画順にする"). slow_trap/poison_trap intentionally share one
    // shape here (minimap.rules doesn't require telling them apart) —
    // only the untriggered/triggered distinction gets its own color:
    // untriggered stays a bright warning color, triggered is deliberately
    // muted (lower alpha) to read as spent/inert at a glance.
    for (const marker of getMinimapTrapMarkers(this.state.traps)) {
      this.minimapGraphics.fillStyle(0xd4c93a, marker.alpha);
      this.minimapGraphics.fillRect(marker.pos.x * tileW, marker.pos.y * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }

    // Phase 23.4: clairvoyance-revealed steps location markers — drawn
    // before the ordinary currently-visible enemy loop below (same
    // ordering rationale as the trap markers above: enemy/item/player
    // symbols always paint over this), and completely independent of
    // exploredTiles/current visibility (getMinimapStepsMarkers reads
    // only positions, never terrain, so it cannot disclose surrounding
    // floor/wall/room shape).
    for (const pos of getMinimapStepsMarkers(this.state.enemies, this.state.stepsClairvoyanceActive ?? false)) {
      this.minimapGraphics.fillStyle(0xff4040, 0.85);
      this.minimapGraphics.fillRect(pos.x * tileW, pos.y * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }

    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      if (!this.isCurrentlyVisible(enemy.pos)) continue;
      this.minimapGraphics.fillStyle(0xe05050, 0.95);
      this.minimapGraphics.fillRect(enemy.pos.x * tileW, enemy.pos.y * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }
    for (const item of this.state.groundItems) {
      if (!this.isCurrentlyVisible(item.pos)) continue;
      this.minimapGraphics.fillStyle(0x66ccee, 0.95);
      this.minimapGraphics.fillRect(item.pos.x * tileW, item.pos.y * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }

    this.minimapGraphics.fillStyle(0xffffff, 1);
    this.minimapGraphics.fillRect(this.state.player.pos.x * tileW, this.state.player.pos.y * tileH, Math.ceil(tileW), Math.ceil(tileH));
  }

  /**
   * Redraws the 8-direction facing marker (Phase 08.6): a small dot offset
   * from the player's tile center toward player.facing, using the same
   * offset distance/size rule for all 8 directions. Necessary because the
   * player sprite/animation only distinguishes 4 facings (toDirection4
   * collapses NE/SE to E and NW/SW to W), so diagonal facings would
   * otherwise be indistinguishable from their nearest cardinal on screen.
   * Uses existing Graphics drawing only — no new image asset.
   */
  private updateFacingMarker(): void {
    const { player } = this.state;
    const vec = DIRECTION_VECTORS[player.facing];
    const cx = player.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = player.pos.y * TILE_SIZE + TILE_SIZE / 2;
    const offset = TILE_SIZE * 0.42;
    const mx = cx + vec.x * offset;
    const my = cy + vec.y * offset;

    this.facingMarker.clear();
    this.facingMarker.fillStyle(0xfff066, 1);
    this.facingMarker.fillCircle(mx, my, 3);
    this.facingMarker.lineStyle(1, 0x333300, 1);
    this.facingMarker.strokeCircle(mx, my, 3);
  }

  /**
   * Creates the Tab-toggled inventory overlay's graphics/text objects
   * (inventory_ui.display): a screen-fixed panel, hidden until opened. No
   * new persistent HUD — this stays invisible except while the overlay is
   * shown.
   */
  // ----- Phase 14.5 SFC-style small-window menu (replaces the old
  // Tab-toggled full-width inventory overlay and P-toggled ability
  // overlay with a shared small-window system per spec section 9). The
  // underlying GameState-backed selection/action functions
  // (moveInventorySelection, selectedInventoryAction,
  // useSelectedInventoryItem, moveAbilitySelection,
  // openAbilityConfirm/resolveAbilityConfirm/etc.) are reused completely
  // unchanged — only which physical keys reach them, and how the result
  // is drawn, are new.

  private readonly MENU_LIST_WIDTH = 190;
  private readonly MENU_DETAIL_WIDTH = FIELD_PIXEL_WIDTH - 190 - 24;
  private readonly MENU_PADDING = 10;
  private readonly MENU_LINE_HEIGHT = 20;

  private createMenuOverlay(): void {
    this.menuOverlayBg = this.add.graphics().setScrollFactor(0).setDepth(220).setVisible(false);
    this.menuOverlayText = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '14px', color: '#3b2a1a', lineSpacing: this.MENU_LINE_HEIGHT - 14 })
      .setScrollFactor(0)
      .setDepth(221)
      .setVisible(false);
    this.menuDetailBg = this.add.graphics().setScrollFactor(0).setDepth(220).setVisible(false);
    this.menuDetailText = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#3b2a1a',
        lineSpacing: 5,
        wordWrap: { width: this.MENU_DETAIL_WIDTH - this.MENU_PADDING * 2 },
      })
      .setScrollFactor(0)
      .setDepth(221)
      .setVisible(false);
  }

  private createEndScreenOverlay(): void {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.88)';
    overlay.style.color = '#ffffff';
    overlay.style.fontFamily = 'monospace';
    overlay.style.fontSize = '14px';
    overlay.style.display = 'none';
    overlay.style.zIndex = '1000';
    overlay.style.overflowY = 'auto';
    overlay.style.padding = '24px';
    overlay.style.boxSizing = 'border-box';
    document.body.appendChild(overlay);
    this.endScreenOverlay = overlay;
  }

  private hideEndScreen(): void {
    if (this.endScreenOverlay) this.endScreenOverlay.style.display = 'none';
  }

  /**
   * Renders and shows the end-screen report (end_screen) exactly once
   * per finalized run — guarded by endScreenShownForTelemetry so
   * repeated refreshStaticView calls while the phase stays
   * gameover/victory (e.g. from further harmless key input) don't
   * rebuild the DOM or reset scroll position every time. Reads only
   * `this.telemetry` (already finalized by finalizeRun before this is
   * ever reached) and `this.state` (for finalState) — never mutates
   * either.
   */
  private showEndScreen(): void {
    if (this.endScreenShownForTelemetry === this.telemetry) return;
    this.endScreenShownForTelemetry = this.telemetry;

    const summary = computeRunSummary(this.telemetry, this.state);
    const isClear = this.telemetry.result === 'clear';
    const pct = (n: number | null): string => (n === null ? '—' : `${Math.round(n * 100)}%`);
    const num = (n: number | null): string => (n === null ? '—' : String(Math.round(n * 10) / 10));

    const weaponRows = Object.entries(summary.combatByWeapon)
      .map(([weapon, s]) => {
        const attacks = s.hits + s.misses;
        return `<tr><td>${weapon}</td><td>${attacks}</td><td>${s.hits}</td><td>${s.misses}</td><td>${pct(s.hitRate)}</td><td>${s.damageDealt}</td><td>${num(s.averageDamagePerHit)}</td><td>${s.kills}</td></tr>`;
      })
      .join('');

    const enemyRows = Object.entries(summary.damageTakenByEnemy)
      .map(([enemyType, s]) => `<tr><td>${enemyType}</td><td>${s.attackAttempts}</td><td>${s.hits}</td><td>${s.damage}</td></tr>`)
      .join('');

    const floorRows = summary.perFloor
      .map((f) => `<tr><td>${f.floor}</td><td>${f.turns}</td><td>${f.damageDealt}</td><td>${f.damageTaken}</td></tr>`)
      .join('');

    const inventoryText =
      Object.entries(summary.finalState.inventory)
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => `${itemId}×${count}`)
        .join(', ') || 'なし';

    this.endScreenOverlay.innerHTML = `
      <div style="max-width: 720px; margin: 0 auto;">
        <h1 style="border: 2px solid #fff; display:inline-block; padding: 4px 16px;">${isClear ? 'CLEAR' : 'GAME OVER'}</h1>
        <p>Seed: ${this.telemetry.seed} ／ 到達フロア: ${summary.finalState.floor} ／ 総ターン: ${this.telemetry.events.reduce((m, e) => Math.max(m, e.turn), 0)}</p>
        <h2>概要</h2>
        <p>
          敵撃破数: ${summary.progression.enemiesDefeated} ／
          与ダメージ合計: ${summary.combatOverall.damageDealt} ／
          被ダメージ合計: ${Object.values(summary.damageTakenByEnemy).reduce((s, e) => s + e.damage, 0)} ／
          SOL獲得: ${summary.resources.solGained} ／
          SOL消費: ${summary.resources.solConsumed} ／
          回復量: ${Object.values(summary.resources.healingBySource).reduce((s, v) => s + v, 0)}
        </p>
        <h2>武器別</h2>
        <table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;">
          <thead><tr><th>武器</th><th>攻撃</th><th>命中</th><th>ミス</th><th>命中率</th><th>与ダメージ</th><th>平均命中ダメージ</th><th>撃破</th></tr></thead>
          <tbody>${weaponRows || '<tr><td colspan="8">記録なし</td></tr>'}</tbody>
        </table>
        <h2>被害元別</h2>
        <table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;">
          <thead><tr><th>敵種</th><th>攻撃</th><th>命中</th><th>被ダメージ</th></tr></thead>
          <tbody>${enemyRows || '<tr><td colspan="4">記録なし</td></tr>'}</tbody>
        </table>
        <h2>フロア別</h2>
        <table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;">
          <thead><tr><th>フロア</th><th>ターン数</th><th>与ダメージ</th><th>被ダメージ</th></tr></thead>
          <tbody>${floorRows || '<tr><td colspan="4">記録なし</td></tr>'}</tbody>
        </table>
        <h2>終了時</h2>
        <p>
          終了原因: ${this.telemetry.endCause ?? '—'} ／
          LIFE: ${summary.finalState.life}/${summary.finalState.maxLife} ／
          SOL: ${summary.finalState.sol} ／
          装備: ${summary.finalState.equipment.weapon ?? '素手'} / ${summary.finalState.equipment.armor ?? 'なし'} ／
          所持品: ${inventoryText}
        </p>
        <p id="end-screen-export-status" style="min-height: 1.4em; color: #ff8080;"></p>
        <button id="end-screen-export-button" style="font-family: monospace; font-size: 16px; padding: 8px 16px; cursor: pointer;">JSONを保存</button>
        <p>Enter: 同じシードで再開　N: 新しいシードで開始</p>
      </div>
    `;
    this.endScreenOverlay.style.display = 'block';

    const button = this.endScreenOverlay.querySelector<HTMLButtonElement>('#end-screen-export-button')!;
    button.addEventListener('click', () => this.exportTelemetryJson());
  }

  /**
   * JSON export (json_export): builds the document, serializes it, and
   * triggers a download via a Blob + temporary object URL, revoked
   * immediately after the click. Never touches `this.state` or
   * `this.telemetry` beyond reading them — calling this any number of
   * times produces byte-identical output (json_export's "同じ結果を複数
   * 回保存しても内容を変えない"). Any failure is caught and shown as a
   * short message in the overlay instead of throwing, per
   * failure_handling.
   */
  private exportTelemetryJson(): void {
    const statusEl = this.endScreenOverlay.querySelector<HTMLParagraphElement>('#end-screen-export-status');
    try {
      const doc = buildTelemetryDocument(this.telemetry, this.state);
      const json = JSON.stringify(doc, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildExportFilename(this.telemetry);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (statusEl) statusEl.textContent = '';
    } catch (err) {
      if (statusEl) statusEl.textContent = 'JSONの保存に失敗しました。';
      // Deliberately not re-thrown/logged as an uncaught exception —
      // failure_handling's "コンソールへ未捕捉例外を出さない" — but a
      // console.warn (not an error/throw) is fine for local debugging.
      console.warn('Telemetry export failed:', err);
    }
  }


  private readonly SLOWED_TINT = 0x6ec6ff;

  private updatePlayerSlowedTint(): void {
    if (this.state.player.slowed) {
      this.playerSprite.setTint(this.SLOWED_TINT);
    } else {
      this.playerSprite.clearTint();
    }
  }

  private readonly MOVE_DURATION = 220;
  private activeAnimations = 0;

  /**
   * The name to show for `itemId` in the Inventory overlay (Phase 20.0b):
   * a not-yet-identified card's placeholder name
   * (CARD_DEFINITIONS[itemId].unidentifiedDisplayName) instead of its real
   * displayName, so the true species never leaks through the list or
   * detail view before identification. Every non-card item is unaffected
   * (falls straight through to ITEM_DEFINITIONS[itemId].displayName, same
   * as before this phase).
   */
  private displayedItemName(itemId: import('./game/types').ItemId): string {
    if ((CARD_IDS_IN_ORDER as readonly string[]).includes(itemId)) {
      const cardId = itemId as import('./game/types').CardId;
      if (!isCardIdentified(this.state, cardId)) {
        return CARD_DEFINITIONS[cardId].unidentifiedDisplayName;
      }
    }
    return ITEM_DEFINITIONS[itemId].displayName;
  }

  private rootMenuItems(): string[] {
    // spec 9.2: 装備/能力 are conditional on an independent feature
    // existing — this game has no independent equip screen (equip
    // happens from 道具), so 装備 is correctly omitted; 能力 exists
    // (Phase 13.2), so it is included.
    return ['道具', '能力', '状態', '記録', 'その他'];
  }

  private otherMenuItems(): string[] {
    // 設定 omitted entirely (spec 9.2: only include it "Phase 14.5で実際
    // に変更可能な設定がある場合" — none exist).
    return ['操作説明', '冒険を終了'];
  }

  /** Available actions for the currently-selected item in the 道具 list (spec 9.3). */
  private currentItemActions(): string[] {
    const entry = selectedInventoryEntry(this.state);
    if (!entry) return [];
    const def = ITEM_DEFINITIONS[entry.itemId];
    const actions: string[] = [];
    if (def.category === 'weapon' || def.category === 'armor') {
      // Phase 24.1: the label reflects this specific entry's equipped
      // state (never the species'), so two held individuals of the same
      // species can show different labels ('装備する' for one, '外す' for
      // the other) — see selectedInventoryAction's identical per-entry
      // routing in inventory.ts.
      const equipped = entry.kind === 'equipment_instance' && entry.equipped;
      actions.push(equipped ? '外す' : '装備する');
    } else if (def.consumable) {
      actions.push('食べる／使う');
    }
    actions.push('置く');
    actions.push('捨てる');
    return actions;
  }

  private wrapIndex(index: number, length: number): number {
    if (length <= 0) return 0;
    return ((index % length) + length) % length;
  }

  // ----- context / dispatch -----

  private determineContext(): InputContext {
    if (this.state.phase !== 'playing') return 'gameover';
    if (this.state.discardConfirmItemId) return 'dialog';
    // abilityConfirmPending only ever becomes true while menuScreen is
    // already 'ability' (see handleMenuConfirm's 'ability' case), so it
    // needs no separate context of its own — 'menu' context already
    // routes every cardinal direction (including E/W, needed for the
    // yes/no toggle below), unlike 'dialog' context which only ever
    // handles confirm/cancel.
    if (this.menuScreen !== 'closed') return 'menu';
    return 'field';
  }

  /** Runs the full existing turn pipeline for one PlayerAction (unchanged from the pre-14.5 handleKey body). */
  private dispatchGameAction(action: import('./game/types').PlayerAction): void {
    const playerBefore = { ...this.state.player.pos };
    const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
    const turnSnapshot = snapshotForTurn(this.state);
    const result = processTurn(this.state, action);
    recordTurn(this.telemetry, action, result, turnSnapshot, this.state);
    finalizeRun(this.telemetry, this.state);
    this.applyTurnResult(result, playerBefore, enemiesBefore);
  }

  /**
   * Single entry point for every keydown once modifier/repeat bookkeeping
   * is done (spec 11.1's "入力を単一ルーターへ集約する"). While a move/
   * attack tween is in flight, all input is ignored (existing
   * activeAnimations guard, unchanged) so overlapping tweens can't make a
   * sprite skip through tiles/walls.
   */
  private handleRoutedKey(key: string, shiftKey: boolean, ctrlKey: boolean): void {
    if (this.activeAnimations > 0) return;
    const context = this.determineContext();
    const routed = routeKeyDown(context, key, { shiftKey, ctrlKey, fHeld: this.fHeld });
    if (!routed) return;

    switch (routed.kind) {
      case 'game':
        this.dashRepeat = stopRepeat(); // any other action (attack/wait/turn-only) interrupts an in-progress dash
        this.dashDirection = null;
        this.dispatchGameAction(routed.action);
        if (routed.action.type === 'move') this.startMoveRepeat(routed.action.direction);
        if (routed.action.type === 'wait') this.startWaitRepeat();
        return;
      case 'menu_open':
        this.menuScreen = 'root';
        this.menuRootIndex = 0;
        this.refreshMenuOverlay();
        return;
      case 'menu_close':
        this.closeMenu();
        return;
      case 'menu_cursor':
        this.handleMenuCursor(routed.direction);
        return;
      case 'menu_confirm':
        this.handleMenuConfirm();
        return;
      case 'menu_back':
        this.handleMenuBack();
        return;
      case 'enchant_switch':
        this.dispatchGameAction({ type: 'toggle_enchantment' });
        return;
      case 'gameover_restart_same':
        this.restart(this.state.runSeed);
        return;
      case 'gameover_restart_new':
        this.restart(randomSeed());
        return;
      case 'gameover_dismiss_overlay':
        this.hideEndScreen();
        return;
    }
  }

  private startMoveRepeat(direction: import('./game/types').Direction8): void {
    this.moveRepeat = startRepeat(direction, this.time.now);
  }
  private startWaitRepeat(): void {
    this.waitRepeat = startRepeat('wait', this.time.now);
  }

  private closeMenu(): void {
    if (this.state.inventoryOpen) closeInventory(this.state);
    if (this.state.abilityOverlayOpen) closeAbilityOverlay(this.state);
    this.menuScreen = 'closed';
    this.refreshMenuOverlay();
  }

  private handleMenuCursor(direction: import('./game/types').Direction8): void {
    if (this.menuScreen === 'ability' && this.state.abilityConfirmPending) {
      if (direction === 'E' || direction === 'W') {
        toggleAbilityConfirmChoice(this.state);
        this.refreshMenuOverlay();
      }
      return;
    }
    if (direction !== 'N' && direction !== 'S') return;
    const delta = direction === 'N' ? -1 : 1;
    switch (this.menuScreen) {
      case 'root':
        this.menuRootIndex = this.wrapIndex(this.menuRootIndex + delta, this.rootMenuItems().length);
        break;
      case 'items':
        moveInventorySelection(this.state, delta);
        break;
      case 'item_actions':
        this.itemActionIndex = this.wrapIndex(this.itemActionIndex + delta, this.currentItemActions().length);
        break;
      case 'card_target_selection':
        if (this.cardTargetSelection) {
          this.cardTargetSelection = moveCardTargetCursor(this.cardTargetSelection, delta);
        }
        break;
      case 'ability':
        moveAbilitySelection(this.state, delta);
        break;
      case 'other':
        this.otherIndex = this.wrapIndex(this.otherIndex + delta, this.otherMenuItems().length);
        break;
      case 'confirm_quit':
        this.confirmQuitIndex = this.confirmQuitIndex === 0 ? 1 : 0;
        break;
      default:
        break; // status/records/help have no selectable list
    }
    this.refreshMenuOverlay();
  }

  private handleMenuConfirm(): void {
    if (this.state.discardConfirmItemId) {
      const itemId = this.state.discardConfirmItemId;
      const equipmentInstanceId = this.state.discardConfirmEquipmentInstanceId ?? undefined;
      this.state.discardConfirmItemId = null;
      this.state.discardConfirmEquipmentInstanceId = null;
      this.dispatchGameAction({ type: 'discard_item', itemId, ...(equipmentInstanceId ? { equipmentInstanceId } : {}) });
      this.state.inventoryOpen = true;
      this.menuScreen = 'items';
      this.refreshMenuOverlay();
      return;
    }
    if (this.state.abilityConfirmPending) {
      const resolution = resolveAbilityConfirm(this.state);
      if (resolution.attempted && resolution.allocation && resolution.allocation.success) {
        const allocation = resolution.allocation;
        this.pushMessages(formatEvents(allocation.events));
        recordAbilityAllocation(
          this.telemetry,
          this.state,
          allocation.ability!,
          allocation.previousValue,
          allocation.newValue,
          allocation.remainingAbilityPoints,
        );
        this.refreshStaticView();
      }
      this.refreshMenuOverlay();
      return;
    }

    switch (this.menuScreen) {
      case 'root': {
        const item = this.rootMenuItems()[this.menuRootIndex];
        if (item === '道具') {
          if (!this.state.inventoryOpen) toggleInventory(this.state);
          this.menuScreen = 'items';
        } else if (item === '能力') {
          if (!this.state.abilityOverlayOpen) toggleAbilityOverlay(this.state);
          this.menuScreen = 'ability';
        } else if (item === '状態') {
          this.menuScreen = 'status';
        } else if (item === '記録') {
          this.menuScreen = 'records';
        } else if (item === 'その他') {
          this.otherIndex = 0;
          this.menuScreen = 'other';
        }
        break;
      }
      case 'items': {
        const itemId = selectedItemId(this.state);
        if (!itemId) break;
        this.itemActionIndex = 0;
        this.menuScreen = 'item_actions';
        break;
      }
      case 'item_actions': {
        const actions = this.currentItemActions();
        const action = actions[this.itemActionIndex];
        if (action === '捨てる') {
          const itemId = selectedItemId(this.state);
          const equipmentInstanceId = selectedEquipmentInstanceId(this.state);
          if (itemId) {
            this.state.discardConfirmItemId = itemId;
            this.state.discardConfirmEquipmentInstanceId = equipmentInstanceId;
          }
          break;
        }
        if (action === '置く') {
          const itemId = selectedItemId(this.state);
          const equipmentInstanceId = selectedEquipmentInstanceId(this.state);
          if (itemId) {
            this.dispatchGameAction({ type: 'place_item', itemId, ...(equipmentInstanceId ? { equipmentInstanceId } : {}) });
          }
          this.state.inventoryOpen = true;
          this.menuScreen = 'items';
          break;
        }
        // Phase 20.0d: temperance/star route into the target-selection
        // screen instead of an immediate use — neither card has an
        // effect resolver yet (Phase 20.5a), so this phase only opens
        // selection; confirm/cancel from that screen never consumes the
        // card, identifies it, or advances the turn (see
        // card-target-selection.ts's module doc comment).
        if (action === '食べる／使う') {
          const itemId = selectedItemId(this.state);
          if (itemId && isTargetSelectableItemId(itemId)) {
            const selection = beginCardTargetSelection(this.state, itemId);
            if (selection) {
              this.cardTargetSelection = selection;
              // Phase 20.0d: never carry a stale pending effect from an
              // earlier (possibly different-card) selection into a new one.
              this.pendingCardTargetEffect.clear();
              this.menuScreen = 'card_target_selection';
            }
            // No eligible candidates: falls through to the ordinary
            // use-item failure path below (e.g. temperance with no
            // discovered-cursed equipment, star with no valid target),
            // which already produces the correct "使用不成立" event/log
            // line via applyCardUse's existing not_implemented rejection
            // — no separate message is invented here.
            break;
          }
        }
        // 食べる／使う, 装備する, 外す all route through the same
        // selectedInventoryAction-derived action as the old Enter key.
        const playerBefore = { ...this.state.player.pos };
        const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
        const gameAction = selectedInventoryAction(this.state);
        const turnSnapshot = snapshotForTurn(this.state);
        const result = useSelectedInventoryItem(this.state);
        if (gameAction) {
          recordTurn(this.telemetry, gameAction, result, turnSnapshot, this.state);
          finalizeRun(this.telemetry, this.state);
        }
        this.applyTurnResult(result, playerBefore, enemiesBefore);
        this.state.inventoryOpen = true;
        this.menuScreen = 'items';
        break;
      }
      case 'card_target_selection': {
        // Phase 20.5a: confirm re-validates the cursored target against
        // live GameState, then dispatches the SAME 'use_targeted_card'
        // PlayerAction any other production caller would (never a
        // UI-only shortcut) — turn.ts's applyTargetedCardUse
        // re-validates the target *again* itself before applying
        // anything, commits the effect, consumes the card, identifies
        // it, and advances the turn, exactly like every other
        // successful card use. This is the actual production connection
        // point for temperance/star (CARD_TARGET_EFFECT_RESOLVERS is no
        // longer empty as of Phase 20.5a).
        //
        // - Stale target (no longer in the current candidate set —
        //   e.g. discarded or its curse state changed since selection
        //   began): re-generate the candidate list. If candidates
        //   remain, selection continues with the cursor clamped into
        //   the refreshed range. If none remain, exit to item_actions.
        if (this.cardTargetSelection) {
          const target = confirmCardTargetSelection(this.state, this.cardTargetSelection);
          if (target) {
            const cardId = this.cardTargetSelection.cardId;
            const playerBefore = { ...this.state.player.pos };
            const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
            const turnSnapshot = snapshotForTurn(this.state);
            const gameAction: import('./game/types').PlayerAction = { type: 'use_targeted_card', cardId, target };
            const result = processTurn(this.state, gameAction);
            recordTurn(this.telemetry, gameAction, result, turnSnapshot, this.state);
            finalizeRun(this.telemetry, this.state);
            this.applyTurnResult(result, playerBefore, enemiesBefore);
            this.pendingCardTargetEffect.clear();
            this.cardTargetSelection = null;
            this.state.inventoryOpen = true;
            this.menuScreen = 'items';
          } else {
            this.pendingCardTargetEffect.clear();
            const refreshed = refreshCardTargetSelection(this.state, this.cardTargetSelection);
            if (refreshed) {
              this.cardTargetSelection = refreshed;
              // Stay on card_target_selection with the refreshed candidate set.
            } else {
              this.cardTargetSelection = null;
              this.menuScreen = 'item_actions';
            }
          }
        } else {
          this.pendingCardTargetEffect.clear();
          this.menuScreen = 'item_actions';
        }
        break;
      }
      case 'ability': {
        openAbilityConfirm(this.state);
        break;
      }
      case 'other': {
        const item = this.otherMenuItems()[this.otherIndex];
        if (item === '操作説明') {
          this.menuScreen = 'help';
        } else if (item === '冒険を終了') {
          this.confirmQuitIndex = 0; // default selection is Cancel (spec 9.8)
          this.menuScreen = 'confirm_quit';
        }
        break;
      }
      case 'confirm_quit': {
        if (this.confirmQuitIndex === 1) {
          this.closeMenu();
          this.restart(randomSeed());
          return;
        }
        this.menuScreen = 'other';
        break;
      }
      default:
        break; // status/records/help: confirm does nothing
    }
    this.refreshMenuOverlay();
  }

  private handleMenuBack(): void {
    if (this.state.discardConfirmItemId) {
      this.state.discardConfirmItemId = null;
      this.state.discardConfirmEquipmentInstanceId = null;
      this.refreshMenuOverlay();
      return;
    }
    if (this.state.abilityConfirmPending) {
      cancelAbilityConfirm(this.state);
      this.refreshMenuOverlay();
      return;
    }
    switch (this.menuScreen) {
      case 'items':
        if (this.state.inventoryOpen) closeInventory(this.state);
        this.menuScreen = 'root';
        break;
      case 'ability':
        if (this.state.abilityOverlayOpen) closeAbilityOverlay(this.state);
        this.menuScreen = 'root';
        break;
      case 'status':
      case 'records':
        this.menuScreen = 'root';
        break;
      case 'item_actions':
        this.menuScreen = 'items';
        break;
      case 'card_target_selection':
        // Phase 20.0d: cancel discards the selection snapshot and any
        // pending effect only — never touches inventory/equipment/turn/
        // identification (see card-target-selection.ts's module doc
        // comment).
        this.cardTargetSelection = null;
        this.pendingCardTargetEffect.clear();
        this.menuScreen = 'item_actions';
        break;
      case 'other':
        this.menuScreen = 'root';
        break;
      case 'help':
        this.menuScreen = 'other';
        break;
      case 'confirm_quit':
        this.menuScreen = 'other';
        break;
      case 'root':
        this.closeMenu();
        return;
      default:
        break;
    }
    this.refreshMenuOverlay();
  }

  // ----- rendering -----

  /**
   * Redraws whichever menu screen is currently active (or hides the menu
   * entirely when closed) — the single place that turns this.menuScreen
   * plus the relevant GameState fields into the small command window +
   * list window + detail window layout (spec 9.1: "最初の小型コマンド窓
   * を左上へ置く。選択に応じて、一覧窓または行動窓を隣へ追加する。下部の
   * 横長窓は、通常状態または選択項目の説明へ使う。"). Left column = list
   * (command root, item list, item actions, ability list, other list,
   * confirm-quit choice); right column = detail/description; status and
   * records use the list column alone as a plain info block, since they
   * have no selectable list (spec 9.6/9.7).
   */
  private refreshMenuOverlay(): void {
    const open = this.menuScreen !== 'closed';
    this.menuOverlayBg.setVisible(open);
    this.menuOverlayText.setVisible(open);
    this.menuDetailBg.setVisible(open);
    this.menuDetailText.setVisible(open);
    if (!open) return;

    const listLines: string[] = [];
    let detailLines: string[] = [];

    switch (this.menuScreen) {
      case 'root': {
        listLines.push('コマンド', '');
        this.rootMenuItems().forEach((item, i) => {
          listLines.push(`${i === this.menuRootIndex ? '> ' : '  '}${item}`);
        });
        detailLines = ['J/Enter：決定　K/Esc：閉じる'];
        break;
      }
      case 'items': {
        const entries = inventoryEntries(this.state);
        const current = totalInventoryCount(this.state);
        listLines.push('道具', `${current} / ${INVENTORY_CAPACITY}`, '');
        if (entries.length === 0) {
          listLines.push('なし');
        } else {
          entries.forEach((entry, i) => {
            const def = ITEM_DEFINITIONS[entry.itemId];
            const marker = i === this.state.selectedItemIndex ? '> ' : '  ';
            const displayName = this.displayedItemName(entry.itemId);
            if (entry.kind === 'equipment_instance') {
              // Phase 24.1: per-individual display — equipped marker,
              // rank, +refineLevel, and a discovered-cursed marker are
              // all per-entry now (never per-species), so two held
              // individuals of the same species can show different
              // details on the same screen (inventory_entry_design's
              // display rules in docs/history/phase-24-1-equipment-
              // instance-actions.md). An undiscovered curse is never
              // shown or hinted at here.
              const equipMark = entry.equipped ? 'E ' : '  ';
              const refineSuffix = entry.refineLevel > 0 ? `+${entry.refineLevel}` : '';
              const curseMark = entry.curseRevealed ? '（呪）' : '';
              listLines.push(`${marker}${equipMark}${def.glyph}${displayName}${refineSuffix} [${entry.rank}]${curseMark}`);
            } else {
              const equipMark = '  ';
              const count = def.category === 'consumable' ? `x${entry.count}` : '';
              listLines.push(`${marker}${equipMark}${def.glyph}${displayName} ${count}`);
            }
          });
        }
        const selectedEntry = selectedInventoryEntry(this.state);
        const selected = selectedItemId(this.state);
        if (selected && selectedEntry) {
          const def = ITEM_DEFINITIONS[selected];
          detailLines.push(this.displayedItemName(selected));
          if (def.category === 'weapon') {
            const w = WEAPON_DEFINITIONS[selected as 'sword' | 'spear' | 'hammer'];
            detailLines.push(`攻撃${w.attackPower}・射程${w.reach}`);
            detailLines.push(
              selectedEntry.kind === 'equipment_instance' && selectedEntry.equipped ? '装備中' : '未装備',
            );
          } else if (def.category === 'armor') {
            const a = ARMOR_DEFINITIONS[selected as 'armor'];
            detailLines.push(`防御${a.armorValue}`);
            detailLines.push(
              selectedEntry.kind === 'equipment_instance' && selectedEntry.equipped ? '装備中' : '未装備',
            );
          }
          detailLines.push('', 'J/Enter：行動を選ぶ　K/Esc：戻る');
        } else {
          detailLines.push('K/Esc：戻る');
        }
        break;
      }
      case 'item_actions': {
        const selected = selectedItemId(this.state);
        listLines.push(selected ? this.displayedItemName(selected) : '行動', '');
        this.currentItemActions().forEach((action, i) => {
          listLines.push(`${i === this.itemActionIndex ? '> ' : '  '}${action}`);
        });
        detailLines = ['J/Enter：決定　K/Esc：戻る'];
        break;
      }
      case 'card_target_selection': {
        const selection = this.cardTargetSelection;
        listLines.push('対象を選ぶ', '');
        if (selection) {
          selection.candidates.forEach((ref, i) => {
            const info = describeCardTargetCandidate(this.state, selection.cardId, ref);
            const marker = i === selection.cursor ? '> ' : '  ';
            const equipMark = info.equipped ? 'E ' : '  ';
            const refine = info.refineLevel ? ` +${info.refineLevel}` : '';
            const note = info.note ? `（${info.note}）` : '';
            listLines.push(`${marker}${equipMark}${info.displayName}${refine}${note}`);
          });
        }
        detailLines = ['J/Enter：決定　K/Esc：取消'];
        break;
      }
      case 'ability': {
        const points = getUnspentAbilityPoints(this.state);
        const abilities = getAbilities(this.state);
        const selectedIndex = this.state.selectedAbilityIndex ?? 0;
        const pending = this.state.abilityConfirmPending;
        listLines.push('能力', `能力P：${points}`, '');
        ABILITY_IDS.forEach((id, i) => {
          const marker = !pending && i === selectedIndex ? '> ' : '  ';
          listLines.push(`${marker}${ABILITY_DISPLAY_NAMES[id]} ${abilities[id]}`);
        });
        if (pending) {
          const abilityName = ABILITY_DISPLAY_NAMES[pending];
          const previousValue = abilities[pending];
          detailLines.push(`${abilityName}を${previousValue}から${previousValue + 1}へ`);
          const choice = this.state.abilityConfirmChoice ?? 'no';
          detailLines.push(choice === 'yes' ? '  いいえ　>はい' : '>いいえ　  はい');
          detailLines.push('', '←→：選択　J/Enter：決定　K/Esc：戻る');
        } else {
          const id = ABILITY_IDS[selectedIndex];
          detailLines.push(formatAbilityEffectLine(this.state, id));
          if (points < 1) detailLines.push('（割り振り不可）');
          detailLines.push('', 'J/Enter：割り振る　K/Esc：戻る');
        }
        break;
      }
      case 'status': {
        const player = this.state.player;
        const hunger = getHunger(this.state);
        const level = getLevel(this.state);
        const expLabel = level >= LEVEL_CAP ? 'MAX' : `${getExperience(this.state)}/${getExperienceRequirement(level)}`;
        listLines.push(
          '状態',
          '',
          `HP: ${player.hp}/${player.maxHp}`,
          `SOL: ${this.state.solarEnergy}/${this.state.maxSolarEnergy}`,
          `満腹度: ${hunger}/${HUNGER_MAX}`,
          `LV ${level}  EXP ${expLabel}`,
          `攻撃 ${player.attack}  防御 ${player.defense}`,
          `エンチャント: ${this.enchantHudLabel().replace('ENCHANT：', '')}`,
          this.unlockedElementsHudLabel(),
        );
        const effects = getActiveEffects(this.state);
        if (effects.length > 0) {
          listLines.push('状態異常:');
          for (const e of effects) listLines.push(`  ${EFFECT_DEFINITIONS[e.id].displayName}`);
        }
        detailLines = ['K/Esc：戻る'];
        break;
      }
      case 'records': {
        listLines.push(
          '記録',
          '',
          `階層: ${this.state.floor}/${this.state.totalFloors}`,
          `ターン数: ${this.state.turn}`,
          `Run Seed: ${this.state.runSeed}`,
          `Floor Seed: ${this.state.seed}`,
          '',
          'メッセージ履歴:',
        );
        const history = this.messageHistory.slice(-10);
        for (const line of history) listLines.push(`  ${line}`);
        detailLines = ['K/Esc：戻る'];
        break;
      }
      case 'other': {
        listLines.push('その他', '');
        this.otherMenuItems().forEach((item, i) => {
          listLines.push(`${i === this.otherIndex ? '> ' : '  '}${item}`);
        });
        detailLines = ['J/Enter：決定　K/Esc：戻る'];
        break;
      }
      case 'help': {
        listLines.push(
          '操作説明',
          '',
          '移動: WASD/矢印/テンキー8246',
          '斜め移動: QEZC/テンキー7913',
          '攻撃・決定: J / Enter',
          '待機: Space / テンキー5',
          'ダッシュ: Shift+方向',
          '斜め固定: Ctrl+方向',
          '方向転換のみ: F+方向',
          'メインメニュー: I / Esc',
          'エンチャント切替: R',
        );
        detailLines = ['K/Esc：戻る'];
        break;
      }
      case 'confirm_quit': {
        listLines.push('冒険を終了しますか？', '');
        listLines.push(`${this.confirmQuitIndex === 0 ? '> ' : '  '}キャンセル`);
        listLines.push(`${this.confirmQuitIndex === 1 ? '> ' : '  '}終了する`);
        detailLines = ['↑↓：選択　J/Enter：決定　K/Esc：戻る'];
        break;
      }
    }

    this.drawMenuWindows(listLines, detailLines);
  }

  /** Shared small-window chrome (spec 8's panel/border colors) for whichever list+detail content refreshMenuOverlay built. */
  private drawMenuWindows(listLines: string[], detailLines: string[]): void {
    const listWidth = this.MENU_LIST_WIDTH;
    const listHeight = Math.min(FIELD_PIXEL_HEIGHT - 16, listLines.length * this.MENU_LINE_HEIGHT + this.MENU_PADDING * 2 + 8);
    const listX = 12;
    const listY = HUD_HEIGHT + 8;

    this.menuOverlayBg.clear();
    this.menuOverlayBg.fillStyle(COLORS.panelBg, COLORS.panelBgAlpha);
    this.menuOverlayBg.fillRect(listX, listY, listWidth, listHeight);
    this.menuOverlayBg.lineStyle(2, COLORS.borderOuter, 1);
    this.menuOverlayBg.strokeRect(listX + 1, listY + 1, listWidth - 2, listHeight - 2);
    this.menuOverlayBg.lineStyle(1, COLORS.borderInner, 0.8);
    this.menuOverlayBg.strokeRect(listX + 4, listY + 4, listWidth - 8, listHeight - 8);
    this.menuOverlayText.setPosition(listX + this.MENU_PADDING, listY + this.MENU_PADDING);
    this.menuOverlayText.setText(listLines.slice(0, Math.floor((listHeight - this.MENU_PADDING * 2) / this.MENU_LINE_HEIGHT)).join('\n'));

    const detailX = listX + listWidth + 12;
    const detailY = listY;
    const detailWidth = this.MENU_DETAIL_WIDTH;
    const detailHeight = listHeight;

    this.menuDetailBg.clear();
    this.menuDetailBg.fillStyle(COLORS.panelBg, COLORS.panelBgAlpha);
    this.menuDetailBg.fillRect(detailX, detailY, detailWidth, detailHeight);
    this.menuDetailBg.lineStyle(2, COLORS.borderOuter, 1);
    this.menuDetailBg.strokeRect(detailX + 1, detailY + 1, detailWidth - 2, detailHeight - 2);
    this.menuDetailText.setPosition(detailX + this.MENU_PADDING, detailY + this.MENU_PADDING);
    this.menuDetailText.setText(detailLines.join('\n'));
  }


  /**
   * Shared post-action pipeline for both normal move/wait/attack input and
   * a successful/failed item use: logs events, handles the immediate
   * floor-cleared regeneration, and animates/snaps every actor sprite to
   * its (possibly unchanged) position. `result.consumed === false` still
   * runs this safely — no positions will have changed, so every actor is
   * simply snapped in place.
   */
  private applyTurnResult(
    result: TurnResult,
    playerBefore: { x: number; y: number },
    enemiesBefore: { x: number; y: number }[],
  ): void {
    // Phase 23.3: snapshot of which tiles were visible before this
    // turn's refreshStaticView() call below recomputes this.currentVisible
    // for the post-move state — needed so a ghost's move animation never
    // tweens in from an unseen (wall) origin into a newly-visible
    // destination (fixed_spec's "視界外の壁内移動経路を画面へ漏らさな
    // い"). Captured here, before anything below can mutate
    // this.currentVisible.
    const visibleBeforeTurn = new Set(this.currentVisible);
    this.pushMessages(formatEvents(result.events));
    const phaseAfterTurn = this.state.phase as import('./game/types').GamePhase;

    if (phaseAfterTurn === 'floor_cleared') {
      // Immediate, no interstitial: regenerate the next floor synchronously
      // within this same key handling call, before any further input. The
      // previous floor's combat messages are not carried over — the log is
      // cleared and replaced with the floor-advance message.
      this.state = advanceToNextFloor(this.state);
      // Telemetry (Phase 10.3.1): floor_completed for the departed floor
      // was already pushed by recordTurn (detected from the pre-advance
      // phase transition); this only needs the new floor's own
      // floor_started, using the just-advanced state's turn/floor.
      recordFloorStarted(this.telemetry, this.state);
      this.clearMessages();
      this.pushMessage(formatEvent({ type: 'floor_advanced' }));
      this.resetSceneToCurrentState();
      return;
    }

    const playerMoved =
      this.state.player.pos.x !== playerBefore.x || this.state.player.pos.y !== playerBefore.y;

    this.refreshStaticView();

    if (playerMoved) {
      this.animateMove(this.playerSprite, 'player', this.state.player, playerBefore);
    } else {
      this.snapActor(this.playerSprite, this.state.player);
    }

    // Charge motion (Phase 09.3; Space made contextual as of Phase 09.3b):
    // played exactly once when the resolved action was a solar charge
    // (detected from the resolved events, not re-derived from input), on
    // top of the ordinary snap-in-place above. Increments
    // activeAnimations for its own duration so the existing "ignore
    // input while an animation plays" guard in handleKey also prevents a
    // second charge (or any other input) from landing mid-motion.
    if (result.events.some((event) => event.type === 'solar_charge_used')) {
      this.playChargeMotion();
    }

    // Sol melee enchantment activation flash (Phase 10.1): played exactly
    // once when the resolved action's events include a successful
    // activation (never on a whiff, SOL-insufficient, ineligible-weapon,
    // or plain hit) — detected from events, same pattern as the charge
    // motion above.
    if (result.events.some((event) => event.type === 'sol_enchantment_used')) {
      this.playSolEnchantFlash();
    }

    // MISS feedback (Phase 10.3 accuracy/evasion foundation): a brief
    // text popup at the affected tile for every miss this turn — a
    // player attack missing an enemy shows at that enemy's current
    // (post-turn) position; an enemy attack missing the player shows at
    // the player's current position. Purely cosmetic (never re-runs the
    // hit roll or any damage/HP logic, which has already been resolved
    // synchronously above) and never blocks input — see playMissText.
    for (const event of result.events) {
      if (event.type === 'player_attack_missed') {
        const target = this.state.enemies.find((e) => e.type === event.enemyType);
        if (target) this.playMissText(target.pos);
      } else if (event.type === 'enemy_attack_missed') {
        this.playMissText(this.state.player.pos);
      }
    }

    this.state.enemies.forEach((enemy, i) => {
      const before = enemiesBefore[i];
      const sprite = this.enemySprites[i];
      if (!sprite) {
        console.error(`applyTurnResult: no sprite at index ${i} for ${this.state.enemies.length} enemies (enemySprites has ${this.enemySprites.length}); skipping instead of crashing`);
        return;
      }
      const spriteKey = spriteKeyForEnemy(enemy, this.state.stepsClairvoyanceActive);
      const moved = enemy.pos.x !== before.x || enemy.pos.y !== before.y;
      // refreshStaticView() (called earlier this same turn, above) already
      // recomputed this.currentVisible from the player's post-move
      // position, so this reflects the destination tile's visibility.
      const visible = this.isCurrentlyVisible(enemy.pos);
      const alpha = ghostDisplayAlpha(this.state.map, enemy);
      // Phase 23.3: a move animation is only shown when the origin tile
      // was itself visible before this turn — otherwise (origin unseen,
      // destination newly visible) the sprite snaps directly to its new
      // tile instead of visibly sliding in from nowhere. When the
      // destination isn't visible either, animateMove/snapActor already
      // keep the sprite hidden throughout regardless of which is used,
      // so this only ever changes the "unseen -> now-visible" case.
      const originWasVisible = visibleBeforeTurn.has(visibilityPointKey(before));
      if (moved && (originWasVisible || !visible)) {
        this.animateMove(sprite, spriteKey, enemy, before, visible, alpha);
      } else {
        this.snapActor(sprite, enemy, spriteKey, visible, alpha);
      }
    });
  }

  /** Starts a brand-new run (floor 1) for `runSeed`; same runSeed always yields the same 3 floors. */
  private restart(runSeed: number): void {
    this.state = createInitialState(runSeed);
    this.telemetry = createRunTelemetry(this.state);
    this.endScreenShownForTelemetry = null;
    // Phase 20.0d: a new run must never carry over a stale selection or
    // pending effect from the previous run.
    this.cardTargetSelection = null;
    this.pendingCardTargetEffect.clear();
    this.hideEndScreen();
    this.clearMessages();
    this.resetSceneToCurrentState();
  }

  /** Redraws map/exit/camera/sprites to match `this.state` (used for both restarts and floor transitions). */
  private resetSceneToCurrentState(): void {
    // Phase 17.1: exploration memory/visibility must be (re)computed for
    // the new floor/run before any draw call below, since drawTerrain/
    // drawExit/drawGroundItems now read them.
    this.resetExploredTiles();
    this.updateVisibility();
    this.drawTerrain();
    this.drawExit();
    this.drawGroundItems();
    this.cameras.main.setBounds(
      0,
      0,
      this.state.map.width * TILE_SIZE,
      this.state.map.height * TILE_SIZE,
    );
    this.rebuildEnemySprites();
    this.refreshStaticView();
    this.snapActor(this.playerSprite, this.state.player);
    this.snapAllEnemies();
    // A new run/floor never starts with the menu open (menuScreen is
    // reset explicitly below), but keep the on-screen overlay in sync
    // regardless.
    this.menuScreen = 'closed';
    this.refreshMenuOverlay();
  }

  /**
   * Brief warm/platinum flash on the player sprite for a successful sol
   * enchantment activation (Phase 10.1): reuses the existing sprite (no
   * new image asset) via a short tint overlay, restored via
   * updatePlayerSlowedTint (not a bare clearTint) so it never fights with
   * the slowed-tint indicator if both happen to be relevant. Purely
   * cosmetic — never re-runs damage/SOL logic, which has already been
   * committed synchronously before this is called.
   */
  private readonly SOL_ENCHANT_FLASH_COLOR = 0xfff0b0;
  private readonly SOL_ENCHANT_FLASH_DURATION = 180;

  private playSolEnchantFlash(): void {
    this.playerSprite.setTint(this.SOL_ENCHANT_FLASH_COLOR);
    this.time.delayedCall(this.SOL_ENCHANT_FLASH_DURATION, () => {
      this.updatePlayerSlowedTint();
    });
  }

  /**
   * Brief "MISS" text popup at a tile (Phase 10.3 accuracy/evasion
   * foundation): a plain Phaser Text object (no new image asset),
   * created above every other layer, that fades out and destroys itself
   * — never left lingering, never blocking further turns (it isn't
   * tracked in activeAnimations since nothing needs to wait on it).
   */
  private readonly MISS_TEXT_DURATION = 500;

  private playMissText(tile: { x: number; y: number }): void {
    const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = tile.y * TILE_SIZE + TILE_SIZE * 0.2;
    const text = this.add
      .text(cx, cy, 'MISS', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1000);
    this.tweens.add({
      targets: text,
      y: cy - TILE_SIZE * 0.3,
      alpha: 0,
      duration: this.MISS_TEXT_DURATION,
      onComplete: () => text.destroy(),
    });
  }

  /**
   * Snaps a non-moving actor's sprite to its tile; it keeps idle-stepping
   * in place. `extraVisible` (Phase 17.1 rendering_rules.entities.enemies:
   * default true, used for the player who is always at a currently-
   * visible tile by construction) additionally gates visibility — passed
   * as `false` for an enemy outside `this.currentVisible` so it's hidden
   * regardless of `actor.alive`.
   */
  private snapActor(
    sprite: Phaser.GameObjects.Sprite,
    actor: GameState['player'],
    spriteKey: string = 'player',
    extraVisible: boolean = true,
    alpha: number = 1,
  ): void {
    const x = actor.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const y = actor.pos.y * TILE_SIZE + TILE_SIZE / 2;
    sprite.setPosition(x, y);
    sprite.setAlpha(alpha);
    sprite.setVisible(actor.alive && extraVisible);
    if (actor.alive) {
      this.ensureWalking(sprite, spriteKey, toDirection4(actor.facing));
    } else {
      sprite.anims.stop();
    }
  }

  /** Plays (or keeps playing) the walk loop for the given facing, avoiding animation restarts. */
  private ensureWalking(
    sprite: Phaser.GameObjects.Sprite,
    spriteKey: string,
    dir4: 'N' | 'E' | 'S' | 'W',
  ): void {
    const key = walkAnimKey(spriteKey, dir4);
    const current = sprite.anims.currentAnim;
    if (!current || current.key !== key) {
      sprite.play(key);
    }
  }

  /**
   * Brief visual feedback for a successful solar charge (Phase 09.3;
   * Space made contextual as of Phase 09.3b): a single scale pulse on
   * the existing player sprite — no new image asset, no screen shake, no
   * sound. Increments activeAnimations for its own duration (like
   * animateMove) so the "ignore input while an animation plays" guard in
   * handleKey doubles as a double-charge guard; purely cosmetic, so it
   * never affects the already-committed SOL amount or turn count from
   * applyPlayerAction's charge handling, which already ran
   * synchronously before this is called.
   */
  private readonly CHARGE_MOTION_DURATION = 160;

  private playChargeMotion(): void {
    this.activeAnimations += 1;
    this.tweens.add({
      targets: this.playerSprite,
      scaleX: SPRITE_SCALE_X * 1.15,
      scaleY: SPRITE_SCALE_Y * 1.15,
      duration: this.CHARGE_MOTION_DURATION,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.playerSprite.setScale(SPRITE_SCALE_X, SPRITE_SCALE_Y);
        this.activeAnimations -= 1;
      },
    });
  }

  /**
   * Tweens the sprite from its previous tile to its new tile while the
   * walk loop keeps playing. `extraVisible` (Phase 17.1, default true for
   * the player) additionally gates visibility for the whole tween — an
   * enemy whose destination tile isn't currently visible neither starts
   * visible nor plays its move animation (rendering_rules.effects: "視界
   * 外の敵のアニメーションを描画しない").
   */
  private animateMove(
    sprite: Phaser.GameObjects.Sprite,
    spriteKey: string,
    actor: GameState['player'],
    fromTile: { x: number; y: number },
    extraVisible: boolean = true,
    alpha: number = 1,
  ): void {
    const dir4 = toDirection4(actor.facing);
    const fromX = fromTile.x * TILE_SIZE + TILE_SIZE / 2;
    const fromY = fromTile.y * TILE_SIZE + TILE_SIZE / 2;
    const toX = actor.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const toY = actor.pos.y * TILE_SIZE + TILE_SIZE / 2;

    sprite.setPosition(fromX, fromY);
    sprite.setAlpha(alpha);
    sprite.setVisible(extraVisible);
    this.ensureWalking(sprite, spriteKey, dir4);

    this.activeAnimations += 1;
    this.tweens.add({
      targets: sprite,
      x: toX,
      y: toY,
      duration: this.MOVE_DURATION,
      onComplete: () => {
        sprite.setVisible(actor.alive && extraVisible);
        this.activeAnimations -= 1;
      },
    });
  }

  private refreshStaticView(): void {
    const { player } = this.state;

    // Phase 17.1: visibility must be current before any of the draws
    // below, since drawTerrain/drawExit/drawGroundItems/drawMinimap all
    // read this.currentVisible / this.exploredTiles.
    this.updateVisibility();
    this.drawTerrain();
    this.drawExit();
    this.drawWebs();
    this.drawTraps();
    this.drawGroundItems();
    this.drawTelegraphs();
    this.updatePlayerSlowedTint();
    this.refreshLogPanel();
    this.drawMinimap();
    this.refreshMenuOverlay();
    this.updateFacingMarker();

    const hunger = getHunger(this.state);
    // Phase 11.3: 0 gets an explicit "空腹" label so starvation is
    // unmistakable at a glance (hud.required's "0では飢餓状態を明確に認
    // 識できる表示にする"); 1..HUNGER_LOW_THRESHOLD keeps the plain
    // number (still visible as a low value against /100) rather than
    // adding a second label, since a single visual treatment (color)
    // for "low" would need a second Text object this HUD doesn't already
    // have — the existing HUD is a single plain-color Text line, so
    // introducing a distinct color for one segment isn't a minimal
    // change; the number itself already conveys "low" against /100.
    const hungerLabel = hunger <= 0 ? `${hunger}(空腹)` : `${hunger}`;
    const level = getLevel(this.state);
    // Phase 14.5 spec 5.1: a single HUD line with only immediate-glance
    // values. Run/Floor Seed moved to 記録, the control legend moved to
    // その他>操作説明, and the previous long enchant-mechanics sentence
    // removed from constant display (still available via 状態's
    // "エンチャント" line and 操作説明). Detailed EXP-to-next-level moved
    // to 状態 (spec 5.1's "通常HUDから外すもの: 詳細なEXP値").
    this.hudText.setText(
      `${this.state.floor}F  Lv${level}  HP ${player.hp}/${player.maxHp}  SOL ${this.state.solarEnergy}/${this.state.maxSolarEnergy}  満腹度 ${hungerLabel}  ${this.enchantHudLabel()}${this.effectsHudLabel()}`,
    );

    if (this.state.phase === 'gameover') {
      this.messageText.setText('GAME OVER\nEnter: same run   N: new run');
      this.messageText.setVisible(true);
      this.showEndScreen();
    } else if (this.state.phase === 'victory') {
      this.messageText.setText('VICTORY\nEnter: same run   N: new run');
      this.messageText.setVisible(true);
      this.showEndScreen();
    } else {
      this.messageText.setVisible(false);
      this.hideEndScreen();
    }
  }

  // ----- Phase 14.5: per-frame dash / long-press repeat driver -----

  /**
   * Advances dash continuation (Shift+direction held) and the generic
   * move/wait long-press repeat timers (spec 11.2/11.3/11.6). All three
   * are mutually exclusive per tick — a dash in progress takes priority
   * (and stopping it here never itself fires a move/wait repeat in the
   * same frame). Every stop condition checked here reads only
   * already-visible GameState (spec 11.3/11.6's "停止判定が既存ゲーム
   * 情報を越えて未発見対象を察知しないようにする"). No-ops entirely
   * while a menu/dialog is open, the game isn't in 'playing' phase, or a
   * move tween is still animating — matching handleRoutedKey's own guard.
   */
  update(time: number): void {
    if (this.state.phase !== 'playing' || this.menuScreen !== 'closed' || this.activeAnimations > 0) return;

    if (this.dashDirection) {
      if (this.dashRepeat.heldKey !== this.dashDirection) {
        this.dashRepeat = startRepeat(this.dashDirection, time);
        return;
      }
      const { shouldFire, timer } = tickRepeat(this.dashRepeat, time);
      this.dashRepeat = timer;
      if (!shouldFire) return;
      if (!canTakeDashStep(this.state, this.dashDirection)) {
        this.dashDirection = null;
        this.dashRepeat = stopRepeat();
        return;
      }
      const prevPos = { ...this.state.player.pos };
      const direction = this.dashDirection;
      this.dispatchGameAction({ type: 'move', direction });
      const newPos = this.state.player.pos;
      if (shouldStopDashAfterStep(this.state, prevPos, newPos)) {
        this.dashDirection = null;
        this.dashRepeat = stopRepeat();
      }
      return;
    }

    if (this.moveRepeat.heldKey) {
      const { shouldFire, timer } = tickRepeat(this.moveRepeat, time);
      this.moveRepeat = timer;
      if (shouldFire) {
        this.dispatchGameAction({ type: 'move', direction: this.moveRepeat.heldKey as import('./game/types').Direction8 });
      }
      return;
    }

    if (this.waitRepeat.heldKey) {
      const { shouldFire, timer } = tickRepeat(this.waitRepeat, time);
      this.waitRepeat = timer;
      if (shouldFire) {
        const hpBefore = this.state.player.hp;
        const solBefore = this.state.solarEnergy;
        this.dispatchGameAction({ type: 'wait' });
        const tookDamage = this.state.player.hp < hpBefore;
        const solNowFull = this.state.solarEnergy >= this.state.maxSolarEnergy && solBefore < this.state.maxSolarEnergy;
        const enemyApproaching = this.state.enemies.some(
          (e) => e.alive && Math.max(Math.abs(e.pos.x - this.state.player.pos.x), Math.abs(e.pos.y - this.state.player.pos.y)) <= 2,
        );
        if (this.state.phase !== 'playing' || tookDamage || solNowFull || enemyApproaching) {
          this.waitRepeat = stopRepeat();
        }
      }
    }
  }
}


// Phase 14.5 UI/input overhaul: the Phaser canvas is created at a FIXED
// logical resolution (LOGICAL_WIDTH x LOGICAL_HEIGHT) — internal drawing
// coordinates (TILE_SIZE, camera viewports, HUD/message strip positions)
// never change with window size, satisfying the redesign direction's
// "TILE_SIZEそのものを画面サイズに応じて動的変更することを前提にしない".
// Instead, the *displayed* CSS size of that same canvas is scaled by an
// integer factor to fill the available browser window, computed by
// applyIntegerScale() below and re-applied on every resize. Phaser's
// `pixelArt: true` already sets `image-rendering: pixelated` on the
// canvas element, so this CSS scaling stays crisp/nearest-neighbor at
// any integer factor (spec 6.2's "整数倍率を優先する" / "画像補間を無効
//化し、ピクセルの輪郭を保つ").
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  backgroundColor: '#1c1108',
  pixelArt: true,
  scene: [MainScene],
});

/**
 * Picks the largest integer >= 1 such that LOGICAL_WIDTH/HEIGHT scaled by
 * it still fits within the given available area, then applies that as
 * the canvas element's CSS width/height (its internal drawing-buffer
 * resolution is untouched). Falls back to 1x if the window is smaller
 * than the logical resolution itself, rather than shrinking below
 * integer scale (spec 12's "最小サイズで9×7の論理範囲を維持しつつ...3
 * 領域が同時に収まること" — 1x is the floor, sized panels/fonts are
 * designed to fit at 1x on the smallest required viewport, 960x540).
 */
function applyIntegerScale(): void {
  const canvas = game.canvas;
  if (!canvas) return;
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const maxScaleByWidth = Math.floor(availW / LOGICAL_WIDTH);
  const maxScaleByHeight = Math.floor(availH / LOGICAL_HEIGHT);
  const scale = Math.max(1, Math.min(maxScaleByWidth, maxScaleByHeight));
  canvas.style.width = `${LOGICAL_WIDTH * scale}px`;
  canvas.style.height = `${LOGICAL_HEIGHT * scale}px`;
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
}

game.events.once(Phaser.Core.Events.READY, applyIntegerScale);
window.addEventListener('resize', applyIntegerScale);
