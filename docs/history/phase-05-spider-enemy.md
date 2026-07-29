# Phase 05: Spider Enemy

## 目的と対象範囲

Phase 04で確立した複数敵基盤（各階固定2体、死亡敵を配列から削除しない、
決定的配置）へ、最初の新敵種として「スパイダー」を追加した。各階の構成を
「ボク1体＋スパイダー1体」に固定し、スパイダーは上下左右4方向だけで
追跡・近接攻撃する。ボクの能力・自然回復・マップ生成・階段開放条件・
32×32表示は変更していない。コカトリス・コウモリ・マミー・ゴーレム・
ソード・アックス・クラーケンの実装、敵総数の変更、遠距離攻撃・状態異常・
経験値・アイテムの追加には着手していない。

## 提供素材8点の収録

利用者から提供された以下8点を、元PNGのまま`public/assets/sprites/`へ
収録した(リサイズ・クロップ・alpha書き換え・背景色書き換え・
sprite sheet配置変更なし。全点byte単位で提供元ファイルと一致することを
`cmp`で確認済み)。

| 敵名 | ファイル名 | Phase 05での使用 |
|---|---|---|
| コカトリス | `cockatrice.png` | 未使用(将来用に収録のみ) |
| スパイダー | `spider.png` | 使用(今回実装) |
| コウモリ | `bat.png` | 未使用(将来用に収録のみ) |
| マミー | `mummy_lv1.png` | 未使用(将来用に収録のみ) |
| ゴーレム | `claygolem.png` | 未使用(将来用に収録のみ) |
| ソード | `sword.png` | 未使用(将来用に収録のみ) |
| アックス | `axe.png` | 未使用(将来用に収録のみ) |
| クラーケン | `kraken.png` | 未使用(将来用に収録のみ) |

全8点は72×128px、24×32/frameの3列×4行(上/右/下/左)で、既存の
bok_lv1・playerと同一構成。背景は完全なRGB(0,255,0)のクロマキーで、
alphaは全pixel 255(不透明)。

## EnemyType / EnemyActor構造

- `types.ts`に`EnemyType = 'bok' | 'spider'`と、`Actor`を継承した
  `EnemyActor { type: EnemyType }`を追加した。
- `GameState.enemies`の型を`Actor[]`から`EnemyActor[]`へ変更した。
- 大規模なclass階層・ECS・behavior tree・JSONデータ駆動化は行っていない。

## ボクとスパイダーの生成規則

- `state.ts`の`buildFloorState`で、`placement.enemies`(座標2点、既存の
  決定的抽選のまま変更なし)を固定順序`['bok', 'spider']`へ対応づけ、
  `createInitialEnemy(type, pos, 2, 1)`で生成する。
- 種別割当は配列indexによる固定対応のみで、新たなPRNG呼び出しを
  一切追加していない。そのため配置座標のRNG消費列・マップ生成の
  決定性には影響しない。
- index 0が常にボク、index 1が常にスパイダー。次階生成・restart(Enter/N)
  でも同じ規則を使う。

## スパイダーの移動・攻撃規則

`turn.ts`に`resolveSpiderEnemy`を追加し、`resolveOneEnemy`で
`enemy.type`に応じて`resolveBokEnemy`(Phase 04までの8方向AIをそのまま
分離しただけ)と分岐させた。

- 攻撃判定は新設した`isOrthogonallyAdjacent`(上下左右の1マスのみ)を使用。
  斜め隣接時は攻撃しない。
- 攻撃しない場合、上下左右4方向(`N, S, E, W`の固定順序)のうち、
  壁を越えず・他の生存actorと重ならず・playerのマスへ移動しない候補から、
  移動後のplayerとのManhattan距離が最小になるものを選ぶ。
- 同distanceの候補が複数ある場合は、常に`N, S, E, W`の順で先に見つかった
  ものを採用する(乱数tie breakなし)。
- 合法な候補が1つも無い場合は待機する。
- ボクの`resolveBokEnemy`は8方向`isAdjacent`・既存chase候補生成
  (`pickChaseDirections`)ともに無変更。

## renderingでのtexture・animation切替

- `main.ts`の`preload()`でスパイダーの元画像を`spider_raw`として
  (spritesheetではなく)通常imageで読み込む。
