# Phase 09.3a 日向待機によるSOL回復への変更

## 変更理由

Phase 09.3で導入したVキー専用の「チャージ」アクションを廃止し、日向マスで通常のSpace待機を行った場合にSOLが1回復するよう変更します。専用アクションを増やすのではなく、既存の待機操作へ機能を統合することで、操作体系をシンプルに保ちます。

## Phase 09.3開始状態

開始時のHEADは`089eb689e46f4c71ec0a90a7ac47c10cd57ae57b`（Phase 09.3のcommit、origin/mainと一致、working tree clean）です。Phase 09.3では、terrainと独立したsunlightレイヤー、1〜3階の日向配置規則、Vキー専用チャージ（成功時SOL+1・1ターン消費・敵1回行動、日陰またはSOL満タンで不成立・ターン非消費・敵非行動）、チャージモーション、太陽銃と共通の最大SOL 5が実装済みで、TypeScript・40ファイル772テスト・build・単一HTMLのfile起動がいずれも成功し、origin/mainへpush済みであることを確認しました。

## 調査結果

- **Space入力の変換経路**：`input.ts`の`actionForKey`で`' '`/`'space'`/`'spacebar'`はすべて`{ type: 'wait' }`へ変換されます（Shiftキーの影響を受けません）。
- **通常待機のターン処理経路**：`turn.ts`の`applyPlayerAction`内、`action.type === 'wait'`分岐が`state.hammerRecovery = false`を設定し、`{ consumed: true, attacked: false, defeated: false }`を返すのみでした。`processTurn`はこの`consumed: true`を見て、既存の敵行動解決（`resolveEnemiesAction`）・リジェネ・フロア判定・ターン加算を1回だけ実行する共通パイプラインへ進みます。
- **敵行動処理**：`wait`は他のあらゆる`consumed: true`のアクションと全く同じ`processTurn`の後段パイプラインを通るため、敵は既存の仕組みのまま1回だけ行動します。チャージ専用の敵行動処理は元々存在せず、Phase 09.3の`resolveCharge`も同じ共通パイプラインに乗る形で実装されていました。
- **hammerRecoveryとの関係**：`wait`分岐は常に`state.hammerRecovery = false`を無条件で設定しており、Phase 09.3の`resolveCharge`はこれとは別の独立した分岐として存在し、`hammerRecovery`に一切触れていませんでした（チャージ成功・失敗いずれでも変更なし、という09.3の仕様）。
- **チャージモーション起動経路**：`main.ts`の`applyTurnResult`が、確定した`result.events`に`solar_charge_used`イベントが含まれるかどうかだけを見て`playChargeMotion()`を呼ぶ、入力の種類に依存しない実装でした。そのため`solar_charge_used`イベントを`wait`側から発行するだけで、モーション起動ロジック自体は無改修で流用できると判断しました。
- **Vチャージ関連の洗い出し**：`types.ts`の`PlayerAction`の`charge`メンバー、`input.ts`の`'v'`→`charge`マッピング、`turn.ts`の`applyPlayerAction`内`charge`分岐と`resolveCharge`関数、`events.ts`の`solar_charge_failed_shadow`/`solar_charge_failed_full`、`message-log.ts`の対応する2ケース、`main.ts`の操作案内文言「V:日向でチャージ」、および`phase-09-3-sunlight-and-charge.test.ts`内の`{ type: 'charge' }`を使う全テスト（3つのdescribeブロック、旧仕様の失敗系テストを含む）を対象として特定しました。

## V専用チャージから待機チャージへ変更した内容

`turn.ts`の`applyPlayerAction`から`charge`分岐と`resolveCharge`関数を削除し、代わりに既存の`wait`分岐へ以下を追加しました。

```
if (action.type === 'wait') {
  state.hammerRecovery = false;
  if (isSunlitAt(state.sunlight, state.player.pos) && state.solarEnergy < state.maxSolarEnergy) {
    state.solarEnergy = Math.min(state.maxSolarEnergy, state.solarEnergy + 1);
    events.push({ type: 'solar_charge_used', recovered: 1 });
  }
  return { consumed: true, attacked: false, defeated: false };
}
```

日向かつSOLが最大値未満の場合だけSOLを1回復して`solar_charge_used`イベントを積み、それ以外（日陰、または満タン）は従来どおりの通常待機として何も追加処理をしません。`types.ts`の`PlayerAction`から`{ type: 'charge' }`を削除し、`input.ts`の`'v'`→`charge`マッピングも削除しました（`actionForKey('v')`は`null`を返します）。

## ターンと敵行動の仕様

