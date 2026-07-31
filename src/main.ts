import Phaser from 'phaser';
import { toDirection4 } from './game/direction';
import { actionForKey } from './game/input';
import { ENEMY_DEFINITIONS } from './game/enemy-def';
import { ITEM_DEFINITIONS } from './game/item-def';
import {
  closeInventory,
  inventoryEntries,
  moveInventorySelection,
  toggleInventory,
  useSelectedInventoryItem,
} from './game/inventory';
import { formatEvent, formatEvents, MessageLog } from './game/message-log';
import { advanceToNextFloor, createInitialState, randomSeed } from './game/state';
import { getCockatriceTelegraph, getKrakenTelegraph } from './game/telegraph';
import { processTurn, TurnResult } from './game/turn';
import { EnemyType, GameState } from './game/types';

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
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private exitGraphics!: Phaser.GameObjects.Graphics;
  private webGraphics!: Phaser.GameObjects.Graphics;
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

    this.terrainGraphics = this.add.graphics();
    this.exitGraphics = this.add.graphics();
    this.webGraphics = this.add.graphics();
    this.drawTerrain();
    this.drawExit();
    this.drawWebs();
    this.drawGroundItems();

    const mapPixelWidth = this.state.map.width * TILE_SIZE;
    const mapPixelHeight = this.state.map.height * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);

    this.playerSprite = this.add.sprite(0, 0, 'player', idleFrame('S'));
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

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      // Tab must never move browser focus off the canvas, and OS key-repeat
      // from a held Tab must not toggle the overlay open/closed repeatedly
      // (inventory_ui.open_close requirements).
      if (event.key === 'Tab') {
        event.preventDefault();
        if (event.repeat) return;
      }
      this.handleKey(event.key);
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

  private drawTerrain(): void {
    const { map } = this.state;
    this.terrainGraphics.clear();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const isWall = map.terrain[y][x] === 'wall';
        this.terrainGraphics.fillStyle(isWall ? 0x333333 : 0x1c1c1c, 1);
        this.terrainGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
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
    const lines: string[] = ['インベントリ', ''];
    if (entries.length === 0) {
      lines.push('アイテムを持っていない');
    } else {
      entries.forEach((entry, i) => {
        const def = ITEM_DEFINITIONS[entry.itemId];
        const marker = i === this.state.selectedItemIndex ? '> ' : '  ';
        // Weapons (Phase 08.3) show equip status instead of a stack count
        // (a count would misleadingly imply consumption); consumables
        // (apple) keep the existing x{count} display.
        const suffix =
          def.category === 'weapon'
            ? this.state.equippedWeaponId === entry.itemId
              ? '（装備中）'
              : '（未装備）'
            : `x${entry.count}`;
        lines.push(`${marker}${def.glyph} ${def.displayName} ${suffix}`);
      });
    }
    lines.push('');
    lines.push('Tab/Esc:閉じる  ↑↓:選択  Enter:使用/装備');

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

  private handleKey(key: string): void {
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

    const action = actionForKey(key);
    if (!action) return;

    const playerBefore = { ...this.state.player.pos };
    const enemiesBefore = this.state.enemies.map((enemy) => ({ ...enemy.pos }));
    const result = processTurn(this.state, action);
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
      const result = useSelectedInventoryItem(this.state);
      this.applyTurnResult(result, playerBefore, enemiesBefore);
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
    this.drawGroundItems();
    this.drawTelegraphs();
    this.updatePlayerSlowedTint();
    this.refreshLogPanel();
    this.refreshInventoryOverlay();

    this.hudText.setText(
      `FLOOR ${this.state.floor}/${this.state.totalFloors}   HP: ${player.hp}/${player.maxHp}   Turn: ${this.state.turn}\n` +
        `Run Seed: ${this.state.runSeed}   Floor Seed: ${this.state.seed}`,
    );

    if (this.state.phase === 'gameover') {
      this.messageText.setText('GAME OVER\nEnter: same run   N: new run');
      this.messageText.setVisible(true);
    } else if (this.state.phase === 'victory') {
      this.messageText.setText('VICTORY\nEnter: same run   N: new run');
      this.messageText.setVisible(true);
    } else {
      this.messageText.setVisible(false);
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
