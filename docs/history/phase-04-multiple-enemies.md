# Phase 04: Multiple Enemies and Natural HP Regeneration

## 目的と対象範囲

1体固定だった敵管理を、各フロア2体固定の「ボク」を扱える構造へ変更した。
全2体を撃破しない限り階段は開放されない。また複数階にわたる近接戦闘で
HPが一方的に減り続ける問題を解消するため、ターン消費行動5回ごとに
HPを1回復する自然回復を追加した。敵種追加・階層別個体数増加・アイテム・
成長・視界システムなど、Phase 04の範囲外には着手していない。

## GameStateからenemiesへの変更

- `GameState.enemy: Actor` を `GameState.enemies: Actor[]` に置き換えた。
- 生成時点から固定順序の配列として保持し、死亡した敵は配列から削除せず
  `alive: false` のまま残す(インデックスやspliceによる並べ替えは行わない)。
- `GameState.regenProgress: number` を追加(初期値0、自然回復の進行度)。

## 配置方式と決定性

- `Placement.enemy: Vec2` を `Placement.enemies: Vec2[]`(2体固定、
  `ENEMY_COUNT_PER_FLOOR = 2`)に拡張した。
- 既存の床候補抽出ロジック(start非隣接・start/exit非重複)はそのまま維持し、
  候補プールからのFisher–Yates式の非復元抽出をfloor Seed由来のplacement RNG
  だけで行う。候補が2体分に満たない場合は明示的に例外を投げ、1体へ黙って
  縮退させることはしない。
- 同じrun Seed・floor番号では常に同じ2体の配置になる(テストで検証)。

## enemy行動順とactor衝突規則

- プレイヤー行動を解決した後、`state.enemies` の配列順に生存enemyだけを
  1回ずつ行動させる。
- 各enemyの行動後にプレイヤーの生死を確認し、死亡していればそれ以降の
  enemyの行動を打ち切る。
- 敵の移動先は、プレイヤーの現在地・他の生存enemyの現在地(既に移動した
  enemyの移動後座標を含む)を占有マスとして除外し、死亡enemyは占有判定
  から除外する。移動候補が全て塞がれていれば待機する。
- 既存の追跡方向優先順位・斜め角抜け禁止はそのまま維持した。

## 階段開放条件

`state.enemies.every(enemy => !enemy.alive)` で判定する。1体でも生存して
いれば階段上で行動しても`floor_cleared`/`victory`へ進行しない。

## 自然HP回復の実装位置と処理順

`processTurn`内、プレイヤー行動→enemy全員の行動→プレイヤー死亡判定の
直後に実施する。

1. プレイヤーが生存している場合のみ進行対象にする(死亡ターンは回復しない)
2. HPがmaxHP未満なら`regenProgress`を1増加させる
3. `regenProgress`が`REGEN_TURNS_PER_HP`(=5、名前付き定数として`turn.ts`に定義)
   に到達したらHPを1回復し、`regenProgress`を0に戻す(1ターンで複数HP
   回復しないよう`if`で一度だけ判定)
4. HPがmaxHP以上ならその時点で`regenProgress`を0にする(蓄積しない)
5. その後に階段到達判定とturn確定を行う

blocked move(壁移動・斜め角抜け禁止によるもの)は`consumed=false`のため
`processTurn`の早期returnで完全に処理対象外となり、`regenProgress`は
変化しない。被弾しても`regenProgress`はリセットしない。

## フロア移動時の引継ぎ

- 現在HPと`regenProgress`を次階へそのまま引き継ぐ(即時回復なし)。
- 次階では新しい生存2体のenemiesを生成する。

## Enter/N時の初期化

`createInitialState`は常に`regenProgress: 0`で新しいGameStateを構築する
ため、Enter(同一run Seed再開)・N(新run Seed開始)のどちらも初期化される。

## renderingでのsprite管理

- `enemySprite`単体を`enemySprites: Phaser.GameObjects.Sprite[]`配列に
  置き換え、`state.enemies`と同数・同順のindexで対応づける。
- `rebuildEnemySprites()`で既存sprite・tweenを破棄してから
  `state.enemies`と同数のsprite(bok_lv1、既存animation)を再生成する。
  初回`create()`・フロア切替・Enter/N再開の`resetSceneToCurrentState()`
  経由で必ず呼ばれ、sprite数の増殖を防ぐ。
- 移動したenemyだけを`animateMove`でtweenさせ、その他は`snapActor`で
  即時反映する。死亡enemyは`snapActor`内の`alive`チェックにより
  非表示になる。
- 既存の32×32表示処理(frame slicing、非均等scale、TILE_SIZE、camera
  follow、HUD位置)には一切手を加えていない。

## 変更ファイル

- `src/game/types.ts`
- `src/game/mapgen.ts`
- `src/game/state.ts`
- `src/game/turn.ts`
- `src/main.ts`
- `src/game/__tests__/turn.test.ts`(複数敵・自然回復のテストを追加・更新)
- `src/game/__tests__/placement.test.ts`
- `src/game/__tests__/multi-floor.test.ts`
- `src/game/__tests__/multi-floor-robustness.test.ts`
- `src/game/__tests__/robustness.test.ts`
- `src/game/__tests__/integration.test.ts`
- `src/game/__tests__/seed-restart.test.ts`
- `src/game/__tests__/state.test.ts`

## テスト結果

全20ファイル101件pass(既存88件+複数敵/自然回復関連の追加・更新テスト)。
`multi-floor-robustness.test.ts`内で100 run Seed×3フロア=300フロアの
生成成功・2体配置・形状検査・決定性検査を実施し、失敗0件を確認した。
Seed 2780624551を用いた3フロア決定性・進行の回帰も
`multi-floor.test.ts`内で確認した。

## 型チェック・build・git diff --check

`tsc -b --noEmit`、`npm run build`(vite build)、`git diff --check`は
いずれも成功。`tsc -b`がsrc配下に生成する一時JSファイルはbuild後に削除し、
working treeから除外した。

## headless browser確認

このサンドボックス環境のネットワーク許可ドメインにChromiumの依存パッケージ
(deb.nodesource.com等)取得先が含まれておらず、Playwrightのブラウザインストール
が失敗したため、headless browserでの実表示確認は実施できなかった。
自動テストによる内部ロジックの検証(配置・行動順・自然回復・階段開放)は
完了しているが、実ブラウザでのsprite表示・アニメーション・console error
の確認は未実施であり、ユーザーによる確認が必要。

## 未確認事項

- headless browserによる表示確認(上記の理由により未実施)
- 実際のブラウザでの対話的な3フロア通しプレイ
- 自然回復のバランス(5ターンで1HP)はPhase 04時点の初期設定であり、
  確定したものではない
