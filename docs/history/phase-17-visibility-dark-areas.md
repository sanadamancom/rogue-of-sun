# Phase 17.0: 視界アーキテクチャ監査とFOV比較試作

作成日: 2026-08-07
対象: `phase-17-visibility-dark-areas`ブランチ（`main` HEAD `1886e3cff30ee2c4e8dc9e9248afdeeeddc786b3`から分岐）

## 1. Phase 16の正式終了とPhase 17開始HEAD

Phase 16.2版の実ブラウザ試遊結果（3階まで容易にクリア、自然回復1HP/ターンにより序盤ではほぼ全回復維持、後半階層・強敵未実装のため難易度評価は今回できない）を受け、Phase 16.2の仕様を現行baselineとして正式採用した（詳細は本ファイル20章）。

- `phase-16-early-game-balance`ブランチのcloseout commit：`docs: accept phase 16 balance baseline`
- `main`へfast-forward統合（merge commitなし、force pushなし）し、origin/mainへpush済み
- Phase 17開始HEAD（`main`）：`1886e3cff30ee2c4e8dc9e9248afdeeeddc786b3`

## 2. 現行構造の監査

### 2.1 マップ表現

- `GameMap.terrain[y][x]`：`'floor' | 'wall'`の2値のみ。部屋・通路の区別を示す専用フィールドはterrain自体にはない
- `GameMap.rooms: Room[]`（`{x, y, width, height}`の矩形リスト）が部屋の唯一の構造化情報。通路・戸口はterrain上の「どの部屋の矩形にも属さない床」として暗黙に定義される
- `roomIndexContaining(rooms, pos)`（`mapgen.ts`）：座標が属する部屋のインデックス（属さなければ-1）を返す既存関数。通路/戸口タイルの判定にも使われている（-1になることを利用）
- `getRoomCorridorEntrances(map, room)`（`mapgen.ts`、Phase 16.2で新設）：部屋境界の1マス外側リングにある床タイル（＝通路入口）を返す。100 seedで検証済みの`doorway-rule.test.ts`と同じ境界スキャン方式を使っており、各戸口が幅1マスの独立したタイルであることが保証されている
- マップ生成後にterrain種別（床/壁）と部屋所属は判定可能。通路そのものを構造化データとして保持する仕組みはなく、常に「terrain走査+rooms」から都度導出する設計

### 2.2 現行の可視性（重要な発見）

**現在、production描画には「未探索を隠す」仕組みが一切ない。**

- `main.ts`の`drawTerrain()`は、フロア全体のterrain（床・壁・日向オーバーレイ）を、`exploredTiles`や視界の状態に関わらず**常に全マス描画**している（`for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) { ... }`という単純な全走査）
- 敵スプライト（`rebuildEnemySprites`/`snapAllEnemies`）・床アイテム（`drawGroundItems`）も同様に、探索状態に関わらず常に実座標へ描画されている。画面上で見えないのは、Phaserのカメラ（`computeCameraWindow`で計算される9×7マスの矩形ビューポート）がその範囲だけを画面に映しているためであり、原理的にズームアウトすればフロア全体・全敵・全アイテムがその瞬間から見えてしまう構造
- `exploredTiles`（`main.ts`、GameStateの外側で管理される描画専用のper-floor配列）は、**ミニマップ（`drawMinimap()`）専用**に使われている。半透明の常時表示ミニマップに「これまでカメラウィンドウが通過したタイル」を薄く表示する目的のみで、メインのゲーム画面（`drawTerrain`等）には一切影響しない
- `markCameraWindowExplored()`は、現在のカメラウィンドウ内の全マスを`exploredTiles`へ立て、Phase 16.2で追加した通路入口1マスも同様にこの配列へ加える。呼び出しタイミングは`resetSceneToCurrentState()`（フロア移動・再開時）と`refreshStaticView()`（毎ターンの通常更新）
- 新規ラン・フロア移動・死亡・再開時は`resetExploredTiles()`でその階のサイズに合わせて全マスfalseへ初期化される

つまり、現在の「視界」はゲームプレイ上のFOV（Field of View、遮蔽・視認可否）ではなく、単なる「カメラが画面に映している範囲」でしかない。Phase 17で`unexplored`/`explored_not_visible`/`currently_visible`の3状態を導入するには、**メインのゲーム画面描画（`drawTerrain`・敵/アイテムスプライトの表示）に、初めて「見えているかどうか」の概念を接続する必要がある**。これは今回のPhase 17.0の対象外（`non_objective`）だが、監査結果として明記する。

