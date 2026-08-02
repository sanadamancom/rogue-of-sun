import Phaser from 'phaser';
import { toDirection4 } from './game/direction';
import { actionForKey } from './game/input';
import { ENEMY_DEFINITIONS } from './game/enemy-def';
import { ITEM_DEFINITIONS } from './game/item-def';
import { ARMOR_DEFINITIONS } from './game/armor-def';
import { WEAPON_DEFINITIONS } from './game/weapon-def';
import {
  closeInventory,
  inventoryEntries,
  INVENTORY_CAPACITY,
  moveInventorySelection,
  toggleInventory,
  selectedInventoryAction,
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
  recordFloorStarted,
  recordTurn,
  snapshotForTurn,
  RunTelemetry,
} from './game/telemetry';
import { getCockatriceTelegraph, getKrakenTelegraph } from './game/telegraph';
import { getHunger, HUNGER_MAX } from './game/hunger';
import { EFFECT_DEFINITIONS, getActiveEffects } from './game/effects';
import { processTurn, TurnResult } from './game/turn';
import { DIRECTION_VECTORS, EnemyType, GameState } from './game/types';

// Latest 3 lines only, per message_lifecycle: newest at the bottom, oldest
// pushed out once over capacity.
const MESSAGE_LOG_CAPACITY = 3;

const TILE_SIZE = 48;
// Fixed viewport smaller than the full 40x30 map so the camera can follow
// the player instead of shrinking the whole map into view.
const VIEWPORT_TILES_WIDE = 16;
const VIEWPORT_TILES_HIGH = 12;

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

