# Phase 11.3 満腹度・チョコレート・飢餓

## 目的

Phase 11.1（所持上限20）・Phase 11.2（容量表示・置く・捨てる）に続き、実プレイのclear telemetryを根拠に、満腹度・チョコレート・飢餓ダメージを追加した。状態異常、経験値、成長要素は対象外。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `9960065e6f623ca42f3605346c7bce7e6c213fbd`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 50テストファイル・1064件 全成功
- `npx vite build`: 成功

## 実プレイ行動数と採用数値の根拠

タスク仕様に含まれる実プレイclear telemetry3件（run_turn_mean 474.3、range 449〜517）をそのまま採用。最大満腹度100・4ターンごとに1減少の場合、満腹状態のみで400ターン行動でき、実測3ランはいずれもこれを超えるため終盤に食料が必要になる、というタスク側の分析を前提に、以下の固定値をそのまま実装した：

- 最大満腹度：100
- 減少：成功ターン4回につき1
- チョコレート回復量：30
- 飢餓ダメージ：1、5ターン周期

## 実装前のターン確定経路

- `processTurn`（`turn.ts`）：`applyPlayerAction`→（consumed時）`resolveEnemiesAction`→playerDefeated確定→自然回復→フロア到達判定→`turn`インクリメント→`expireWebs`
- 消費/非消費は各アクション処理関数の戻り値`consumed`で決まる。既存の失敗・キャンセル・メニュー操作（壁移動、装備済み再選択、所持品開閉・選択移動、置く/捨て失敗、捨てる確認開始・キャンセル）はいずれも`consumed:false`または`processTurn`冒頭のguardで弾かれ、ターンを進めない

## 実装前の自然回復処理

- `state.player.hp < maxHp`なら`regenProgress += 1`、`REGEN_TURNS_PER_HP`(5)到達で10回復・リセット。満HPなら`regenProgress = 0`にリセットしていた

## 満腹度の状態所有

- `GameState`へoptionalフィールドとして追加：`hunger`/`hungerDecreaseProgress`/`starvationProgress`/`hungerLowWarned`/`hungerZeroWarned`
- optionalにした理由：`Inventory`型は`Record<ItemId, number>`で全キー必須のため、chocolate追加自体で既存19テストファイルの`inventory`リテラルに`chocolate: 0`の追加が必要になった（後述）。これに加えてGameStateの必須フィールドまで増やすと影響範囲がさらに拡大するため、Phase 11.2の`discardConfirmItemId`と同じ前例に倣い、hunger系フィールドはoptionalとし、`hunger.ts`の`getHunger`/`getHungerDecreaseProgress`/`getStarvationProgress`で`?? デフォルト値`により読み取る設計にした
- ラン全体状態として`state.ts`の`CarryOverStats`・`buildFloorState`・`advanceToNextFloor`で維持。フロア生成状態やmap stateには一切含めていない
- 最大値`HUNGER_MAX`は`hunger.ts`に1箇所のみ定義

## 最大値・初期値・減少周期

- `HUNGER_MAX = 100`、新規ラン・死亡後再挑戦とも100で初期化
- `HUNGER_DECREASE_INTERVAL = 4`：成功ターンごとに進行カウンタ+1、4到達で満腹度-1・カウンタ0リセット
- 満腹度は0未満にならない（`Math.max(0, ...)`）

## チョコレートの定義・配置・回復量

- `item-def.ts`：`chocolate`を`category: 'consumable'`として登録（新規`food`カテゴリは追加せず、既存のconsumable表示・取得・置く・捨て機構をそのまま再利用。効果種別は`healAmount`/`solarAmount`と同様の新規`hungerAmount`フィールドで区別）
- `ITEM_IDS_IN_ORDER`へ追加（一覧表示・取得対象に含まれる）
- `state.ts`：全フロアに1個、既存の`sun_fruit`と同じパターン（フロアごとの独立RNGストリーム、既存アイテム全てのタイル除外、到達可能な床のみ、`chooseGroundItemPosition`の既存決定的生成をそのまま利用）で配置
- 回復量30、100を超えて回復しない、満腹度が最大の場合は使用失敗（ターン・所持数とも不変）

## 飢餓ダメージ

- 満腹度が0の状態で成功ターンを消費するたび`starvationProgress`+1、5到達でLIFEに1ダメージ・カウンタ0リセット
- 防具・回避判定を一切経由せず`player.hp -= 1`で直接適用（`combat.ts`は使用しない）
- 満腹度が1から0になった同じ行動ではダメージを与えない：`applyHungerProgression`は「このターン開始時点の満腹度」で分岐するため、1→0へ落ちるターンは必ず減少分岐（`hunger>=1`側）を通り、`starvationProgress`を0にリセットするのみでダメージ分岐に入らない。次の成功ターンで初めて満腹度0の分岐（飢餓側）に入る
- LIFEが0以下になった場合は既存の`player.alive = false`→`playerDefeated`→`phase = 'gameover'`経路へ接続。死因の専用フィールドは追加せず、`starvation_damage`イベント直後に`player_defeated`が並ぶことで識別可能とした