- `create()`で`createSpiderTexture()`を呼び、以下の手順でruntime
  透明化textureを生成する。
  1. `spider_raw`のソース画像をoffscreen canvas(72×128、元寸法のまま)へ
     `drawImage`する。
  2. `getImageData`でRGBが厳密に`(0,255,0)`と一致するpixelだけ
     alphaを0にする(近似色判定・threshold・他pixelの補正は行っていない)。
  3. `putImageData`後、`textures.addCanvas`でcanvasを一旦textureとして
     登録し、それを source として`textures.addSpriteSheet('spider', ...)`
     で24×32・3列×4行のspritesheet textureとして再登録する。
  4. `setFilter(NEAREST)`でpixel-art用filteringを明示的に維持する。
  5. `textures.exists('spider')`で存在チェックしてから生成するため、
     restart・フロア移動のたびに`create()`が呼ばれても重複登録しない
     (Scene初期化時に1回だけ実行される)。
- 元PNG(`spider.png`)自体は一切書き換えていない。shaderやcustom WebGL
  pipelineは使用していない。
- `rebuildEnemySprites`は`enemy.type`に応じ`bok_lv1`または`spider`
  textureでspriteを生成するよう変更した。移動アニメーション・待機時の
  frame切替(`snapActor`/`animateMove`)も、呼び出し側でenemy種別から
  texture keyを解決して渡すよう統一した。
- 既存の32×32表示(`SPRITE_SCALE_X/Y`)・非均等scale・位置補正・
  frame slicing(`SPRITE_FRAME_WIDTH/HEIGHT`)は無変更。

## 変更ファイル

- `src/game/types.ts`
- `src/game/state.ts`
- `src/game/turn.ts`
- `src/game/direction.ts`(`isOrthogonallyAdjacent`追加)
- `src/main.ts`
- `src/game/__tests__/turn.test.ts`(既存fixtureをbok種別へ対応)
- `src/game/__tests__/enemy-type.test.ts`(新規)
- `public/assets/sprites/`配下へ8点追加

## 追加・更新テスト

`enemy-type.test.ts`を新規追加し、以下を検証した。

- bok+spider固定構成(index 0/1)がrun seed 100件で常に成立すること
- 同一run seedでの種別・配置の再現性、次階でも構成が変わらないこと
- 種別割当がmap生成のPRNGへ影響しないこと(map/placementが完全一致)
- ボクの8方向攻撃・既存HP/attack値の回帰
- スパイダーの斜め移動禁止・直交隣接時のみ攻撃・斜め隣接時の非攻撃と
  移動継続・壁越え禁止・actor重複禁止・playerマスへの非侵入・
  合法候補なし時の待機・距離同値時の固定順tie break・同一状態と
  入力列に対する決定性
- 両種を独立して攻撃・撃破できること、両方倒すまで階段が開放されない
  こと

既存`turn.test.ts`のenemy生成fixtureは`createInitialEnemy('bok', ...)`
へ更新し、Phase 04までの8方向AIテストが引き続き有効であることを
確認した。

## 全テスト結果

型チェック(`tsc -b --noEmit`)成功。`vitest run`で21ファイル118件
全pass(既存101件+新規17件)。`npm run build`(vite build)成功。
`git diff --check`はwhitespaceエラーなし。

## 300フロア堅牢性検証

run seed 1〜100 × 3フロア = 300フロアに対し、以下を集計した(結果は
全て0件、全項目合格)。

- 生成成功: 300 / 生成失敗: 0
- 敵種構成違反(bok=index0, spider=index1以外): 0
- actor重複: 0
- 決定性違反(同一run seed/floorでfloor seed不一致): 0

Seed 2780624551は既存`multi-floor.test.ts`が全pass経路で継続使用して
おり、マップ形状・3フロア進行の回帰も維持できていることを確認した。
検証に使用した一時集計スクリプトはrepositoryへ残していない。

## browser確認

このサンドボックス環境のネットワーク許可ドメインにChromiumの依存パッケージ
取得先が含まれておらず、Playwrightのブラウザインストールが失敗するため、
Phase 04と同様にheadless browserでの実表示確認は実施できなかった。
自動テストによる内部ロジック(移動規則・攻撃規則・texture切替の呼び出し
経路・決定性)の検証は完了しているが、実際のcanvas描画・クロマキー
透明化の見た目・animationの実ブラウザ確認は未実施。

## 未確認事項(ユーザー確認が必要)

- 実ブラウザでスパイダーの黄緑背景が完全に透明表示されること
- スパイダー本体の色に欠損がないこと
- 24×32のframe slicingと4方向animationが実際に正しく見えること
- ボク・スパイダーそれぞれのsprite足元位置に目視ずれがないこと
- Enter/N反復操作でspriteやtextureが増殖しないこと(コード上は
  `textures.exists`チェックと`rebuildEnemySprites`の破棄処理で
  担保しているが、実対話プレイでの確認は未実施)
- 実際の対話的3フロア通しプレイでの操作感
