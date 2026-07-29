# Phase 06: Enemy Roster Foundation

## 目的と対象範囲

Phase 05までは「ボク1体＋スパイダー1体」の固定2体構成だった。本タスクでは
9種類全ての敵（ボク、コカトリス、スパイダー、コウモリ、マミー、ゴーレム、
ソード、アックス、クラーケン）を共通の敵定義へ登録し、ダンジョン内へ
全種類を生成し、正しいスプライトで表示できる状態にした。敵ごとの完成版
固有AI（コカトリスの石化球、スパイダーのクモの巣、コウモリの壁越えと
8方向移動、マミーの音追跡など）、敵レベル、状態異常、ドロップ、経験値、
ボス処理、詳細なゲームバランス調整、新規アセット作成には着手していない。

## EnemyType の拡張

- `types.ts`の`EnemyType`を`'bok' | 'spider'`から9種のunion型へ拡張した。

## 共通敵定義テーブル（`src/game/enemy-def.ts`、新設）

- `EnemyDefinition`（id/displayName/spriteKey/hp/attack/behaviorType/
  movementType/stationary）と、9種分の`ENEMY_DEFINITIONS`レコードを追加した。
- 固定出現順`ENEMY_TYPES_IN_ORDER`（bok, cockatrice, spider, bat, mummy,
  golem, sword, axe, kraken）を定義し、敵生成・描画・AI分岐が同じ順序と
  定義を共有するようにした。
- 暫定HP/攻撃力（bok=2/1, cockatrice=3/1, spider=2/1, bat=2/1, mummy=5/2,
  golem=8/3, sword=4/2, axe=6/3, kraken=6/2）は、本タスクのconfirmed_spec
  に記載された値をそのまま採用した。1箇所（このテーブル）を変更すれば
  全体へ反映される。

## 敵生成数（`mapgen.ts`）※後述の密度補正で最終的にこの節の内容へ確定

- 初回実装では`ENEMY_COUNT_PER_FLOOR`を2から9へ変更し、通常生成のまま
  「1フロアに全9種を最低1体ずつ配置」する方式を採ったが、これは
  「全種類を見せるためだけに通常フロアの敵密度を増やさない」という
  指示に反すると指摘され、本ファイル末尾の「密度補正」の通り2へ
  差し戻した。最終的な値は**2**（基盤実装前と同じ）。
- 300フロア（run seed 1-100 × 3階）でのロバスト性テストは、差し戻し後の
  2体構成でも変わらず全件成功することを確認済み。
- 敵ごとの地形別配置条件・密度調整（種ごとの出現重み等）は本タスクの
  範囲外として据え置いた。

## 敵生成ロジック（`state.ts`）

- 敵の生成を`ENEMY_TYPES_IN_ORDER`と`ENEMY_DEFINITIONS`から行うよう変更し、
  hp/attackのハードコードを排除した。PRNGの消費順・回数は変更していない
  （配置座標の決定性は維持）。

## 敵AIディスパッチ（`turn.ts`）

- `resolveOneEnemy`を、敵の`type`直接比較から`ENEMY_DEFINITIONS[type].
  behaviorType`によるswitchへ変更した。
  - `spider_cardinal` → 既存のスパイダー専用4方向AI（変更なし）
  - `generic_melee` / `placeholder` → 既存のボク8方向AI（cockatrice,
    bat, mummyはplaceholderとしてこの経路を暫定使用。golem, sword, axe
    は最初からgeneric_melee指定）
  - `stationary` → 何も行わない（kraken。移動もしないし攻撃もしない）

## 描画（`main.ts`）

- スパイダー専用だったクロマキー透過生成処理（`createSpiderTexture`）を、
  任意のスプライトキーを受け取る`createChromaKeyTexture(spriteKey)`へ
  汎用化した。
- `preload`/`create`で、`player`と`bok_lv1`（既存の実alpha透過）を除く
  残り7種（cockatrice, spider, bat, mummy_lv1, claygolem, sword, axe,
  kraken）全てについて、raw画像読み込み→クロマキー透過生成→walk
  アニメーション生成、を共通ループで行うようにした。
- 実行時の色抜き処理は既存のクロマキー方式（完全一致のみ、閾値なし）を
  そのまま踏襲し、新しい方式は追加していない。画像の縦横比・足元基準・
  表示サイズは既存の`SPRITE_SCALE_X/Y`をそのまま利用し、敵種によって
  変えていない。全敵とも当たり判定は既存通り1マス。

### 実装中に発見・修正したバグ（Phaser 3.90.0との非互換）

`package.json`は`phaser: ^3.85.2`を指定しているが、`npm install`で解決
された実際のバージョンは3.90.0だった。このバージョンの
`TextureManager.addSpriteSheet(key, source, config)`は、`source`が既に
`Phaser.Textures.Texture`インスタンスの場合、渡した`key`引数を無視して
`source.key`（元のcanvas登録名）を使ってしまう仕様になっている。元の
スパイダー専用実装はこの経路（`addCanvas`で一時テクスチャを作った後に
`addSpriteSheet`へそのTextureを渡す）を使っていたため、この version で
実行すると「クロマキー生成後のテクスチャが期待したspriteKeyの下に
登録されない」というテクスチャ欠落バグが発生し、7種すべて
（bok_lv1・player以外）が描画できない状態になっていた。

