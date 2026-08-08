# Phase 18.2: 千里眼の実・ミニマップ表示・telemetry区別

## 位置づけ

Phase 18.1で追加した3状態（hidden / revealed_untriggered / triggered_inactive）を
基盤として維持したまま、以下を追加した。

1. 千里眼の実（フロア内の全hidden罠をrevealed_untriggeredへ一括変更）
2. 発見済み罠（revealed=true）のミニマップ表示
3. trap_revealedとtrap_triggeredを区別するtelemetry

罠の種類・配置数・効果・敵との相互作用は変更していない。視覚面の最終判断とmain統合はPhase 18.3へ残す。

## 千里眼の実

- ID: `clairvoyance_fruit`、表示名: 「千里眼の実」、分類: `consumable`（既存banana/antidote/panaceaと同じスタック式消費アイテム）
- `item-def.ts`のフロア1用地上アイテムプール（`GROUND_ITEM_POOL_FLOOR_1`）へ追加。専用RNGストリームは新設せず、既存の`itemSelectionRng`（一様抽選）をそのまま使用。候補追加によりフロア1/2/3のプール総数がそれぞれ11→12、15→16、16→17へ変化することは仕様上許容されている（`drawGroundItemCount`/`drawGroundItemSelection`のロジックそのものは無変更）
- 開始地点・出口・敵・罠・他アイテムとの既存重複回避（`chooseGroundItemPosition`の`exclusions`）はそのまま適用される

## 使用処理とターン進行

`turn.ts`に`applyClairvoyanceUse`を新設し、`applyItemUse`のbanana/antidote/panaceaと並ぶ分岐として追加した。

- 所持数0の場合のみ不成立（`owned <= 0`）。それ以外は**常に成功**する。hidden罠が0件、あるいは新規発見0件（全罠がすでにrevealed）でも、所持数を1減らし、既存の消費アイテム経路（`state.inventoryOpen = false`、`consumed: true`を返す）に従って1ターンを消費する。antidote/panaceaのような「対象0件なら不成立」という拒否パターンは採用していない
- フロア上の全`TrapTile`のうち`revealed=false`のものだけを`revealed=true`へ変更する。`triggered`は一切変更しない。他フロアへは影響しない（`state.traps`は各フロアで独立に保持されるため、他フロアの状態を触る経路自体が存在しない）
- 使用後の敵行動・状態効果処理は`processTurn`の既存パイプライン（`consumed: true`を返した通常の`use_item`と同じ経路）にそのまま乗る。個別の敵行動処理を新設していない

## 通常移動発見との共有ロジック

プレイヤー移動と千里眼の実、両方の発見経路が同じ`revealTrap`関数（`turn.ts`）を通る。

- `revealTrap`は`revealed=false`の罠だけを`revealed=true`にし、`trap_revealed`イベントを1回だけ発行する。すでに`revealed=true`の罠に対しては何もしない（イベントも発行しない）
- プレイヤー移動の発動ループは`revealTrap`を呼んだ直後に`triggered = true`を設定する。この順序により、`triggered=true`は常に`revealed=true`を伴うというPhase 18.1の不変条件が維持される
- 未発見罠を踏んだ場合: `trap_revealed`（source: 'step'）と`trap_triggered`の両方が成立する
- 発見済み未発動罠を踏んだ場合: `trap_triggered`のみが成立する（`revealTrap`が何もしないため`trap_revealed`は発行されない）

## メッセージ

- `clairvoyance_used`イベント（`revealedCount`を保持）を新設し、`message-log.ts`で「フロアの罠が見えるようになった。」（1件以上）／「罠は見つからなかった。」（0件）を分岐表示する
- `trap_revealed`イベント自体には専用の文言を割り当てていない。プレイヤー移動での発見（source: 'step'）は同一ターン内で必ず直後の`trap_triggered`ログが表示されるため、二重表示を避けた
- 発見した罠の座標や内部IDはログへ列挙していない

## ミニマップ

`main.ts`の`drawMinimap()`に罠描画ブロックを追加した。

- `revealed=false`の罠は描画しない
- `revealed=true`の罠は`this.exploredTiles`や`isCurrentlyVisible`に一切依存せず常に描画する。これにより、千里眼で発見した未探索領域の罠も記号だけが表示され、周囲の床・壁・部屋形状は新たに開示されない（この罠描画ループは`exploredTiles`を読みも書きもしない）
- `revealed_untriggered`は警告色（黄、不透明度0.85）、`triggered_inactive`は同色で不透明度を下げた表示（0.35）とし、両者を視覚的に区別できるようにした
- slow_trapとpoison_trapはミニマップ上で同一形状（要求どおり区別不要）
- 描画順は「地形・出口 → 罠 → 敵 → 床アイテム → プレイヤー」とし、罠記号がプレイヤー・敵・出口などの重要記号を隠さないようにした
- フロア移動時は`state.traps`がフロアごとに独立して再構築されるため、前フロアの罠記号が残ることはない

