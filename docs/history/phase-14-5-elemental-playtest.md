# Phase 14.5 属性システム試遊準備

## 目的

Phase 14.1〜14.4で実装した五属性エンチャントシステム（型・取得・選択・
戦闘効果・敵相性）を、通常のゲーム開始操作から3フロアを人間が試遊できる
状態に仕上げる。属性の取得・選択・発動・相性・SOL消費を画面上で判断でき
るようにし、試遊後は既存telemetry v7を取得して評価できるようにする。
今回は表示・記録・導線の整備に限定し、数値調整は一切行わない。

## precheck結果

- 開始時point: local HEAD = origin/main = `42de0177311240e6289dddd84060c703841596d8`
- working tree: clean
- 既存テスト: 64ファイル、1628件、全成功
- `npx tsc --noEmit` / `npx vite build`: 成功
- 全条件一致を確認した上で、mainから作業ブランチ
  `phase-14-5-elemental-playtest` を作成した。

## Phase 14.1～14.4の現状監査

- **型・共通計算（Phase 14.1）**: `ElementId`/`ElementalAffinity`、
  `computeElementalDamage`、`ELEMENTAL_AFFINITY_PERCENT`（weak150/
  neutral100/resist50）は無変更のまま維持されていることを確認。
- **取得・選択・切替（Phase 14.2）**: flame/frost/cloud/earthの専用
  ground itemがfloor1〜3へ配置済み、`unlockedEnchantments`、Fキーでの
  `none→sol→flame→frost→cloud→earth→none`循環が実装済みであることを
  確認。
- **戦闘効果（Phase 14.3）**: `ELEMENT_ENCHANT_ELIGIBLE_WEAPONS`
  （sword/spear/hammer）、属性別SOL消費（sol=1、他4属性=2）、ココロ
  補正（`10 + mindRank`）、`sol_enchantment_used`/
  `element_enchantment_used`の役割分離が実装済みであることを確認。
- **敵相性（Phase 14.4）**: 9敵の確定相性表（weak5件、resist0件、
  frost weak0件）が`enemy-def.ts`に反映済みであることを確認。
- **UI**: `main.ts`のHUDに選択中エンチャント表示（`enchantHudLabel`）
  が既に存在。`showEndScreen`にJSON telemetry exportボタンが既に存在
  し、勝利・敗北どちらの画面からも呼び出せる状態だった。
- **ログ**: `message-log.ts`の`sol_enchantment_used`/
  `element_enchantment_used`ケースは、weak/neutral/resistを区別せず
  常に同一文言を返す状態だった（Phase 14.1/14.3のコメントで「Phase
  14.5へ持ち越す」と明記されていた項目）。

## 試遊を妨げていた不足点

1. **weak/neutral/resistのログ区別がない**: 攻撃が弱点を突いたのか
   通常命中なのか、メッセージログの文言だけでは判別できなかった。
2. **SOL不足表示がsol専用だった**: HUDの`ENCHANT：〜（SOL不足）`表示は
   solの消費量1だけを基準にしており、消費2の他四属性でSOLが1しか無い
   （発動条件を満たさない）状態を正しく表示できていなかった。
3. **解禁済み属性の一覧が見えない**: HUDは「現在選択中」の1つしか表示
   せず、Fキーで他にどの属性へ切り替えられるかを見るには実際にFを
   何度も押すしかなかった。
4. **操作説明に属性の仕組みの記載がない**: HUD下部の操作説明にFキー
   の存在は書かれていたが、「専用アイテムを踏むと解禁される」「命中で
   SOLを消費する」という前提知識がなく、既存プレイヤーが読んでも仕組み
   を推測しづらかった。

telemetry exportは既に通常UI（勝利・敗北画面のボタン）から利用可能で、
コンソール操作は不要だったため、この項目は追加実装しなかった。

## 実装した最小限の改善

