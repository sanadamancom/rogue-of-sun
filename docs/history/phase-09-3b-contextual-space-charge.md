# Phase 09.3b Space入力の状況依存化（待機とチャージの分離）

## 変更理由

Phase 09.3aで「日向での待機がSOLを回復する」という実装にしましたが、これは「待機の副次効果としてSOLが回復する」という不正確な仕様でした。正しくは、Space入力は現在地とSOL状態に応じて「通常待機」または「チャージ」という別々の行動に振り分けられる状況依存入力であるべきです。本フェーズでは、この誤りを訂正し、Space入力を状況に応じて内部的に別処理へ分岐させる形へ変更します。

## Phase 09.3a開始状態

開始時のHEADは`7153b5080370beda87cb703eac9cb353d6e3ff76`（Phase 09.3aのcommit、origin/mainと一致、working tree clean）です。Phase 09.3aでは、Vキー専用チャージを廃止し、`wait`分岐の末尾へ「日向かつSOL未満ならSOLを1回復する」という副次処理を追加していました。TypeScript・40ファイル777テスト・build・単一HTMLのfile起動がいずれも成功し、origin/mainへpush済みであることを確認しました。

## 調査結果

- **Space入力の解決経路**：`input.ts`の`actionForKey`はSpaceを一貫して`{ type: 'wait' }`へ変換します。この入力レベルでは行動の種別分岐は行わず、`turn.ts`側で状況に応じて処理を振り分ける設計としました。
- **既存hammerRecoveryのクリア規則**：`turn.ts`のコメント（`hammerRecovery`フィールドの定義コメント）に明記されている「クリアされる既存の条件」は、「成功した移動」「待機」「別武器でのXアクション」という、あらかじめ列挙された特定の通常行動のみです。「ターンを消費するあらゆる行動」という一般規則ではありません。チャージはこの列挙に含まれない新しい行動であり、チャージ中にハンマーの構え直しも同時に完了する（SOL回復とhammerRecovery解除を同時に得る）ことを積極的に支持する仕様上の根拠は見当たりませんでした。この調査結果を踏まえ、ユーザーの指摘どおり「チャージは独立行動として扱い、hammerRecoveryには触れない」という設計を採用しました。
- Phase 09.3の元々のVキー専用チャージ実装も、当時から意図的に`hammerRecovery`へ触れない設計になっており、今回の変更はその挙動を復元するものです。

## Space入力の状況依存アクションとしての扱い

`turn.ts`の`applyPlayerAction`内、`wait`分岐を以下のように変更しました。

```
if (action.type === 'wait') {
  if (isSunlitAt(state.sunlight, state.player.pos) && state.solarEnergy < state.maxSolarEnergy) {
    return resolveSolarCharge(state, events);
  }
  state.hammerRecovery = false;
  return { consumed: true, attacked: false, defeated: false };
}
```

`PlayerAction`型に独立した`charge`メンバーを追加することはせず、入力型は`wait`のまま維持しています。`wait`の解決時に、日向かつSOL未満という条件を満たす場合だけ、新設した`resolveSolarCharge`関数（チャージ専用の解決処理）へ分岐します。それ以外（日陰、または日向でもSOL満タン）は、これまでどおりの通常待機として処理されます。ターン消費・敵行動という共通のターン進行の仕組みは、チャージも通常待機も`processTurn`の同じ後続パイプラインへ`consumed: true`を返すことで共有していますが、SOL増減・イベント発行・`hammerRecovery`の扱いという行動の内容そのものは、チャージと通常待機で完全に分離しています。

## ターンと敵行動の仕様

チャージ・日陰待機・満タン待機のいずれも`consumed: true`を返すため、ターンは必ず1消費され、敵は既存の共通パイプラインを通じて必ず1回行動します（Phase 09.3a時点から変更なし）。

## hammerRecoveryとの統合方法

新設した`resolveSolarCharge`はチャージ成功時に`state.hammerRecovery`へ一切触れません。一方、日陰・満タンの通常待機は、これまでどおり無条件で`state.hammerRecovery = false`を設定します。この結果、「通常待機ではhammerRecoveryが解除されるが、チャージでは解除されない」という、行動の種類による明確な区別が実現されました。ハンマー装備中に反動状態のまま日向でチャージしても、SOL回復とハンマーの構え直しが同時に完了する「二重の利益」は発生しません（自動テストで、チャージ成功時に`hammerRecovery`がtrueのまま維持されることを確認しています）。