### 2.3 描画

- 未探索マスの現行表示：存在しない（メイン画面は常時全マス描画。ミニマップだけが`exploredTiles`に基づく薄い表示/非表示を持つ）
- explored判定はterrain・アイテム・敵・出口のいずれの描画にも影響しない（ミニマップを除く）
- 敵や床アイテムが「過去に見た位置の残像」として表示される可能性：現状は残像ではなく**常に最新の実座標**が表示される（探索状態に関係なく毎フレーム実位置へ描画されるため）。Phase 17で視界を導入する際、「視界外の敵をどう扱うか」（非表示にする／最後に見た位置に残す／何もしない）を新たに設計する必要がある
- HUD・ログは現在の視界概念と無関係（LIFE、SOL、満腹度、階層等の数値表示のみ）

### 2.4 環境（日向・日陰、暗闇）

- `GameState.sunlight: boolean[][]`（`sunlight.ts`で生成、floorSeedから独立したRNG streamを使用）が日向/日陰を表す。GameStateの一部であり、seed決定性・RNG消費に関与する
- `isSunlitAt(sunlight, pos)`で読み取り、太陽銃のチャージ判定（`solar_charge`アクション）に使われる
- 「暗闇状態」「暗い区画」に相当する仕組みは、コード上どこにも存在しない（`darkness`・`blind`等のキーワードで検索して該当なし）。Phase 17で新規に定義する完全に新しい概念であり、既存の日向・日陰とは無関係な別レイヤーとして設計してよいことを確認した
- 日向・日陰と視界は現状すでに完全に分離されている（`sunlight`はGameStateの一部、`exploredTiles`はmain.ts側の描画専用データで、互いに参照し合っていない）

### 2.5 ゲームルール

- 敵AIの索敵条件（Phase 16.1で追加した`AGGRO_RANGE`/`isWithinAggroRange`、`turn.ts`）は、プレイヤーとの単純なChebyshev距離のみで判定しており、`exploredTiles`・カメラウィンドウ・地形の遮蔽情報を一切参照しない。視界システムと完全に独立しているため、Phase 17で視界を追加しても敵AIの挙動は変更されない（`isWithinAggroRange`はrenderingコードを一切importしていないことをコードレビューで確認）
- ターン進行・RNG消費・telemetryも、現行の`exploredTiles`/カメラウィンドウ計算とは独立している（`computeCameraWindow`・`markCameraWindowExplored`はいずれも純粋関数またはGameStateを読むだけで書き換えない副作用限定の関数であり、`processTurn`のRNG消費順やGameStateの変更に一切関与しない）

### 2.6 責務一覧（現行）

| 責務 | 現行の所在 | 備考 |
|---|---|---|
| 地形（床/壁）の保持 | `GameState.map.terrain` | seedで決定論的に生成、production全体で共有 |
| 部屋の矩形情報 | `GameState.map.rooms` | trap配置・通路入口検出などに使用 |
| 日向/日陰 | `GameState.sunlight` | GameStateの一部、SOLチャージに使用 |
| カメラの表示範囲 | `computeCameraWindow`（`camera.ts`） | 純粋関数、GameState非依存 |
| 「これまで画面に映った」記憶 | `main.ts`の`exploredTiles` | ミニマップ専用、GameState外 |
| 通路入口1マスの記憶追加 | `main.ts`の`markCameraWindowExplored` | Phase 16.2、`exploredTiles`へ加算するだけ |
| 敵の索敵判定 | `turn.ts`の`isWithinAggroRange` | 単純距離、視界と無関係 |
| メイン画面の地形/敵/アイテム描画 | `main.ts`の`drawTerrain`等 | **探索・視界状態を一切参照しない** |

### 2.7 Phase 17で追加する責務（案）

| 責務 | 想定される所在 |
|---|---|
| 現在可視座標集合の計算（FOV） | 新規の純粋関数（`src/game/`配下、まだ未作成） |
| 探索済み記憶（フロア単位） | 既存`exploredTiles`を流用するか、GameState外の新データとして再設計 |
| unexplored/explored_not_visible/currently_visibleの描画反映 | `main.ts`の`drawTerrain`等への新規接続（production未接続、Phase 17.0の対象外） |
| 暗い区画の状態 | 新規、環境状態として日向/日陰とは別に保持 |

### 2.8 今回変更してはいけない箇所（確認済み・変更なし）