- `src/game/message-log.ts`: `sol_enchantment_used`と
  `element_enchantment_used`の両方で、`affinity`が`weak`なら
  「〜が弱点を突いた！」、`resist`なら「〜が軽減された。」、`neutral`
  なら既存どおり「〜が攻撃に宿った。」を返すよう分岐した。
- `src/game/turn.ts`: `ELEMENT_ENCHANTMENT_SOL_COST`（属性別SOL消費の
  唯一の定義）を`export`し、UI側が値を再定義せず同じ表を参照できるよう
  にした。
- `src/game/element-def.ts`: `ALL_ELEMENT_IDS`（五属性の固定順配列）を
  追加し、UI側が属性を列挙する際の唯一の情報源とした。
- `src/main.ts`:
  - `enchantHudLabel()`のSOL不足判定を、sol固定の`<= 0`から
    `solarEnergy < ELEMENT_ENCHANTMENT_SOL_COST[selectedEnchantment]`
    へ一般化し、選択中の属性に応じた正しい閾値でSOL不足を表示するよう
    にした。
  - `unlockedElementsHudLabel()`を新設し、`解禁：ソル・フレイム`の
    ように現在解禁済みの属性を一覧表示するHUD行を追加した（何も解禁
    されていなければ`解禁：未解禁`）。
  - HUD最下部の操作説明に「エンチャントは足元の専用アイテムを踏むと
    解禁されます。Fで解禁済みの属性を切り替え、命中時にSOLを消費して
    発動します。」という1行を追加した。

## 変更しなかった既存仕様

- 属性ダメージ倍率（weak150%/neutral100%/resist50%）
- 属性別SOL消費量（sol=1、他4属性=2）
- ココロrank補正式（`10 + mindRank`）
- 属性の取得条件・取得タイミング・フロア配置
- 9敵の相性表（weak5件、resist0件、frost weak0件）
- 敵能力値、AI、出現率
- 武器能力値、SOL最大値、チャージ量、日照処理
- telemetry schema（schemaVersion 7、export名v7、event payload構造）
- 既存のtelemetry exportボタン自体の実装（勝利・敗北両方から利用可能、
  state/RNGを変更しない、複数回実行しても内容が増殖しない、という既存
  挙動をそのまま維持。実装追加なし）

## 自動テスト結果

新規`phase-14-5-elemental-playtest.test.ts`（18件）: weak/neutral/
resistの文言分岐（sol・他4属性それぞれ）、`ALL_ELEMENT_IDS`と
`ELEMENT_ENCHANTMENT_SOL_COST`のエクスポート整合性を検証。

既存テストの更新: `phase-14-4-enemy-affinities.test.ts`の1件
（「message log renders a weak hit using the existing shared wording」）
が、Phase 14.4当時の共通文言を検証していたため、Phase 14.5で追加した
weak専用文言（「フレイムの力が弱点を突いた！」）を検証するよう更新した。

既存65ファイル1646件（新規含む）を含む全体テスト: **65ファイル、1646
件、全成功**。`npx tsc --noEmit`: 成功。`npx vite build`: 成功。
`git diff --check`: 問題なし。

## 手動3フロア試遊結果

ブラウザでの操作確認は、Playwrightによるヘッドレス自動操作とスクリー
ンショット目視確認を組み合わせて実施した：

- `vite build`のdist出力を`python3 -m http.server`で配信し、Playwright
  (Chromium)で読み込み。canvas描画・コンソールエラー0件を確認。
- 移動・攻撃・エンチャント切替・インベントリ開閉・待機のキー入力を
  ランダムに400回、複数回のN（新規ラン）リスタットを挟みながら実行し、
  未処理例外やクラッシュが発生しないことを確認（
  `manual_playtest_check`の「ブラウザコンソールに未処理エラーがない
  こと」「表示崩れ、操作不能、フロア進行不能がないこと」に対応）。