## 自然回復との関係

- 既存の`if (player.hp < maxHp) { regenProgress+=1; ... } else { regenProgress=0; }`を`if (getHunger(state) >= 1 && ...)`でラップ
- 満腹度0の間は`regenProgress`を一切変更しない（増加もリセットもしない）分岐を追加し、保持された値から回復再開できるようにした
- 飢餓ダメージ（満腹度0でのみ発生）と自然回復（満腹度1以上でのみ発生）は排他的なので、同一ターンでの相殺は構造上発生しない

## 処理順序

タスクのturn_order要求は「行動確定→チョコレート回復→満腹度/飢餓更新→自然回復→敵環境進行→死亡判定」だが、implementation_noteの許可に従い、以下の理由で敵解決の位置を変更せず、飢餓更新をその後段に配置した：

1. 既存コードは`applyPlayerAction`直後に`resolveEnemiesAction`を呼んでおり、Phase 11.1/11.2までの全既存テスト（「成功した使用/装備/置く/捨てるの後に敵が行動する」等）がこの順序に依存している。順序を入れ替えると既存回帰の再検証範囲が大きくなり、リスクが高いと判断した
2. 採用した順序：`applyPlayerAction`（チョコレート回復はこの内部で完結）→`resolveEnemiesAction`→（生存していれば）`applyHungerProgression`→`playerDefeated`確定→自然回復（hunger>=1条件）→フロア判定→ターン増加
3. この順序でも「同一行動でのチョコレート即時反映」「同一ターンでの飢餓ダメージ回避」「敵ターン数不変」「死亡後に敵・環境を余分に進めない」という観測可能な結果はすべて満たされる（チョコレートの回復はplayerAction内で先に確定しており、飢餓進行はその後の最終満腹度を見るため）

## 成功・失敗・キャンセル時のターン境界

- 成功した移動・攻撃・待機・チャージ・アイテム使用（チョコレート含む）・装備・解除・置く・捨てる：1ターン消費、満腹度進行カウンタ+1（または飢餓進行+1）
- 失敗移動、無効化された攻撃（hammer反動再コック以外は基本consumed:true、SOL不足の銃撃のみconsumed:false）、使用失敗、装備済み再選択、置く/捨て失敗、捨てる確認開始・キャンセル、所持品開閉・選択移動：0ターン、満腹度・飢餓とも進行なし

## HUD表示

- 常設HUD（`hudText`）へ`満腹度 現在/100`を追加（既存のFLOOR/HP/SOL表示と同じ行・同じテキストオブジェクト）
- 0のときは`(空腹)`という文字列を付加して明確化。20以下は数値そのもの（`/100`との対比で低下が分かる）で表現し、専用の色分けは追加していない（既存HUDが単色の1つのTextオブジェクトであるため、部分的な色替えは別のTextオブジェクト分割という非最小差分の変更になると判断し見送った）
- 所持品画面限定ではなく、通常プレイ中常時表示される

## イベントとメッセージ

- `events.ts`に追加：`chocolate_used`/`chocolate_use_failed`（reason: hunger_full）/`hunger_low_warning`/`hunger_zero_warning`/`starvation_damage`
- `message-log.ts`に対応する日本語メッセージを追加
- 低下警告（20到達）・飢餓警告（0到達）は`hungerLowWarned`/`hungerZeroWarned`フラグで一度きりに制御し、閾値より上へ回復すると再アームされる
- テレメトリschemaVersionは3のまま変更していない

## フロア遷移・新規ラン・再挑戦

- `hunger`/`hungerDecreaseProgress`/`starvationProgress`/両警告フラグは`CarryOverStats`経由でフロア間維持
- フロア遷移では回復しない
- 新規ラン（`createInitialState`）・死亡後再挑戦（同経路）はいずれも`buildFloorState`の`carry`未指定パスを通り、100/0/0/false/falseへ確実に初期化される

## 決定性と乱数

- 満腹度・飢餓の判定処理は乱数を一切使用しない
- チョコレート配置は既存アイテムと同じ`chooseGroundItemPosition` + 独立XOR定数によるRNGストリームを使用し、他のRNG消費順序を変更していない

## 変更ファイル

