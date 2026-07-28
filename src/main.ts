import Phaser from 'phaser';
import { toDirection4 } from './game/direction';
import { actionForKey } from './game/input';
import { createInitialState } from './game/state';
import { processTurn } from './game/turn';
import { GameState } from './game/types';

const TILE_SIZE = 48;

class MainScene extends Phaser.Scene {
  private state!: GameState;
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private playerSprite!: Phaser.GameObjects.Rectangle;
  private playerFacingMark!: Phaser.GameObjects.Triangle;
  private enemySprite!: Phaser.GameObjects.Rectangle;
  private enemyFacingMark!: Phaser.GameObjects.Triangle;
  private hudText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  constructor() {
    super('main');
  }

  create(): void {
    this.state = createInitialState();

    this.terrainGraphics = this.add.graphics();
    this.drawTerrain();

    this.playerSprite = this.add.rectangle(0, 0, TILE_SIZE - 8, TILE_SIZE - 8, 0x4da6ff);
    this.playerFacingMark = this.add.triangle(0, 0, 0, 6, -6, -6, 6, -6, 0xffffff);
    this.enemySprite = this.add.rectangle(0, 0, TILE_SIZE - 8, TILE_SIZE - 8, 0xff5555);
    this.enemyFacingMark = this.add.triangle(0, 0, 0, 6, -6, -6, 6, -6, 0xffffff);

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

    processTurn(this.state, action);
    this.refreshView();
  }

  private facingAngle(dir4: 'N' | 'S' | 'E' | 'W'): number {
    switch (dir4) {
      case 'N':
        return -90;
      case 'S':
        return 90;
      case 'E':
        return 0;
      case 'W':
        return 180;
    }
  }

  private refreshView(): void {
    const { player, enemy } = this.state;

    const px = player.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = player.pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.playerSprite.setPosition(px, py);
    this.playerSprite.setVisible(player.alive);
    this.playerFacingMark.setPosition(px, py);
    this.playerFacingMark.setAngle(this.facingAngle(toDirection4(player.facing)));
    this.playerFacingMark.setVisible(player.alive);

    const ex = enemy.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const ey = enemy.pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.enemySprite.setPosition(ex, ey);
    this.enemySprite.setVisible(enemy.alive);
    this.enemyFacingMark.setPosition(ex, ey);
    this.enemyFacingMark.setAngle(this.facingAngle(toDirection4(enemy.facing)));
    this.enemyFacingMark.setVisible(enemy.alive);

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