- 移動＋Fキー操作後のスクリーンショットを拡大確認し、HUDに
  `ENCHANT：未取得`、`解禁：未解禁`、新設した操作説明行が正しく
  レンダリングされていることを目視確認した。
- 属性取得物を実際に踏んでweak対象へ攻撃し、ログ・telemetryの実際の
  対応を確認する「意図した一連の行動」を伴う3フロア完走は、座標を
  盲目的に操作するヘッドレススクリプトでは再現性高く実施することが
  難しいため、**この工程は人間による実際のプレイに委ねる**（
  `phase_policy`の「Phase 14.5完了後にユーザーが実際にテストプレイ
  する」という区分に対応）。そのため本HTML出力を試遊用に添付した。

## telemetry export確認

- 既存の`exportTelemetryJson()`（`showEndScreen`のボタン経由）を変更
  せず、勝利・敗北どちらの画面からも呼び出せることをコード確認した。
- `buildTelemetryDocument`は`this.state`/`this.telemetry`を読むだけで
  変更しないこと、同一runで複数回呼び出しても同じ内容を返すことは
  既存テスト（`phase-10-3-1-telemetry.test.ts`の重複export比較テスト
  等）で担保されている。
- schemaVersion 7、export名`rogue-of-sun-run-v7-...`は無変更。

## 現行バランスbaseline

playtest_baseline_to_preserveのとおり、本フェーズ開始時点の数値を変更
せずに維持した：

| 項目 | 値 |
|---|---|
| SOL消費（sol） | 1 |
| SOL消費（flame/frost/cloud/earth） | 各2 |
| 相性倍率（weak/neutral/resist） | 150%/100%/50% |
| bok | sol weak |
| cockatrice | earth weak |
| mummy | flame weak |
| golem | cloud weak |
| kraken | flame weak |
| spider / bat / sword / axe | 全属性neutral |
| resistを持つ実敵 | 0体 |
| frost弱点の実敵 | 0体 |

## 試遊時に確認すべき項目

- 3フロアを通して五属性すべて（flame/frost/cloud/earth、既存のsol含む）
  を実際に取得できるか。
- weak対象（bok+sol、cockatrice+earth、mummy+flame、golem+cloud、
  kraken+flame）への攻撃で、新設したweak専用ログ文言とHUD表示が
  意図通りか。
- SOL不足（特にコスト2の他四属性でSOLが1だけ残っている状態）での
  不発表示が、通常のneutral命中と混同されないか。
- 解禁済み属性一覧の表示が、実際のプレイ中に十分な頻度・タイミングで
  目に入るか。
- telemetry exportしたJSONの内容（属性使用回数、affinity別ダメージ、
  SOL消費）が、実際にそのrunで行った操作と一致しているか。

## 数値調整を保留した項目

- flame/frost/cloud/earthのSOL消費2という値の妥当性。
- weak倍率150%・resist倍率50%の妥当性。
- ミンドrank補正（+1ダメージ/rank）の妥当性。
- 9敵の弱点分布（frost弱点0件を含む）の妥当性。

上記はいずれも、人間による実際の試遊結果が出るまでこのフェーズでは
変更していない（`phase_policy`のとおり）。

## 開発計画への反映

このリポジトリには、フェーズ進捗を管理する専用の「開発計画ファイル」
は存在しない（`docs/history/`配下の各フェーズ履歴文書と
`docs/rogue-of-sun-game-concept.md`という設計コンセプト文書のみが
存在し、後者にはフェーズ進捗欄が無い）。フェーズ全体の正本の開発計画は
リポジトリ外（ChatGPT側）で管理する運用のため、本タスクではリポジトリ
内の開発計画ファイルへの更新は行っていない。

## Phase 15へ未着手であること

新しい属性の追加、ルナ・ダーク属性、フロスト弱点やresistを持つ敵の
追加、属性固有効果・状態異常、完成版演出（画像・アニメーション・
パーティクル・音声）にはいずれも着手していない。