## 削除した型、イベント、入力

Phase 09.3aの時点で`PlayerAction.charge`・`resolveCharge`関数・Vキーマッピング・`solar_charge_failed_shadow`/`solar_charge_failed_full`イベントは既に削除済みで、本フェーズでは新たな型・イベントの削除はありません。`solar_charge_used`イベントは名称・フィールド構成を変えず、発行元を`resolveSolarCharge`という新しい専用関数へ移しました。

## 表示・ログの区別

チャージ成功時のログ文言を、待機との誤解を避けるため「太陽光を吸収し、SOLが1回復した。」へ変更しました（「待機したためSOLが回復した」という意味に読める文言は使用していません）。日陰・満タンの通常待機では、これまでどおりログを一切出しません。操作案内は「Space：待機／日向でチャージ」（全角コロン、指定文言どおり）へ更新しました。

## チャージモーション

`main.ts`の`applyTurnResult`は、確定した`result.events`に`solar_charge_used`が含まれる場合だけ`playChargeMotion()`を呼ぶ、既存のイベント駆動の仕組みをそのまま利用しています。この判定はチャージという行動が成立したかどうかそのものに基づいており、通常待機（日陰・満タン）では`solar_charge_used`が発行されないため、モーションも再生されません。`activeAnimations`カウンタによる入力ロックは無変更で、モーション中のSpace連打による二重チャージを引き続き防止します。

## 変更ファイル

- `src/game/turn.ts`（`wait`分岐を状況依存の分岐へ変更、`resolveSolarCharge`新設、`hammerRecovery`を意図的に触れない設計に変更）
- `src/game/message-log.ts`（チャージ成功ログの文言を「太陽光を吸収し、SOLが1回復した。」へ変更）
- `src/main.ts`（操作案内を「Space：待機／日向でチャージ」へ変更、関連コメントをチャージ/待機の区別が分かる表現へ更新）
- `src/game/__tests__/phase-09-3-sunlight-and-charge.test.ts`（チャージ成功・日陰待機・満タン待機・Vキー無効化・hammerRecovery区別の各describeブロックを、チャージと通常待機を明確に区別する新仕様のテストへ書き換え）

`PlayerAction`型・`input.ts`・`events.ts`は、Phase 09.3aで既に必要な変更が完了しているため、本フェーズでの追加変更はありません。

## 自動テスト・TypeScript・build・diff checkの結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：全40ファイル778件成功（Phase 09.3aの777件から純増1件、失敗・スキップなし）
- `npx vite build`：成功（エラーなし、チャンクサイズ警告のみ）
- `git diff --check`：成功
- `package.json`/`package-lock.json`：差分なし
- 差分は`turn.ts`・`message-log.ts`・`main.ts`・関連テスト1ファイルのみに限定

## 手動確認結果と未確認項目

`tsx`によるヘッドレス実行で以下を実測しました。

- run seed 7777、開始位置（日向）でSOL3・hammerRecovery=trueの状態でSpace：`consumed: true`、ログ「太陽光を吸収し、SOLが1回復した。」、SOL 3→4、**hammerRecoveryはtrueのまま維持**
- 日陰タイルへ移動しhammerRecovery=trueでSpace：`consumed: true`、SOL変化なし（ログなし）、hammerRecoveryはfalseへクリア
- 満タン状態（SOL5）で日向タイルにてhammerRecovery=trueでSpace：`consumed: true`、SOL変化なし（ログなし）、hammerRecoveryはfalseへクリア

太陽銃テスト（`phase-09-2-solar-gun.test.ts`全64件）で無回帰を確認しました。Playwright（Chromium、`dist/`をローカルHTTPサーバ配信）でビルド済みゲームを起動し、コンソールエラー0件を確認しました。実際のブラウザ操作でのチャージモーション再生条件（日向成功時のみ）の目視確認、日陰・満タン時にモーションが出ないことの目視確認、Space連打時の二重チャージが起きないことの実操作確認、Vキーを押してもゲームに変化が起きないことのブラウザ上での確認、太陽銃の実射撃操作でのブラウザ確認は今回未実施です。

## 今回実装しなかった要素

エンチャント、太陽銃カスタマイズ、バッテリー、天候・時刻連動、自然回復（移動によるものを含む）はいずれも実装していません。現在のゲームは引き続き3フロアのみの試作です。SOL回復量1・最大値5は本フェーズ時点の暫定値であり、最終確定したものではありません。

## 完了可否

Phase 09.3bは完了。