- `GameMap`・`Room`の型定義、マップ生成アルゴリズム全体
- `computeCameraWindow`・`isWithinCameraWindow`（純粋関数、無変更）
- `AGGRO_RANGE`・`isWithinAggroRange`・敵AI全体
- `sunlight.ts`・SOLチャージ判定
- `exploredTiles`・`markCameraWindowExplored`・`drawTerrain`等、production側の`main.ts`（Phase 17.0では一切変更していない）
- seed決定性・RNG消費順・ターン定義（今回のPhase 17.0はproductionコードに一切触れていないため、影響なし）

## 3. 外部調査について（正直な制約の申告）

このタスク実行環境にはWeb検索・外部URLへのアクセス手段がなく、指定された`ray casting`・`recursive shadowcasting`・`symmetric shadowcasting`・`permissive FOV`について実際の資料URLを閲覧して記録することができなかった。以下は学習済みの一般知識に基づく要約であり、特定の資料・URLの引用ではないことを明記する。

- **ray casting**：原点から各候補マスへ1本の直線（整数格子上ではBresenhamのような線分アルゴリズム）を引き、線上に壁があれば遮蔽とみなす方式。実装が単純な一方、線の引き方（どちらの端点から辿るか）によって結果が非対称になりやすく、角付近で本来見えるはずのマスが1本の線の丸め方次第で漏れる／欠けることが知られている
- **recursive shadowcasting**：原点を中心に8つのオクタント（対称な8分割領域）へ分割し、各オクタントを内側から外側へ行ごとに走査しながら、壁に当たるたびに残りの角度区間を再帰的に分割していく方式。角度区間ベースで判定するため、単純なray castingより対称性が高く、角の見え方が安定しやすいとされる。一方で実装がray castingより複雑で、角度区間の境界処理を誤ると簡単に破綻する
- **symmetric shadowcasting**：recursive shadowcastingの一種で、「AからBが見えるならBからAも見える」という対称性を厳密に保証するよう境界条件を調整した設計。非対称性が問題になりやすい対戦・観測ゲームで好まれる
- **permissive FOV**：遮蔽判定を緩めに取り、視線が壁の角をわずかにかすめる程度なら見えると判定する方式群の総称。プレイヤー体験として「壁際が不自然に見えにくい」問題を緩和する目的で使われることが多い

これらの一般的な特徴の説明にとどめ、特定ライブラリの実装（rot.js等）のコード・API・命名・データ構造は一切参照・流用していない。

## 4. 比較試作

`tools/phase17-visibility/`配下に、productionコードから完全に独立した比較試作を作成した（`src/main.ts`・`src/game/*.ts`のいずれからも参照されず、`npx vite build`のproduction成果物にも含まれない）。

### 4.1 実装した候補

- **候補A: ray casting**（`raycast.ts`）：各候補マスへBresenham線を引き、線上（両端点を除く）に壁があれば不可視とする、素朴な実装
- **候補B: 角抜け禁止ルール準拠のフラッドフィル**（`floodfill.ts`）：`permissive FOV`系統に分類される、原点から幅優先探索で床を伝って広がる方式。本作の既存移動ルール（`turn.ts`の対角移動時「両方の角マスが壁なら禁止」というルール）をそのまま視界の可否判定に転用した

**候補Bについての正直な経緯**：当初はrecursive shadowcasting（角度区間の再帰分割）を実装したが、単純な単一壁マスのfixtureで手動検証したところ、壁から離れた無関係な領域まで広範囲に誤って遮蔽される明白なバグを発見した（`tools/phase17-visibility/floodfill.ts`冒頭のコメント参照）。未検証のまま比較の基準として採用するのは不適切と判断し、正しさを目視で確認しやすい「本作の既存corner-cutルールを流用したフラッドフィル」へ差し替えた。recursive/symmetric shadowcastingそのものは、今回のコード比較には含まれていない（3章の一般知識としての記述のみ）。

### 4.2 fixtureごとの比較結果（半径4、Chebyshev距離）

| fixture | ray casting | floodfill | 所見 |
|---|---|---|---|
| straight_corridor | 15マス | 27マス | floodfillの方が壁面自体も含めて多く可視（後述） |
| l_corner | 13マス | 24マス | 詳細は4.3 |
| doorway_from_room | 42マス | 46マス | 部屋内なので大半は`room-rules.ts`の別ルールが担当、この数値は半径ベースのFOV部分のみの参考値 |
| doorway_from_corridor | 9マス | 7マス | 通路側からの視認範囲 |
| multiple_exits_room | 81マス | 81マス | 開けた部屋では両者一致 |
| diagonal_double_wall | 13マス | 5マス | 4.4参照 |
| map_edge | 14マス | 12マス | マップ外参照は両者とも発生せず安定 |
| dark_room | 56マス | 54マス | 開けた部屋では近い値 |