## telemetry

Phase 18.0の監査で「trap_triggeredイベントがtelemetryへ未接続」と判明していた点を含めて対応した。

- `RunEventPayload`へ`trap_revealed`（`trapType`, `source: 'step' | 'clairvoyance'`）と`trap_triggered`（`trapType`）を追加
- `translateGameEvent`に明示的なcaseを追加し、既存の`trap_triggered`ゲームイベント・ログ（「毒の罠を踏んだ！」「鈍足の罠を踏んだ！」）はそのまま維持した
- `clairvoyance_used`は既存`item_used`の`effect: string / amount: number`の型を再利用し（`effect: 'trap_reveal'`, `amount: revealedCount`）、antidote_used/panacea_usedと同じ拡張パターンに従った。汎用telemetry基盤の再設計は行っていない

## 検証

- targeted: Phase 18.1罠テスト、千里眼の実（新規10件）、telemetry区別（新規7件）、アイテム使用・ターン進行、既存ミニマップ関連の型/ロジックテストを実行し全通過
- full: `npx vitest run` → 83ファイル / 1943テスト全通過（既存`phase-15-4-random-ground-items.test.ts`のプール個数アサーションは`clairvoyance_fruit`追加に伴い11/15/16→12/16/17へ更新）
- `npx tsc --noEmit` → エラーなし
- `npx vite build` → ビルド成功

## Phase 18.3へ残した範囲

- 視覚面の最終判断（配色・アイコン等の完成版アセット）
- mainブランチへの統合
- 試遊用単一HTMLビルドでの実プレイ確認

装備解除不能バグの調査・修正は行っていない。development planファイル（リポジトリ内・外部添付のいずれも）は変更していない。

## 追記: ミニマップ罠表示テストの監査と補完（phase-18-2-minimap-test-correction）

Phase 18.2完了報告の「ミニマップ」節はmain.tsの実装内容を説明していたが、実際に自動テストで検証していたわけではなかった（`main.ts`はPhaserシーンでありユニットテスト対象外、かつ罠表示ロジックをテスト可能な形で外出しした専用モジュールも存在しなかった）。監査の結果、要求されたミニマップ罠表示の8項目はいずれも直接検証されていないことが確認されたため、最小限の補完を行った。

- `main.ts`のdrawMinimap内にインライン実装されていた罠マーカーの表示可否・スタイル決定ロジックを、新規`src/game/minimap.ts`の純粋関数`getMinimapTrapMarkers(traps)`へ抽出した。exploredTiles・視界・暗い部屋のいずれも引数に取らない（データとして参照しようがない）ことをそのまま純粋関数のシグネチャとして表現し、`main.ts`側はこの関数の戻り値をそのまま描画するだけに変更した。表示色・不透明度（0.85/0.35）は既存実装の値をそのまま`MINIMAP_TRAP_UNTRIGGERED_ALPHA`/`MINIMAP_TRAP_TRIGGERED_ALPHA`として名前を付けただけで、仕様・配色は変更していない
- 新規`phase-18-2-minimap.test.ts`（9件）で以下を直接検証した:
  - revealed=falseの罠がマーカーを生成しないこと
  - revealed=true, triggered=falseの罠がマーカーを生成すること
  - revealed=true, triggered=trueの罠がマーカーを生成すること
  - 未発動・発動済みでalphaが異なり視覚的に区別できること
  - 罠のみを入力とする関数シグネチャであることそのものが「視界外・暗い部屋・千里眼による未探索領域の発見」いずれでもマーカーが生成されることの根拠になっていること
  - マーカーがpos/alpha以外の情報（地形・壁・部屋データ）を一切持たないこと
  - 関数の引数がtrapsのみ（1個）であることをピン留めし、将来exploredTiles等のゲート条件が無断で追加されないようにしたこと
  - フロア遷移後、新フロアのtraps配列からは前フロアで発見済みだったマーカーが一切引き継がれないこと
  - `traps`が`undefined`の場合も空配列として扱われること

罠・千里眼・telemetry・アイテム配置の仕様変更は行っていない。配色や完成版アセットの調整はPhase 18.3へ残す。