/** All distinct sprite sheet keys used by the current 9-species roster, in fixed roster order. */
function allEnemySpriteKeys(): string[] {
  return Object.values(ENEMY_DEFINITIONS).map((def) => def.spriteKey);
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
  private logPanelBg!: Phaser.GameObjects.Graphics;
  private logPanelText!: Phaser.GameObjects.Text;
  // Phase 08.2: ground-item glyphs (plain emoji text, no image asset) and
  // the Tab-toggled inventory overlay.
  private groundItemTexts: Phaser.GameObjects.Text[] = [];
  // Phase 08.6: minimal 8-direction facing marker (a small dot offset from
  // the player's tile center toward player.facing), since the player
  // sprite itself only distinguishes 4 directions (see toDirection4). No
  // new image asset — plain Graphics, same rule for all 8 directions.
  private facingMarker!: Phaser.GameObjects.Graphics;
  private inventoryOverlayBg!: Phaser.GameObjects.Graphics;
  private inventoryOverlayText!: Phaser.GameObjects.Text;

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

    this.terrainGraphics = this.add.graphics();
    this.exitGraphics = this.add.graphics();
    this.webGraphics = this.add.graphics();
    this.trapGraphics = this.add.graphics();
    this.drawTerrain();
    this.drawExit();
    this.drawWebs();
    this.drawTraps();
    this.drawGroundItems();

    const mapPixelWidth = this.state.map.width * TILE_SIZE;
    const mapPixelHeight = this.state.map.height * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);

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
      .text(8, 8, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setScrollFactor(0);

    this.messageText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 12, y: 8 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    this.createLogPanel();
    this.createInventoryOverlay();
    this.createEndScreenOverlay();

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      // Tab must never move browser focus off the canvas, and OS key-repeat
      // from a held Tab must not toggle the overlay open/closed repeatedly
      // (inventory_ui.open_close requirements).
      if (event.key === 'Tab') {
        event.preventDefault();
        if (event.repeat) return;
      }
      this.handleKey(event.key, event.shiftKey);
    });

    this.cameras.main.startFollow(this.playerSprite, true, 0.15, 0.15);

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
   * HUD text for the current enchantment state (Phase 10.1). Distinguishes
   * "not yet unlocked" from "unlocked but off" from "sol active" from "sol
   * selected but SOL currently empty" per ui.hud.required — the selection
   * itself is never hidden or reset just because SOL happens to be 0.
   */
  private enchantHudLabel(): string {
    if (!this.state.solUnlocked) return 'ENCHANT：未取得';
    if (this.state.selectedEnchantment === 'none') return 'ENCHANT：なし';
    if (this.state.solarEnergy <= 0) return 'ENCHANT：ソル（SOL不足）';
    return 'ENCHANT：ソル';
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
  private readonly LOG_LINE_HEIGHT = 18;

  private createLogPanel(): void {
    const panelHeight = MESSAGE_LOG_CAPACITY * this.LOG_LINE_HEIGHT + this.LOG_PANEL_PADDING * 2;
    const panelY = this.scale.height - panelHeight;

    this.logPanelBg = this.add.graphics().setScrollFactor(0);
    this.logPanelBg.fillStyle(0x000000, 0.55);
    this.logPanelBg.fillRect(0, panelY, this.scale.width, panelHeight);
    this.logPanelBg.lineStyle(1, 0xffffff, 0.25);
    this.logPanelBg.strokeRect(0, panelY, this.scale.width, panelHeight);

    this.logPanelText = this.add
      .text(this.LOG_PANEL_PADDING, panelY + this.LOG_PANEL_PADDING, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e8e8e8',
        lineSpacing: this.LOG_LINE_HEIGHT - 14,
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

  /** (Re)creates one sprite per current enemy, using each enemy's own texture, discarding any previous sprites/tweens. */
  private rebuildEnemySprites(): void {
    for (const sprite of this.enemySprites) {
      this.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    this.enemySprites = this.state.enemies.map((enemy) => {
      const sprite = this.add.sprite(0, 0, textureKeyForEnemyType(enemy.type), idleFrame('S'));
      sprite.setScale(SPRITE_SCALE_X, SPRITE_SCALE_Y);
      return sprite;
    });
  }

  private snapAllEnemies(): void {
    this.state.enemies.forEach((enemy, i) =>
      this.snapActor(this.enemySprites[i], enemy, textureKeyForEnemyType(enemy.type)),
    );
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

  private drawTerrain(): void {
    const { map, sunlight } = this.state;
    this.terrainGraphics.clear();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const isWall = map.terrain[y][x] === 'wall';
        this.terrainGraphics.fillStyle(isWall ? 0x333333 : 0x1c1c1c, 1);
        this.terrainGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        if (!isWall && sunlight[y]?.[x]) {
          this.terrainGraphics.fillStyle(this.SUNLIGHT_OVERLAY_COLOR, this.SUNLIGHT_OVERLAY_ALPHA);
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
      }
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

  private drawExit(): void {
    const { exit } = this.state;
    this.exitGraphics.clear();
    this.exitGraphics.fillStyle(0xffd54a, 1);
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
   * Draws only revealed (triggered) traps as a simple asset-free warning
   * mark, in the same plain-Graphics style as drawWebs (no new image
   * asset, per fixed_specification.trap.rendering's "発動後は新規外部
   * 画像を使わず、既存描画方式に合う簡素な罠記号を表示する"):
   * slow_trap keeps its existing Phase 12.2 dull-orange circle-with-X
   * (unchanged, per Phase 12.3's "既存slow_trapのオレンジ色の円＋X字を
   * 変更しない"); poison_trap (Phase 12.3) is a purple diamond outline
   * with a center dot, visually distinct from slow_trap's circle so the
   * two are never confused at a glance. Untriggered traps of either type
   * are deliberately skipped entirely — they render identically to plain
   * floor (fixed_specification.trap.rendering's "未発動時は通常床と完全
   * に同じ表示にする"), so there is nothing to draw for them. Redrawn
   * every turn/reset like drawWebs (a trap can flip from hidden to
   * revealed at most once per run, so this is cheap either way).
   */
  private drawTraps(): void {
    this.trapGraphics.clear();
    for (const trap of this.state.traps ?? []) {
      if (!trap.triggered) continue;
      const cx = trap.pos.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = trap.pos.y * TILE_SIZE + TILE_SIZE / 2;
      const r = TILE_SIZE * 0.28;

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
   */
  private drawGroundItems(): void {
    this.groundItemTexts.forEach((t) => t.destroy());
    this.groundItemTexts = this.state.groundItems.map((item) => {
      const glyph = ITEM_DEFINITIONS[item.itemId].glyph;
      const cx = item.pos.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = item.pos.y * TILE_SIZE + TILE_SIZE / 2;
      return this.add
        .text(cx, cy, glyph, { fontSize: `${Math.round(TILE_SIZE * 0.6)}px` })
        .setOrigin(0.5);
    });
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
  private createInventoryOverlay(): void {
    this.inventoryOverlayBg = this.add.graphics().setScrollFactor(0).setDepth(200).setVisible(false);
    this.inventoryOverlayText = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        lineSpacing: 6,
      })
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);
  }

  private readonly INVENTORY_OVERLAY_WIDTH = 300;
  private readonly INVENTORY_OVERLAY_PADDING = 14;

  // -----------------------------------------------------------------
  // End-screen report and JSON export (Phase 10.3.1)
  // -----------------------------------------------------------------

  /** Builds the (initially hidden) DOM overlay once; content is filled in by showEndScreen. */
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

  /**
   * Redraws the inventory overlay from the current state: hidden entirely
   * when closed; when open, shows the glyph/name/count of every item with
   * a positive count (inventory_ui.display), a ">" marker on the selected
   * entry, an empty-inventory message when there is nothing to show, and
   * the fixed control legend. Called after every state change that could
   * affect it (open/close, selection move, pickup, use, floor/restart).
   */
  private refreshInventoryOverlay(): void {
    const open = this.state.inventoryOpen;
    this.inventoryOverlayBg.setVisible(open);
    this.inventoryOverlayText.setVisible(open);
    if (!open) return;

    const entries = inventoryEntries(this.state);
    const current = totalInventoryCount(this.state);
    const lines: string[] = ['インベントリ', `${current} / ${INVENTORY_CAPACITY}`, ''];
    if (entries.length === 0) {
      lines.push('アイテムを持っていない');
    } else {
      entries.forEach((entry, i) => {
        const def = ITEM_DEFINITIONS[entry.itemId];
        const marker = i === this.state.selectedItemIndex ? '> ' : '  ';
        // Weapons/armor (Phase 08.3/08.4) show equip status instead of a
        // stack count (a count would misleadingly imply consumption);
        // consumables (apple) keep the existing x{count} display.
        let suffix: string;
        if (def.category === 'weapon') {
          const weaponDef = WEAPON_DEFINITIONS[entry.itemId as 'sword' | 'spear' | 'hammer'];
          const equipped = this.state.equippedWeaponId === entry.itemId;
          const status = equipped ? '装備中' : '未装備';
          // Phase 08.7: while the equipped hammer is recovering, surface
          // that in the same equip-status text rather than a separate
          // persistent HUD element.
          const recoilNote = equipped && entry.itemId === 'hammer' && this.state.hammerRecovery ? ' 反動中' : '';
          suffix = `（${status}${recoilNote} 攻撃${weaponDef.attackPower}・射程${weaponDef.reach}）`;
        } else if (def.category === 'armor') {
          const armorValue = ARMOR_DEFINITIONS[entry.itemId as 'armor'].armorValue;
          const status = this.state.equippedArmorId === entry.itemId ? '装備中' : '未装備';
          suffix = `（${status} 防御${armorValue}）`;
        } else {
          suffix = `x${entry.count}`;
        }
        lines.push(`${marker}${def.glyph} ${def.displayName} ${suffix}`);
      });
    }
    lines.push('');

    // Phase 11.2:捨てる confirmation replaces the normal control legend
    // while pending, and blocks the normal navigate/use/place/discard
    // keys (see handleInventoryKey) so no other menu action can fire
    // mid-confirmation.
    const confirmId = this.state.discardConfirmItemId;
    if (confirmId) {
      const name = ITEM_DEFINITIONS[confirmId].displayName;
      lines.push(`${name}を1個捨てますか？`);
      lines.push('Y:はい  N/Esc:いいえ');
    } else {
      lines.push('Tab/Esc:閉じる  ↑↓:選択  Enter:使用/装備  P:置く  X:捨てる');
    }

    const width = this.INVENTORY_OVERLAY_WIDTH;
    const lineHeight = 22;
    const height = lines.length * lineHeight + this.INVENTORY_OVERLAY_PADDING * 2;
    const x = (this.scale.width - width) / 2;
    const y = (this.scale.height - height) / 2;

    this.inventoryOverlayBg.clear();
    this.inventoryOverlayBg.fillStyle(0x000000, 0.85);
    this.inventoryOverlayBg.fillRect(x, y, width, height);
    this.inventoryOverlayBg.lineStyle(2, 0xffffff, 0.6);
    this.inventoryOverlayBg.strokeRect(x, y, width, height);

    this.inventoryOverlayText.setPosition(
      x + this.INVENTORY_OVERLAY_PADDING,
      y + this.INVENTORY_OVERLAY_PADDING,
    );
    this.inventoryOverlayText.setText(lines.join('\n'));
  }

  /**
   * Tints the player sprite while slowed (enemy-behavior-02) as the
   * minimal on-screen indicator required by the design — no new HUD text,
   * no numeric duration display. Cleared as soon as state.player.slowed
   * is false.
   */
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

  private handleKey(key: string, shiftKey = false): void {
    if (this.state.phase !== 'playing') {
      if (key === 'Enter') {
        this.restart(this.state.runSeed);
      } else if (key === 'n' || key === 'N') {
        this.restart(randomSeed());
      }
      return;
    }

    // While a move tween is in flight, ignore further input (including OS
    // key-repeat from a held key) so overlapping tweens can't make a sprite
    // appear to skip through tiles/walls. Applies to every branch below
    // (Tab, inventory navigation/use, and normal move/attack/wait).
    if (this.activeAnimations > 0) return;

    // Tab toggles the inventory overlay from anywhere in normal play, and
    // never consumes a turn either way.
    if (key === 'Tab') {
      toggleInventory(this.state);
      this.refreshInventoryOverlay();
      return;
    }

    if (this.state.inventoryOpen) {
      this.handleInventoryKey(key);
      return;
    }

    const action = actionForKey(key, shiftKey);
    if (!action) return;

    const playerBefore = { ...this.state.player.pos };
    const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
    // Telemetry (Phase 10.3.1): snapshot must be taken before processTurn
    // mutates state.player/state.enemies in place — see telemetry.ts's
    // TurnSnapshot doc comment.
    const turnSnapshot = snapshotForTurn(this.state);
    const result = processTurn(this.state, action);
    recordTurn(this.telemetry, action, result, turnSnapshot, this.state);
    finalizeRun(this.telemetry, this.state);
    this.applyTurnResult(result, playerBefore, enemiesBefore);
  }

  /**
   * Handles a keypress while the inventory overlay is open
   * (inventory_ui.navigation): ArrowUp/ArrowDown move the selection,
   * Escape closes, Enter uses the selected item, and every other key is
   * swallowed here — normal move/attack/wait input never reaches
   * processTurn while the overlay is shown (processTurn's own
   * inventoryOpen guard enforces the same rule at the state level as a
   * second line of defense). None of open/close/select consume a turn.
   */
  private handleInventoryKey(key: string): void {
    // Phase 11.2 discard confirmation: while pending, only Y (confirm) and
    // N/Escape (cancel) are handled — every other overlay key (navigate,
    // use, place, re-trigger discard) is swallowed so nothing else can
    // fire mid-confirmation (menu_behavior: "確認中は通常移動・攻撃など
    // を実行しない").
    if (this.state.discardConfirmItemId) {
      const itemId = this.state.discardConfirmItemId;
      if (key === 'y' || key === 'Y') {
        this.state.discardConfirmItemId = null;
        const playerBefore = { ...this.state.player.pos };
        const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
        const action = { type: 'discard_item' as const, itemId };
        const turnSnapshot = snapshotForTurn(this.state);
        const result = processTurn(this.state, action);
        recordTurn(this.telemetry, action, result, turnSnapshot, this.state);
        finalizeRun(this.telemetry, this.state);
        this.applyTurnResult(result, playerBefore, enemiesBefore);
        this.refreshInventoryOverlay();
        return;
      }
      if (key === 'n' || key === 'N' || key === 'Escape') {
        // Cancel only clears the pending confirmation (per
        // discard_action.confirmation: "キャンセルおよび所持品画面を閉じ
        // た場合は削除しない") — it does not also close the overlay, so
        // Escape here is a single step back rather than a double-close.
        this.state.discardConfirmItemId = null;
        this.refreshInventoryOverlay();
        return;
      }
      return;
    }

    if (key === 'Escape') {
      closeInventory(this.state);
      this.refreshInventoryOverlay();
      return;
    }
    if (key === 'ArrowUp') {
      moveInventorySelection(this.state, -1);
      this.refreshInventoryOverlay();
      return;
    }
    if (key === 'ArrowDown') {
      moveInventorySelection(this.state, 1);
      this.refreshInventoryOverlay();
      return;
    }
    if (key === 'Enter') {
      const playerBefore = { ...this.state.player.pos };
      const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
      // Telemetry (Phase 10.3.2 fix): this Enter-to-equip/use path
      // previously never called recordTurn/finalizeRun at all, so every
      // weapon/armor equip and every apple/sun-fruit use made through
      // the inventory overlay was silently invisible to telemetry (the
      // "missing_equipment_changes" root cause). selectedInventoryAction
      // determines the PlayerAction Enter is about to submit — the same
      // routing useSelectedInventoryItem itself does internally — purely
      // so recordTurn can be given a real action instead of guessing.
      const action = selectedInventoryAction(this.state);
      const turnSnapshot = snapshotForTurn(this.state);
      const result = useSelectedInventoryItem(this.state);
      if (action) {
        recordTurn(this.telemetry, action, result, turnSnapshot, this.state);
        finalizeRun(this.telemetry, this.state);
      }
      this.applyTurnResult(result, playerBefore, enemiesBefore);
      this.refreshInventoryOverlay();
      return;
    }
    // Phase 11.2: P places the selected item at the player's feet
    // immediately (no confirmation — matches place_action having no
    // confirmation_required flag, unlike discard). A no-op (no action
    // submitted at all) when nothing is selected.
    if (key === 'p' || key === 'P') {
      const itemId = selectedItemId(this.state);
      if (!itemId) return;
      const playerBefore = { ...this.state.player.pos };
      const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
      const action = { type: 'place_item' as const, itemId };
      const turnSnapshot = snapshotForTurn(this.state);
      const result = processTurn(this.state, action);
      recordTurn(this.telemetry, action, result, turnSnapshot, this.state);
      finalizeRun(this.telemetry, this.state);
      this.applyTurnResult(result, playerBefore, enemiesBefore);
      this.refreshInventoryOverlay();
      return;
    }
    // Phase 11.2: X opens the discard confirmation for the selected item
    // (discard_action.confirmation_required) rather than discarding
    // immediately. A no-op when nothing is selected.
    if (key === 'x' || key === 'X') {
      const itemId = selectedItemId(this.state);
      if (!itemId) return;
      this.state.discardConfirmItemId = itemId;
      this.refreshInventoryOverlay();
      return;
    }
    // Every other key (movement, wait, etc.) is ignored while the overlay
    // is open.
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
    this.messageLog.pushMany(formatEvents(result.events));
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
      this.messageLog.clear();
      this.messageLog.push(formatEvent({ type: 'floor_advanced' }));
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
      const spriteKey = textureKeyForEnemyType(enemy.type);
      const moved = enemy.pos.x !== before.x || enemy.pos.y !== before.y;
      if (moved) {
        this.animateMove(sprite, spriteKey, enemy, before);
      } else {
        this.snapActor(sprite, enemy, spriteKey);
      }
    });
  }

  /** Starts a brand-new run (floor 1) for `runSeed`; same runSeed always yields the same 3 floors. */
  private restart(runSeed: number): void {
    this.state = createInitialState(runSeed);
    this.telemetry = createRunTelemetry(this.state);
    this.endScreenShownForTelemetry = null;
    this.hideEndScreen();
    this.messageLog.clear();
    this.resetSceneToCurrentState();
  }

  /** Redraws map/exit/camera/sprites to match `this.state` (used for both restarts and floor transitions). */
  private resetSceneToCurrentState(): void {
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
    // A new run/floor never starts with the overlay open (state.inventoryOpen
    // is always freshly false from buildFloorState), but keep the on-screen
    // overlay in sync regardless.
    this.refreshInventoryOverlay();
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

  /** Snaps a non-moving actor's sprite to its tile; it keeps idle-stepping in place. */
  private snapActor(
    sprite: Phaser.GameObjects.Sprite,
    actor: GameState['player'],
    spriteKey: string = 'player',
  ): void {
    const x = actor.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const y = actor.pos.y * TILE_SIZE + TILE_SIZE / 2;
    sprite.setPosition(x, y);
    sprite.setVisible(actor.alive);
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

  /** Tweens the sprite from its previous tile to its new tile while the walk loop keeps playing. */
  private animateMove(
    sprite: Phaser.GameObjects.Sprite,
    spriteKey: string,
    actor: GameState['player'],
    fromTile: { x: number; y: number },
  ): void {
    const dir4 = toDirection4(actor.facing);
    const fromX = fromTile.x * TILE_SIZE + TILE_SIZE / 2;
    const fromY = fromTile.y * TILE_SIZE + TILE_SIZE / 2;
    const toX = actor.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const toY = actor.pos.y * TILE_SIZE + TILE_SIZE / 2;

    sprite.setPosition(fromX, fromY);
    sprite.setVisible(true);
    this.ensureWalking(sprite, spriteKey, dir4);

    this.activeAnimations += 1;
    this.tweens.add({
      targets: sprite,
      x: toX,
      y: toY,
      duration: this.MOVE_DURATION,
      onComplete: () => {
        sprite.setVisible(actor.alive);
        this.activeAnimations -= 1;
      },
    });
  }

  private refreshStaticView(): void {
    const { player } = this.state;

    this.drawWebs();
    this.drawTraps();
    this.drawGroundItems();
    this.drawTelegraphs();
    this.updatePlayerSlowedTint();
    this.refreshLogPanel();
    this.refreshInventoryOverlay();
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
    const hungerLabel = hunger <= 0 ? `${hunger} / ${HUNGER_MAX} (空腹)` : `${hunger} / ${HUNGER_MAX}`;
    this.hudText.setText(
      `FLOOR ${this.state.floor}/${this.state.totalFloors}   HP: ${player.hp}/${player.maxHp}   SOL ${this.state.solarEnergy} / ${this.state.maxSolarEnergy}   満腹度 ${hungerLabel}   ${this.enchantHudLabel()}${this.effectsHudLabel()}   Turn: ${this.state.turn}\n` +
        `Run Seed: ${this.state.runSeed}   Floor Seed: ${this.state.seed}\n` +
        `移動:方向キー  Shift+方向:向き変更  X:攻撃  Space：待機／日向でチャージ  F:エンチャント切替  Tab:インベントリ`,
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
}

const width = VIEWPORT_TILES_WIDE * TILE_SIZE;
const height = VIEWPORT_TILES_HIGH * TILE_SIZE;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width,
  height,
  backgroundColor: '#000000',
  pixelArt: true,
  scene: [MainScene],
});