### 4.3 L字角での漏れ（重要な発見）

半径5で`l_corner` fixtureを検証したところ、原点（垂直通路内）から水平方向の通路の奥（角を曲がった先、x=6,y=1）まで**ray casting・floodfillの両方**が可視と判定した。角を曲がった直後の交差点だけでなく、水平通路のかなり奥まで見えてしまう。

これは、両候補とも「原点からの距離（半径）」と「直線上/経路上の壁の有無」だけで判定しており、**角を曲がった時点で視線の角度が変わるという概念（角度区間による遮蔽）を持たない**ため。recursive/symmetric shadowcasting系統が本来解決する典型的な弱点そのものであり、今回のコード比較でも実際に再現・確認できた（半径4のテストスイートでは半径が届かず表面化しないため、`comparison.test.ts`にはこの半径5での参考測定は含めていない）。

### 4.4 対角の角抜けルールとの一致性

`diagonal_double_wall` fixtureで、原点から見て両側の角マスが両方とも壁になっている床マス（本作の移動ルールなら対角移動できないマス）について、floodfillは明示的にこのルールを再利用しているため正しく不可視と判定した。一方ray castingは、隣接1マスの対角移動には線分上に中間点が存在しないため、このルールを自然には強制せず、素朴な実装のままでは可視と判定してしまうことを確認した（`comparison.test.ts`で候補ごとに切り分けて記録）。

### 4.5 部屋・通路入口・暗い区画のルール（`room-rules.ts`）

- 通常部屋：部屋矩形内の全床＋`getRoomCorridorEntrances`と同じ境界スキャン方式で検出した各通路入口1マスを可視とする（Phase 16.2の意図をそのまま再現）。`multiple_exits_room` fixtureで3つの正規出口すべてが検出され、二重カウント・取りこぼしがないことを確認した
- 暗い区画：`dark_room` fixture（11×5の大部屋）で、通常ルールなら55マス全部可視になるところ、半径2オーバーライドなら25マス、半径3オーバーライドなら47マスに制限されることを確認した。半径2・3のどちらも通常の部屋全体表示より明確に少なく、暗い区画としての制限機能自体は両半径案とも成立することを確認した

## 5. 推奨方式

- **通路のFOV計算**：production実装ではrecursive/symmetric shadowcasting系統を推奨する。理由は4.3で示したとおり、ray casting・floodfillの両方に共通する「角を曲がった先が見えすぎる」という弱点を、角度区間ベースの遮蔽判定でしか解決できないため。ただし、今回の実装試行で明白なバグを出した実績があるため、production実装時は入念な単体テスト（このPhase 17.0で用意した8 fixtureをそのまま初期テストケースとして転用可能）を伴う慎重な実装が必要
- **通路の半径**：今回は半径4で比較したが、具体的な採用半径はPhase 17.1側の指示で決定する（本Phase 17.0では半径そのものの正式採用は対象外）
- **距離の測り方**：Chebyshev距離（8方向移動と一致、`AGGRO_RANGE`や`chebyshevDistance`ですでに使われている値と一貫性を保てる）を推奨
- **通常部屋**：Phase 16.2の「部屋全体＋通路入口1マス」ルールをそのまま維持することを推奨する。今回の`room-rules.ts`での再現・検証で、複数出口・境界検出のいずれも安定して動作することを確認した
- **暗い区画**：半径2・3のどちらも「通常部屋より狭い」という要件自体は満たす。具体的にどちらを採用するかはfixtureレベルの検証だけでは決められず、実際のマップでの見た目・プレイ感覚に依存するため、Phase 17.1側でユーザー確認のうえ決定することを推奨する
- **視界外の敵・アイテム・出口の記憶規則**：今回のコード比較の対象外（`exploration_memory`は本Phase 17.0のfixture比較に含めていない、純粋にFOV計算のみを比較した）。監査で判明したとおり、現状は「視界外の敵を隠す」という概念自体がゲームに存在しないため、Phase 17.1でゼロから設計が必要になる。候補として以下を報告するに留める：
  - 視界外の敵：非表示にする案（多くのローグライクの標準）と、最後に見た位置に残像として残す案がある。本作は「敵の位置を偽って見せない」という誠実さを重視する既存の設計思想（例えばcamera windowの全表示という現状自体がその現れ）と、対応する好みに依存するため、Phase 17.1でユーザーの意向を確認して決定すべき
  - 視界外の床アイテム：同上。ただしアイテムは動かないため、残像表示のリスク（誤情報）は敵よりも小さい
  - 出口・罠・鍵等：既存の`exploredTiles`の記憶モデル（一度見た地形は暗く表示され続ける）をそのまま流用するのが最も既存仕様との整合性が高いと考えられる