日向でSOLが実際に回復したケース・日陰のケース・満タンのケースのいずれも、`wait`は常に`consumed: true`を返すため、ターンは必ず1消費され、敵は既存の共通パイプラインを通じて必ず1回行動します。Phase 09.3のように「日陰・満タンでは不成立でターン非消費」という分岐は撤廃され、待機は常に成立する通常の待機として統一されました。

## hammerRecoveryとの統合方法

`wait`分岐は既存のとおり無条件で`state.hammerRecovery = false`を設定し、その直後（同じ分岐内、同じ関数呼び出し中）にSOL回復判定を行います。SOL回復とhammerRecoveryのクリアは同一の`wait`処理・同一ターン内で完結し、別の待機処理や2回目のパイプライン呼び出しを追加していません。日向で実際にSOLが回復したケースでも、日陰・満タンのケースでも、`hammerRecovery`は常に同じ規則（待機なら常にfalseへ）で処理されます。

## 削除した型、イベント、入力

- `PlayerAction`の`{ type: 'charge' }`メンバー
- `input.ts`の`'v'`→`{ type: 'charge' }`マッピング
- `turn.ts`の`resolveCharge`関数と`applyPlayerAction`内の`charge`分岐
- `GameEvent`の`solar_charge_failed_shadow`／`solar_charge_failed_full`
- `message-log.ts`の対応する2つの`case`

`solar_charge_used`イベントはそのまま名称・フィールド構成を変えずに再利用し、発行元だけを`resolveCharge`から`wait`分岐へ移しました。

## 変更ファイル

- `src/game/types.ts`（`PlayerAction`から`charge`削除）
- `src/game/turn.ts`（`wait`分岐へSOL回復を統合、`charge`分岐と`resolveCharge`削除）
- `src/game/input.ts`（`v`キーマッピング削除、コメント更新）
- `src/game/events.ts`（`solar_charge_failed_shadow`/`solar_charge_failed_full`削除）
- `src/game/message-log.ts`（上記2ケース削除、`solar_charge_used`のログ文言を待機ベースの表現へ調整）
- `src/main.ts`（操作案内から「V:日向でチャージ」を削除し「Space:待機／日向でSOL回復」へ変更、関連コメント更新。日向オーバーレイ・HUDレイアウト自体は無変更）
- `src/game/__tests__/phase-09-3-sunlight-and-charge.test.ts`（`{ type: 'charge' }`を使っていた3つのdescribeブロックを、`wait`ベースの新仕様に沿った5つのdescribeブロック（成功・日陰・満タン・Vキー無効化・hammerRecovery統合）へ書き換え。sunlightレイヤー生成自体のテスト（floor1〜3の配置規則、決定性など）は無変更のまま維持）

## 自動テスト・TypeScript・build・diff checkの結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：全40ファイル777件成功（Phase 09.3の772件から、charge関連テストの書き換えにより純増5件、失敗・スキップなし）
- `npx vite build`：成功（エラーなし、チャンクサイズ警告のみ）
- `git diff --check`：成功
- `package.json`/`package-lock.json`：差分なし
- 差分は`types.ts`・`turn.ts`・`input.ts`・`events.ts`・`message-log.ts`・`main.ts`・関連テスト1ファイルのみに限定

## 手動確認結果と未確認項目

`tsx`によるヘッドレス実行で以下を実測しました。

- run seed 7777、開始位置（日向）でSOL3の状態でSpace待機：`consumed: true`、ログ「日向で待機し、太陽エネルギーが回復した。」、SOL 3→4
- 日陰タイルへ移動してSpace待機：`consumed: true`、SOL変化なし（ログなし）
- 満タン状態（SOL5）で日向タイルにてSpace待機：`consumed: true`、SOL変化なし（ログなし）
- `actionForKey('v')`：`null`（Vキーは完全に無効化）

Playwright（Chromium、`dist/`をローカルHTTPサーバ配信）でビルド済みゲームを起動し、コンソールエラー0件を確認しました。Space押下後のスクリーンショットも取得しましたが、実際のブラウザ操作でのSOL回復の目視確認、日陰・満タン時に通常待機として振る舞うことの目視確認、チャージモーションが日向成功時だけ再生されることの目視確認、Space連打時に二重回復が起きないことの実操作確認、Vキーを押してもゲームに変化が起きないことのブラウザ上での確認は今回未実施です。太陽銃への無回帰は自動テスト（`phase-09-2-solar-gun.test.ts`全64件）で確認しましたが、ブラウザでの実射撃操作は未実施です。

## Phase 09.3aで実装しなかった要素

エンチャント、太陽銃カスタマイズ、バッテリー、天候・時刻連動、自然回復（移動によるものを含む）はいずれも実装していません。現在のゲームは引き続き3フロアのみの試作です。SOL回復量1・最大値5は本フェーズ時点の暫定値であり、最終確定したものではありません。

## 完了可否

Phase 09.3aは完了。
