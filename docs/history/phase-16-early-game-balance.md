# Phase 16: 序盤戦闘・空間バランス調整

作成日: 2026-08-06
対象commit: `phase-16-early-game-balance`ブランチ（`main` HEAD `371e0861e6268631a85e8097a7cb31327d506f9d`から分岐）

## 1. Phase 16へ分離した理由

Phase 15試遊で、初期状態のプレイヤーが1階の基本敵「ボク」の通常攻撃1回で実ダメージ6を受けることが確認された。初期LIFEは15のため、1体目のボクとの戦闘だけで大きく消耗し、2体目の敵との遭遇まで到達しにくい。

また、40×30マップに内寸4～9×4～7の部屋を6～9室配置した状態で、敵数を1階6体・2階7体・3階8体へ増やしたため、部屋内で距離を取る・回避する・引き返すといった選択の余地が乏しい。

この2点はPhase 15の対象範囲（数値・計算式の横断調整）そのものではなく、実プレイで判明した個別の序盤バランス問題のため、独立したPhase 16として分離した。

## 2. Phase 15試遊で確認された問題

- ボクの通常攻撃1回でLIFE 15→9相当の消耗（実ダメージ6）
- 部屋が手狭で、複数の敵との交戦時に距離を取る・迂回するといった選択が成立しにくい

## 3. baseline

- repository: `https://github.com/sanadamancom/rogue-of-sun.git`
- branch: `main`
- HEAD: `371e0861e6268631a85e8097a7cb31327d506f9d`（fix: block diagonal attacks through wall corners / Phase 15.6）
- working tree: clean
- baseline時点のテスト: 71ファイル / 1806件、すべて成功
- `npx tsc -b --noEmit`、`npx vite build`ともに成功

## 4. 修正前の戦闘値とダメージ計算経路

- プレイヤー初期値（`state.ts`の`createInitialActor(placement.start, 15, 2, 0, 90, 0)`）：hp 15、attack 2、defense 0、accuracy 90、evasion 0
- ボク定義（`enemy-def.ts`）：hp 6、attack 6、defense 0、accuracy 90、evasion 0
- 敵→プレイヤーのダメージ計算式（`combat.ts`の`computeIncomingDamage`、Phase 15.1導入）：
  `max(1, round(attackerAttack * 2^(-defenderDefense/10)))`
- 初期状態・防具なし（`defenderDefense = 0`）の場合、`2^0 = 1`となるため実ダメージ = `attackerAttack`そのもの。よって`computeIncomingDamage(6, 0) = 6`となり、報告された実ダメージ6を再現した。

## 5. ボクの変更箇所と変更前後の値

`src/game/enemy-def.ts`のボク定義のみを変更した。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| attack | 6 | 3 |
| hp | 6 | 6（維持） |
| defense | 0 | 0（維持） |
| accuracy | 90 | 90（維持） |
| evasion | 0 | 0（維持） |

`computeIncomingDamage`自体・他の敵の定義・プレイヤー側の値は一切変更していない。`computeIncomingDamage(3, 0) = max(1, round(3*1)) = 3`となることをテスト（`enemy-type.test.ts`）とエンジンレベルの直接呼び出し（tsx経由）の両方で確認し、通常攻撃の最終実ダメージが3になることを確認した。

## 6. 通常攻撃の最終実ダメージが3になった根拠

- 単体テスト`enemy-type.test.ts`「bok spawns with the common-table hp (6) and attack (3) values」で`ENEMY_DEFINITIONS.bok.attack === 3`を確認
- `src/game/combat.ts`の`computeIncomingDamage(3, 0)`をNode（tsx）から直接呼び出し、戻り値3を確認
- LIFE15のプレイヤーがボクの通常攻撃を1回受けるとLIFE12、2回でLIFE9になることを、上記計算式から直接導出（既存の一連の回帰テストで防御式・命中率・最低ダメージ保証などの周辺仕様が変わっていないことも確認済み）

## 7. 維持した戦闘値

- プレイヤー攻撃力（2）
- ボクのHP（6）、ボク撃破までの必要攻撃回数（プレイヤー攻撃2×3回=6で撃破、変更なし）
- プレイヤー初期LIFE（15）
- 自然回復量・回復間隔（`turn.ts`の`REGEN_AMOUNT_PER_TICK`等、未変更）
- 防御計算式（`computeIncomingDamage`本体、`computeAttackDamage`）
- 他8種の敵の攻撃力・HP・防御・命中・回避
- 命中率、回避率、クリティカル関連の仕様（本作にクリティカルという別区分は存在せず、通常命中のみ）
- 敵数（1階6体・2階7体・3階8体、`ENEMY_COUNT_BY_FLOOR`は未変更）