## 6. production実装時に必要な変更箇所（見込み、今回は着手しない）

- `main.ts`の`drawTerrain`・敵/アイテムスプライトの可視/非可視制御への新規接続
- `exploredTiles`の役割整理（ミニマップ専用のままにするか、メイン画面のfog-of-warと統合するか）
- 新規FOV計算関数の`src/game/`への追加（純粋関数、GameState非依存が望ましい）
- 暗い区画の環境状態を保持する新規GameStateフィールド（マップ生成方式の変更は別途、今回は対象外）

## 7. 未確定事項

- 通路の視界半径の具体的な値
- 暗い区画の半径（2 or 3）
- 視界外の敵・アイテムの記憶規則
- 暗い区画の生成方法・出現率（本Phase 17.0では意図的に決定していない）
- production統合時のexploredTilesとの統合方式

## 8. 実行したテスト

- `tools/phase17-visibility/comparison.test.ts`（新規25件）：決定性、マップ外参照なし、入力不変、原点は常に可視、対角角抜け禁止との一致（floodfill）、直線通路・マップ端・複数出口部屋・暗い区画半径比較、候補間の差異が最低1件存在することの確認
- Phase 17.0はproductionコードを一切変更していないため、`npx vitest run`（production全体）は実行していない（`tests.policy`の指示どおり、視界・マップ・描画に直接関係する既存テストの再確認はPhase 16のバトンタッチ時点ですでに全件成功していることをprecheckで確認済み）
- `npx tsc -b --noEmit`：`tools/`配下も含めてリポジトリ全体でエラーなし

## 9. Phase 17.1: production視界・探索記憶の実装

作成日: 2026-08-08
対象: `phase-17-visibility-dark-areas`ブランチ、Phase 17.0開始HEAD `63c93d664b2e24df66f7453a25cd60955dd63079`から1commit追加

### 9.1 Phase 17.0推奨方式の未検証だった点

Phase 17.0はrecursive/symmetric shadowcasting系統を推奨したが、実際の試作（recursive shadowcastingの初期実装）は単一壁マスのfixtureで明白なバグ（壁から離れた無関係な領域まで広範囲に誤って遮蔽）が出たため未検証のまま終わっていた。Phase 17.1では、まずこの方式を`src/game/visibility.ts`として一から実装し、Phase 17.0の8 fixtureすべてに対する期待座標をテストで明示したうえでimplementation gateの全項目に合格したことを確認してからproduction接続へ進んだ。

### 9.2 採用した実装方針

`src/game/visibility.ts`（新規、pure関数のみ、GameState/Canvas/DOM非依存、RNG不使用）：

1. **symmetric shadowcasting**（`shadowcastVisibleTiles`）：原点を中心とした東西南北4象限それぞれを、原点からの距離（row）ごとに走査するアルゴリズム。各tileの境界を厳密な整数分数（分子・分母のペア）で比較することで浮動小数点誤差を排除し、「AからBが見えるならBからAも見える」という対称性を保証した。壁と床の境界を検出するたびに、そこから先の走査区間（slope interval）を再帰的に絞り込むことで、L字角を曲がった先の通路奥へ視界が漏れる問題（Phase 17.0でray casting・floodfillの両方に見られた弱点）を解消した。8オクタントではなく4象限方式を採用（Albert Ford氏らが公開している一般的なアルゴリズム設計思想を参考にしたが、コードは本実装向けに独自に一から記述しており、外部ライブラリ・既存実装のコピーや翻案は一切行っていない）。
2. **既存の角抜け禁止規則との一致**（`legallyReachableTiles`、`computeCorridorVisibility`）：shadowcastingだけでは、本作固有の「斜め移動時、両側の直交マスが両方とも壁なら移動不可」という規則（`map.ts`の`isDiagonalCornerOpen`、既存の移動・近接攻撃判定と共用）を自然には強制しないため、原点からの合法な単位移動列（同じ角抜け禁止規則を適用）で到達可能なマス集合を別途BFSで計算し、shadowcasting結果との積集合を最終的な可視集合とした。これにより、視界と移動の角抜け規則が常に矛盾しないことを保証している。
3. **通常部屋の可視性**（`roomVisibleTiles`）：部屋矩形の内部全床に加え、4辺（対角の角マスは除く）の一マス外側リング（壁・通路入口の両方を含む）を可視とする。対角の角マスを除外しているのは、Phase 16.2の`getRoomCorridorEntrances`が直線4辺のみを走査する設計と一致させ、対角にたまたま床があった場合に無関係な通路まで見せてしまうことを防ぐため。
4. **トップレベル**（`computeCurrentVisibility`）：プレイヤーが部屋矩形内にいれば`roomVisibleTiles`、それ以外（通路）ならデフォルト半径4（`CORRIDOR_VISIBILITY_RADIUS`）の`computeCorridorVisibility`を使う。半径は引数化されており、Phase 17.2の暗い区画（半径2/3）にそのまま流用できる。