- `src/game/hunger.ts`：新規。定数とヘルパー関数
- `src/game/types.ts`：`ItemId`へ`chocolate`追加、`GameState`へhunger系optionalフィールド追加
- `src/game/item-def.ts`：`hungerAmount`フィールド追加、chocolate定義、`ITEM_IDS_IN_ORDER`更新
- `src/game/events.ts`：チョコレート・警告・飢餓ダメージイベント追加
- `src/game/message-log.ts`：対応する日本語メッセージ追加
- `src/game/turn.ts`：`applyChocolateUse`/`applyHungerProgression`/`updateHungerWarnings`追加、`applyItemUse`からのディスパッチ、`processTurn`内の飢餓進行呼び出しと自然回復のhunger gate
- `src/game/state.ts`：チョコレート配置、`CarryOverStats`とフロア遷移でのhunger維持
- `src/main.ts`：HUDへ満腹度表示追加
- `src/game/__tests__/hunger-food-starvation.test.ts`：新規テストファイル
- 既存19テストファイル：`inventory: {...}`リテラルへ`chocolate: 0`を追加（`Inventory`型が`Record<ItemId, number>`で全キー必須のため、chocolateという新規ItemId追加に伴う機械的な追随。効果・期待値は一切変更していない）

## 追加・更新テスト

`hunger-food-starvation.test.ts`に67件追加（1件は敵同時存在によるダメージ源混線のため削除・別の既存回帰テストで代替）：

- 初期化（4件）
- 満腹度減少（13件）：3回不変、4回で-1、8回で-2、下限0、各成功行動種別（移動/攻撃/待機/使用/装備/置く/捨てる）が対象になること、失敗・オーバーレイ操作で不変、乱数不変
- チョコレート（16件）：配置数・到達可能性・非重複・決定性、取得、容量満杯での取得失敗、使用成功・上限クランプ・満腹時失敗・失敗時notturn、成功1ターン、0満腹度から使用時の飢餓回避、進行重複なし、置く/捨てるとの連携、定義確認
- 飢餓（9件）：1→0の同ターン無ダメージ、4回まで無ダメージ、5回目で1ダメージ、10回で2ダメージ、失敗時不進行、防具無効、乱数不使用、満腹度回復でカウンタリセット、LIFE0での死亡遷移
- 自然回復との相互作用（7件）：hunger>=1で従来通り回復、hunger0で回復停止、regenProgress不変、1→0遷移でregenProgress非リセット、回復後の再開、同一ターン非相殺、既存回復量・周期不変
- ライフサイクル（3件）：フロア間維持、フロア遷移での非回復、新規ランでの非残留
- HUD/メッセージ閾値（6件）：20到達警告1回のみ、継続時非重複、0到達警告1回のみ、継続時非重複、再ダイブ時再警告、飢餓ダメージ通知1回
- 回帰（7件）：容量20、apple効果、sun_fruit効果、武器装備、通常ターン消費、敵1回行動、フロア遷移、新規ラン初期化

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：51テストファイル・1131件（既存1064件 + 新規67件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 所持上限20を変更していないこと

`INVENTORY_CAPACITY`（Phase 11.1）はそのまま。chocolateも他アイテムと同じ合計容量に含まれる。

## リンゴと太陽の実の効果を変更していないこと

`healAmount: 20`・`solarAmount: 2`とも無変更。回帰テストで確認済み。

## 自然回復の量と周期を変更していないこと

`REGEN_TURNS_PER_HP = 5`、1回復量10のまま。hunger>=1条件でのゲート追加のみ。

## telemetry schemaVersionを変更していないここと

schemaVersion 3のまま。新規イベントは既存の`recordTurn`/`finalizeRun`経路をそのまま利用する。

## Phase 12以降を開始していないこと

状態異常・一時効果・経験値・成長要素は実装していない。

## Claudeが判断した実装詳細と理由

- チョコレートのcategory：新規`food`型を追加せず既存`consumable`を再利用（UI・取得・置く・捨て機構の無改変流用）
- チョコレート配置：全フロア共通（フロア限定なし）、既存sun_fruitパターンを踏襲した独立RNGストリーム
- 満腹度/飢餓判定の処理順：既存の「敵解決→死亡確定→自然回復」の構造的位置を保ったまま、飢餓進行を敵解決の直後・死亡確定の直前に挿入（詳細理由は上記「処理順序」参照）
- HUD表示形式：`満腹度 現在/100`、0のみ`(空腹)`を付加。低下(20以下)の専用色分けは見送り
- GameStateのhunger系フィールドをoptionalにした設計判断（既存テストへの影響最小化）

## 未確認事項

- `rogue-of-sun-development-plan.md`は引き続きリポジトリ管理外
- 満腹度に応じたHUD色分け（低下時の視覚的強調）は実装しておらず、必要であれば別タスクでの追加を推奨
- マウス操作は本フェーズでも対象外（既存UIと同様キーボードのみ）