## 8. マップと部屋寸法の変更前後

`src/game/mapgen.ts`の`MAP_GEN_PARAMS`のみを変更した。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| width | 40 | 48 |
| height | 30 | 36 |
| roomWidth | 4～9 | 6～11 |
| roomHeight | 4～7 | 5～9 |
| roomCount | 6～9 | 6～9（維持） |
| sectionColumns / sectionRows | 3 / 3 | 3 / 3（維持） |
| sectionMargin | 1 | 1（維持） |
| extraConnections | 1～2 | 1～2（維持） |
| maxGenerationAttempts / maxConnectionAttempts | 50 / 20 | 50 / 20（維持） |

## 9. 部屋数と敵数を維持したこと

`roomCount: { min: 6, max: 9 }`と`ENEMY_COUNT_BY_FLOOR`（1階6体・2階7体・3階8体）はどちらもコード上未変更。1000seedのstress testで部屋数が範囲内に収まること、既存の敵数テスト（`phase-15-5-enemy-count-by-floor.test.ts`）が変更なしで成功することの両方で維持を確認した。

## 10. 生成アルゴリズムで変更した箇所

生成アルゴリズム本体（セクション分割、部屋配置、ルーティング、接続処理）は一切変更していない。`MAP_GEN_PARAMS`の数値のみを変更した。配置試行上限（`maxGenerationAttempts` 50、`maxConnectionAttempts` 20）は変更不要と判断し、変更しなかった（新しい寸法でも1000seed全件が生成に成功したため）。

新しい寸法での各セクションの利用可能領域は、部屋寸法の最大値を収める余地がある（例: 高さ方向はセクション毎の内部高さが概ね11前後、マージン差引後の利用可能高さが概ね9で新しい部屋高さ最大値9とちょうど一致する程度の余裕）。`placeRoomInSection`は要求最大値を利用可能領域に自動でクランプする既存実装のため、算出上の破綻は生じない。

## 11. seed stress test結果

- `npx vitest run`内の既存1000seedロバスト性テスト（`robustness.test.ts`、`phase-15-5-enemy-count-by-floor.test.ts`内の1000seedテスト等）：すべて成功
- 追加で、`generateMap`をtsx経由でseed 1～1000について直接呼び出し、以下をすべて確認：
  - 全seedで例外なく生成完了
  - 全seedでmap.width === 48、map.height === 36
  - 全seedで部屋数が6～9、各部屋の内寸が幅6～11・高さ5～9の範囲内
  - 結果: `ok: 1000, fail: 0`

## 12. カメラとブラウザ確認結果

タイルサイズ・カメラ追従ロジック・HUD配置に関わるコードは変更していない（`phase-14-5-camera.test.ts`含む既存テストは無変更のまま成功）。

**制約事項**: 本タスク実行環境のネットワーク許可リストにブラウザバイナリの取得元（`cdn.playwright.dev`）が含まれておらず、Playwrightによる実ブラウザでのスクリーンショット確認は実施できなかった。代替として、`npx vite preview`でproduction buildを起動しHTTPレスポンス200を確認した上で、`generateMap`・`computeIncomingDamage`をNode上でエンジンそのものに対して直接呼び出す形で、ブラウザが表示する内容と同一の計算結果（48×36マップ生成、部屋寸法範囲、ボク実ダメージ3）を検証した。実際の画面描画・カメラ追従・HUD崩れの目視確認は行えていない。

## 13. 試遊観察結果

上記のネットワーク制約により、ヘッドレスブラウザでの実プレイ試遊（1階を複数seedで開始し、ボク戦後の残りLIFEや2体目への到達可否を目視記録する）は実施できなかった。数値レベルでの検証（LIFE15→12→9の計算根拠、48×36・部屋拡大の生成成功）に留まる。

## 14. 更新した既存Markdown一覧

リポジトリ内には`docs/history/`以外にPhase進行を記載した既存Markdownが存在しなかった（`rogue-of-sun-development-plan.md`・`rogue-of-sun-phase15-balance-draft.md`はプロジェクト資料であり、このリポジトリのファイルではない）。README.mdにも現在のPhase番号の記載はなかったため、リポジトリ内の更新対象はこのhistory docのみとした。

## 15. Phase 26の最終調整とは別工程であること

本Phase 16は、Phase 15試遊で判明した序盤の個別バランス問題（ボクの初撃ダメージ、序盤マップの空間の狭さ）に限定した調整であり、完成版全体の階層数・敵・装備・イベントを含む最終調整（Phase 26）とは別工程である。