### 9.3 implementation gate各項目の結果

`src/game/__tests__/visibility.test.ts`（新規27件）ですべて確認・合格：

| 条件 | 結果 |
|---|---|
| 原点を必ず可視に含める | 合格（origin自体が範囲外の異常系を除き常に含む。範囲外originは例外を投げず空集合寄りの結果を返すことも別途確認） |
| 入力マップを変更しない | 合格（JSON比較で不変を確認） |
| RNGを参照・消費しない | 合格（visibility.tsはrng()を一切呼ばない） |
| マップ外座標を返さない | 合格 |
| 同じ入力から常に同じ結果 | 合格（決定性テスト） |
| 原点中心の対称性 | 合格（水平・垂直反転、90度回転相当の対称性テスト） |
| 遮光壁自体は手前側から見える | 合格（straight_corridorで壁面タイルが可視集合に含まれることを確認） |
| 遮光壁の直後は見えない | 合格 |
| L字角の奥へ深く漏れない | 合格（半径5でl_cornerの`(6,1)`・`(7,1)`が不可視であることを確認。Phase 17.0でray casting・floodfillの両方が漏らしていた同じ座標） |
| 斜めに接する2枚の壁の間を見通さない | 合格（diagonal_double_wallの`(2,2)`が不可視） |
| 角抜け禁止規則との非矛盾 | 合格（同じ`isDiagonalCornerOpen`を視界計算内で直接再利用しているため、定義上矛盾しない） |
| straight_corridorで半径4まで見える | 合格 |
| doorway_from_roomで正規入口1マスだけが見える | 合格（`(5,4)`は見えるが`(6,5)`・`(6,6)`は見えない） |
| 未接続の近接通路を含めない | 合格（対角の角マスを除外） |
| map_edgeで例外・範囲外参照なし | 合格 |
| 48x36マップでの現実的な計算量 | 合格（48x36相当マップで200回呼び出しが1秒未満） |

### 9.4 L字角・二重壁・片側壁の具体的な可視結果

- L字角（`l_corner`fixture、原点`(1,3)`、半径5）：曲がり角`(1,1)`とその手前の縦通路`(1,2)`は可視。曲がった先の横通路奥`(6,1)`・`(7,1)`は不可視（Phase 17.0でray casting・floodfillが漏らしていたのと同じ座標を、今回は正しく遮蔽できていることを確認）。
- 二重壁（`diagonal_double_wall`fixture、原点`(1,1)`）：斜め先`(2,2)`は、両側の直交マス`(2,1)`・`(1,2)`が両方とも壁であるため不可視。`isDiagonalCornerOpen`による到達可能性フィルタとshadowcastingの両方が独立にこの座標を排除している。
- 片側壁のケース：`legallyReachableTiles`のBFSは`isDiagonalCornerOpen`をそのまま呼んでいるため、片側だけが壁の場合は本作の既存移動規則と完全に同一の可視/不可視判定になる（既存規則自体が「両側とも壁の場合のみ禁止」なので、片側だけの壁は許可される）。

### 9.5 通常部屋と通路の最終視界規則

- 通常部屋：部屋の全床＋4辺（対角除く）の一マス外側リング（壁・入口とも）が常に可視。プレイヤーが部屋矩形の内部床に入った時点でこのルールへ切り替わる（`isInRoomBounds`によるroom bounds判定、Phase 16.2の`roomIndexContaining`と同じ矩形境界の考え方）。
- 通路：プレイヤー座標を原点とした`computeCorridorVisibility`（symmetric shadowcasting ∩ 角抜け禁止規則による到達可能性）、デフォルト半径4（Chebyshev距離）。

