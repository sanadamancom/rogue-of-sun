import Phaser from 'phaser';
import { toDirection4 } from './game/direction';
import { actionForKey } from './game/input';
import { createInitialState } from './game/state';
import { processTurn } from './game/turn';
import { GameState } from './game/types';

const TILE_SIZE = 48;

// Sprite sheet layout (shared by player.png and bok_lv1.png):
// 3 columns (frames) x 4 rows (directions), each cell 24x32 px.
// Row order: up, right, down, left.
const SPRITE_FRAME_WIDTH = 24;
const SPRITE_FRAME_HEIGHT = 32;
const SPRITE_SCALE = 1.5;
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
  return [base, base + 1, base + 2];
}

function walkAnimKey(spriteKey: string, dir4: 'N' | 'E' | 'S' | 'W'): string {
  return `${spriteKey}-walk-${dir4}`;
}

class MainScene extends Phaser.Scene {
  private state!: GameState;
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private enemySprite!: Phaser.GameObjects.Sprite;
  private hudText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

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
  }

  create(): void {
    this.state = createInitialState();

    this.terrainGraphics = this.add.graphics();
    this.drawTerrain();

    this.playerSprite = this.add.sprite(0, 0, 'player', idleFrame('S'));
    this.playerSprite.setScale(SPRITE_SCALE);
    this.enemySprite = this.add.sprite(0, 0, 'bok_lv1', idleFrame('S'));
    this.enemySprite.setScale(SPRITE_SCALE);
    this.createWalkAnimations('player');
    this.createWalkAnimations('bok_lv1');

    this.hudText = this.add.text(8, 8, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    });

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
      .setVisible(false);

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      this.handleKey(event.key);
    });

    this.refreshView();
  }

  private createWalkAnimations(spriteKey: string): void {
    (['N', 'E', 'S', 'W'] as const).forEach((dir4) => {
      this.anims.create({
        key: walkAnimKey(spriteKey, dir4),
        frames: this.anims.generateFrameNumbers(spriteKey, { frames: walkFrames(dir4) }),
        frameRate: 8,
        repeat: 0,
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

  private handleKey(key: string): void {
    if (this.state.phase !== 'playing') {
      if (key === 'Enter') {
        this.state = createInitialState();
        this.refreshView();
      }
      return;
    }

    const action = actionForKey(key);
    if (!action) return;

    const playerBefore = { ...this.state.player.pos };
    const enemyBefore = { ...this.state.enemy.pos };

    processTurn(this.state, action);

    const playerMoved =
      this.state.player.pos.x !== playerBefore.x || this.state.player.pos.y !== playerBefore.y;
    const enemyMoved =
      this.state.enemy.pos.x !== enemyBefore.x || this.state.enemy.pos.y !== enemyBefore.y;

    this.refreshView();

    if (playerMoved) {
      this.playWalkOnce(this.playerSprite, 'player', toDirection4(this.state.player.facing));
    }
    if (enemyMoved) {
      this.playWalkOnce(this.enemySprite, 'bok_lv1', toDirection4(this.state.enemy.facing));
    }
  }

  private playWalkOnce(
    sprite: Phaser.GameObjects.Sprite,
    spriteKey: string,
    dir4: 'N' | 'E' | 'S' | 'W',
  ): void {
    sprite.play(walkAnimKey(spriteKey, dir4));
    sprite.once('animationcomplete', () => {
      sprite.setFrame(idleFrame(dir4));
    });
  }

  private refreshView(): void {
    const { player, enemy } = this.state;

    const px = player.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = player.pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.playerSprite.setPosition(px, py);
    this.playerSprite.setVisible(player.alive);
    this.playerSprite.setFrame(idleFrame(toDirection4(player.facing)));

    const ex = enemy.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const ey = enemy.pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.enemySprite.setPosition(ex, ey);
    this.enemySprite.setVisible(enemy.alive);
    this.enemySprite.setFrame(idleFrame(toDirection4(enemy.facing)));

    this.hudText.setText(
      `HP: ${player.hp}/${player.maxHp}   Turn: ${this.state.turn}`,
    );

    if (this.state.phase === 'gameover') {
      this.messageText.setText('GAME OVER\nPress Enter to restart');
      this.messageText.setVisible(true);
    } else if (this.state.phase === 'victory') {
      this.messageText.setText('VICTORY\nPress Enter to restart');
      this.messageText.setVisible(true);
    } else {
      this.messageText.setVisible(false);
    }
  }
}

const state = createInitialState();
const width = state.map.width * TILE_SIZE;
const height = state.map.height * TILE_SIZE;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width,
  height,
  backgroundColor: '#000000',
  scene: [MainScene],
});