修正として、`addCanvas`を経由せず、生成した`HTMLCanvasElement`を直接
`addSpriteSheet(spriteKey, canvas, config)`へ渡す方式に変更した（TypeScript
の型定義上はcanvasを受け付けないため`as unknown as HTMLImageElement`で
キャストしている）。この経路は`source`がTextureインスタンスでないため
`key`引数がそのまま使われ、目的のspriteKeyへ正しく登録される。

## テスト

- 敵数のハードコード値（2）が9へ変わったことに伴い、以下の既存テストを
  更新した: `enemy-type.test.ts`（bok/spiderのインデックス修正含む）、
  `multi-floor.test.ts`、`multi-floor-robustness.test.ts`、
  `placement.test.ts`、`state.test.ts`。ロジック自体の期待値（決定性、
  重複なし、床配置、階段解放条件など）は変更していない。
- 新規`enemy-roster-foundation.test.ts`を追加し、以下を検証している。
  - 9種全てが一意なidで登録されていること
  - 固定順で1体ずつ、共通定義通りのhp/attackで生成されること
  - 壁・プレイヤー・出口・他の敵と重複しない配置になること
  - krakenが隣接時も含め移動・攻撃を一切行わないこと（stationary）
  - cockatrice/bat/mummy（placeholder）がボク流用AIで隣接時に攻撃すること
  - golem/sword/axe（generic_melee）が同様に攻撃すること
  - 同一seedでの決定性
- `npx tsc --noEmit`：エラーなし。
- `npx vitest run`：22ファイル / 125件全て成功。
- `npx vite build`：成功（既存の500KB超チャンク警告のみ、内容は無関係）。

## 画面確認

- `vite preview` + Playwright(Chromium, headless)でビルド済み成果物を
  読み込み、コンソールに"Texture not found"等の警告・pageerrorが出ない
  ことを確認した。
- ランダム移動およびデバッグ用一時キー（確認後に削除済み、コミット物には
  含まれない）でプレイヤーを各敵に隣接させたスクリーンショットを取得し、
  スクリーンショット全体をピクセル走査した結果、クロマキー色
  RGB(0,255,0)の残存ピクセルは0件、かつ各キャプチャで背景と異なる
  色（各敵固有の配色）が検出された。これにより、7種のクロマキー透過が
  実際に機能していること、各敵が意図した見た目で描画されていることを
  確認した。

## 密度補正（enemy-roster-density-correction、本タスク後に追記）

上記の「毎フロア全9種を1体ずつ生成」という初回実装は、「全種類を見せる
ためだけに通常フロアの敵密度を増やさない」という指示に反していたため、
以下の通り補正した。

- `ENEMY_COUNT_PER_FLOOR`を9から基盤実装前の値である2へ戻した。
- 通常生成の各敵スロットは、`ENEMY_TYPES_IN_ORDER`（9種）から独立した
  シード付きPRNG（`floorSeed ^ 0x8f3c9d21`、配置座標用RNGとは別ストリーム）
  で毎回1種を抽選する方式へ変更した（スロット間の重複は許容）。これにより
  通常プレイの敵数は2体のまま、全9種が通常生成の候補になる。
- `choosePlacement`は敵数を固定定数直参照ではなく引数`count`
  （デフォルト`ENEMY_COUNT_PER_FLOOR`）として受け取るよう変更し、配置ロジック
  自体は変更していない。
- 全9種類を同時に確認する手段として、`state.ts`に**テスト/開発専用**の
  `buildRosterPreviewFloorState(runSeed)`を追加した。通常生成と同じ
  `buildFloorState`経路を敵数9・種類固定順という引数だけ変えて再利用して
  おり、`main.ts`や本番ビルドからは一切参照されない。一時的なキー操作や
  デバッグログは実装確認後にすべて削除済みで、コミット物には含まれない。
- 全9種を実際に確認する方法：`npx vitest run`で
  `enemy-roster-foundation.test.ts`内の`buildRosterPreviewFloorState`を
  使うテスト群（配置・重複なし・決定性・kraken据え置き・placeholder/
  generic_melee攻撃）を実行することで確認できる。ブラウザでの目視確認が
  必要な場合も、このビルダーをテストコードから一時的に呼び出すことで
  本番コードに触れずに9種同時表示を再現できる。
- `enemy-type.test.ts`は、敵種が乱数抽選になったことに伴い、
  「index 0=bok固定」等の前提を廃止し、各テストで必要な種類を
  `enemy.type = 'bok'`のように明示的に上書きしてから挙動を検証する
  方式へ変更した。また「500 seed以内に全9種が少なくとも1回は通常生成
  される」ことを検証するテストを追加した。

## 残課題

- 敵ごとの完成版固有AI（コカトリス・スパイダー・コウモリ・マミー）の
  実装は別タスク。
- ボク・ゴーレム・ソード・アックスの速度・攻撃差の暫定調整（次タスク予定）。
- 敵種ごとの出現密度・重み付け（今回は均等抽選のみ）、地形別配置条件の
  設計は未着手。