### 9.6 exploration memoryの所有者と初期化時期

- 所有者：`main.ts`の`GameScene`インスタンス（`exploredTiles: boolean[][]`）。Phase 16.2までと同じくGameStateの外側、scene-localなレンダリング専用データのまま（RNG・seed・telemetryに一切影響しない）。
- 更新：`updateVisibility()`が毎ターン`computeCurrentVisibility`を呼び、返ってきた現在可視マスをそのまま`exploredTiles`へ加算（削除は一切しない、単調増加）。
- 初期化：`resetExploredTiles()`を新規ゲーム開始（`create()`）・フロア移動（`resetSceneToCurrentState()`、`advanceToNextFloor`経由）・再スタート（`restart()`、同じく`resetSceneToCurrentState()`経由）のいずれでも、描画呼び出しより前に呼ぶよう順序を修正した（Phase 17.1接続前は地形描画が探索状態を参照していなかったため順序に依存しなかったが、接続後は描画前に必須になったため）。

### 9.7 地形・敵・床アイテム・出口の表示規則（実装結果）

- 地形（`drawTerrain`）：`exploredTiles`が立っていないマスは一切描画しない（`unexplored`）。立っているが`currentVisible`に含まれないマスは暗い単色（壁`0x161616`、床`0x0a0a0a`、日向オーバーレイなし）で描画（`explored_not_visible`）。`currentVisible`に含まれるマスは既存の通常色＋日向オーバーレイのまま（`currently_visible`）。
- 出口（`drawExit`）：`exploredTiles`が立っていなければ描画しない。立っていれば常に描画するが、`currentVisible`外なら透明度0.35で暗く記憶表示する。
- 敵（`snapActor`/`animateMove`に追加した`extraVisible`引数）：`currentVisible`に含まれる場合のみ表示。含まれない場合は移動アニメーションの開始・終了とも非表示のままにし、視界外の敵の動きや位置が一切画面に漏れないようにした。
- 床アイテム（`drawGroundItems`）：`currentVisible`のものだけを描画対象として抽出してからテキストオブジェクトを生成（探索済みだが視界外のアイテムは一切描画しない、残像なし）。
- 攻撃演出・ダメージ表示・テレグラフ（`drawTelegraphs`等）：既存のenemiesループがそのまま`enemy.alive`のみで判定していた箇所は変更していないが、対応する敵スプライト自体が`currentVisible`外では非表示になるため、結果として視界外の攻撃位置が画面上に描かれることはない。

### 9.8 ミニマップへの反映

`drawMinimap`の地形・出口表示は`exploredTiles`ベースのまま変更なし（一度発見した地形・出口は消えない、Phase 16.2からの意図を継続）。敵・床アイテムの表示条件を、旧来の9x7カメラウィンドウ（`isWithinCameraWindow`）から、メイン画面と同じ`this.currentVisible`（Phase 17.1のFOV）へ置き換えた。メイン画面とミニマップが同一の可視性データソースを参照するようになったため、両者の探索状態が食い違うことがなくなった。

### 9.9 production上の責務分離

- `src/game/visibility.ts`（visibility_module）：地形・原点・半径からの現在可視座標計算のみ。Canvas/DOM/GameStateへの依存なし、RNG不使用。
- `src/main.ts`の`exploredTiles`（exploration_owner）：フロア単位の探索済み座標の保持・蓄積のみ。描画処理そのものは持たない。
- `src/main.ts`の`drawTerrain`/`drawExit`/`drawGroundItems`/`drawMinimap`/`snapActor`/`animateMove`（renderer）：`visibility.ts`が返した可視性状態を受け取って表示を切り替えるのみ。独自の視界計算ロジックは一切実装していない。
- 敵AI（`turn.ts`の`isWithinAggroRange`等）：Phase 17.1では一切変更していない。索敵は既存どおりプレイヤーとの単純距離のみで判定し、視界システムを参照しない。

### 9.10 変更ファイル一覧

- 新規: `src/game/visibility.ts`
- 新規: `src/game/__tests__/visibility.test.ts`
- 変更: `src/main.ts`（`exploredTiles`/`currentVisible`の管理、`drawTerrain`/`drawExit`/`drawGroundItems`/`drawMinimap`/`snapActor`/`animateMove`/`snapAllEnemies`/`refreshStaticView`/`resetSceneToCurrentState`/`create`の描画順序と可視性接続、未使用になった`getRoomCorridorEntrances`・`computeCameraWindow`・`isWithinCameraWindow`のimport整理）
- 変更: `docs/history/phase-17-visibility-dark-areas.md`（本節）

### 9.11 テスト・tsc・build結果

- `npx vitest run`：78ファイル、1881件全成功（Phase 17.0の25件＋Phase 17.1の27件を含む。既存のバランス・マップ生成・敵AI・SOL・満腹度・回復・回帰系テストすべて含めて成功）
- `npx tsc -b --noEmit`：エラーなし
- `npx vite build`：成功（1,595.63 kB、gzip 375.97 kB。500kB超過の警告は既存のもので今回のPhase 17.1追加分による新規の警告ではない）

### 9.12 実ブラウザ確認

`scripts/build-single-html.mjs`による自己完結型HTMLプレビューを生成し、目視確認を実施予定（本commit後に別途生成、リポジトリへはcommitしない）。

### 9.13 Phase 17.2へ残した事項（変更なし、Phase 17.0からの継続）

- 暗い区画の生成・配置・出現率
- 暗い区画の視界半径2/3の正式決定（`computeCorridorVisibility`の半径引数はすでに対応済み）
- 松明・照明・暗視アイテム

## 10. Phase 17承認・main統合

作成日: 2026-08-08
Phase 17.1 commit完全hash: `bb5a2c7f8ee8ea552b7b3d16e8a667f2ed433139`

### 10.1 自動検証結果（統合前再確認）

- implementation gate: 27件合格
- `npx vitest run`: 78ファイル、1881件全成功
- `npx tsc -b --noEmit`: エラーなし
- `npx vite build`: 成功
- seed決定論・RNG消費順への影響なし（regression testが全件成功していることで確認）
- 敵AI・既存バランス数値（ボクattack、太陽銃solarCost、自然回復、満腹度減少等）への変更なし

### 10.2 ユーザー試遊結果

単一HTML（`rogue-of-sun-phase17-1-visibility-preview-bb5a2c7f8ee8.html`、commit `bb5a2c7`から生成）による試遊で、視界範囲・遮蔽・探索記憶に違和感は確認されなかった。

道や部屋が仮の黒いタイルで構成されているため見づらい点が指摘されたが、視界ロジック自体の欠陥ではなく、地形アセットが未導入であることによる表示上の課題と判断した。視界判定・描画方式は変更せず、そのまま採用する。

### 10.3 承認事項

Phase 17.1を正式承認（`status: accepted`）。以下を維持する：

- symmetric shadowcastingと角抜け禁止規則の積集合による遮蔽判定
- 通常部屋では部屋全体＋正規通路入口1マスを表示する規則
- 通路では半径4の遮蔽付き視界を使用する規則
- unexplored / explored_not_visible / currently_visibleの3状態
- 敵と床アイテムを現在視界内だけ表示する規則（残像なし）
- 発見済み出口を探索記憶に残す規則
- 現在の地形描画方式（暗い単色によるexplored_not_visible表現）

### 10.4 既知の課題（受け入れをブロックしない）

**分類**: `visual_asset_issue`（視覚アセットの課題であり、視界ロジックの欠陥ではない）

仮の黒い地形タイルでは、部屋・通路・探索済み領域の形状が視覚的に読み取りづらい。視界ロジックは変更せず、地形アセット導入時に床・壁・通路・現在視界・探索済み領域の色調と識別性を調整する課題として記録する。

**明示的に却下した変更案**：
- プレイヤー周囲だけを透明にした単純な黒オーバーレイへの置換
- 現在の遮蔽判定（symmetric shadowcasting＋角抜け禁止規則）の撤去
- Phase 17.1視界処理の再設計

### 10.5 main統合

`phase-17-visibility-dark-areas`ブランチをmainへ`--ff-only`で統合した（merge commitなし、rebase・squash・cherry-pick・amendなし）。Phase 17.0（`63c93d6`）・Phase 17.1（`bb5a2c7`）の既存commit hashは維持されたまま、mainのHEADが`1886e3c`から`bb5a2c7`へfast-forwardした。

### 10.6 Phase 17.2

暗い区画の生成・配置・出現率、視界半径2/3の正式決定は未着手のまま。`computeCorridorVisibility`の半径引数はすでに対応済みのため、Phase 17.2ではこの半径決定と暗い区画そのものの生成・配置ロジックに着手する。
