# gameVersion運用方針の明文化と更新（maintenance-game-version-policy）

## baseline

main、HEAD `99edfe7528df489e8d71f9b1769fe30b74676efe`「chore: complete phase 18 trap integration」。

## 問題

`src/game/telemetry.ts`の`buildTelemetryDocument`が出力する`TelemetryDocument.gameVersion`が
`'phase-12.3'`のまま固定されており、Phase 13〜17（experience/level、ability、五属性、SOL/戦闘バランス、
hunger/corridor調整、視界・暗い部屋、Phase 18の罠・千里眼・ミニマップ）を経てもmainへ何度も
機能統合が行われたにもかかわらず一度も更新されていなかった。telemetryのエクスポートJSONを見ても
どのPhase相当の挙動から記録されたデータかが実態と乖離した値でしか判別できない状態だった。

## gameVersionの実際の用途（監査結果）

- `src/game/telemetry.ts`の`buildTelemetryDocument`内、リテラル文字列として1箇所のみ存在
- `main.ts`の「テレメトリーをエクスポート」ボタン経由でJSON（`Blob`+`<a download>`）として
  ブラウザからダウンロードされる一方向の出力専用フィールドであり、**この値を読み込んで判定する
  処理はリポジトリ内に一切存在しない**
- セーブ／ロード機構自体がこのリポジトリに存在しない（`localStorage`等は使用していない）ため、
  gameVersionはセーブデータ互換性判定や再読込判定など、telemetryエクスポート以外のいかなる用途にも
  使われていないことを確認した
- 期待される結論（expected_conclusion）どおり、「実際に動作しているゲーム内容の開発マイルストーンを
  識別する値」として機能しており、production仕様上の破壊的影響なく変更可能と判断した

## schemaVersionの実際の用途（監査結果）

- `RunTelemetry.schemaVersion`（実行中の内部表現）と`TelemetryDocument.schemaVersion`
  （エクスポート時の表現）の両方に`7`という同一のリテラル型/値が使われている
- `buildExportFilename`が生成するファイル名にも`v7`という接頭辞として同じ値が現れる
  （`rogue-of-sun-run-v7-{seed}-{clear|death}.json`）
- 過去の更新履歴（コミットログ・doc comment）を確認したところ、schemaVersionは
  `RunEvent`/`RunSummary`のフィールド追加・意味変更（例: Phase 10.3.2の正しさ修正、
  Phase 12.3のpoisonソース追加、Phase 13.3cのability数値効果・速度アクションゲージ追加）など、
  **telemetry payloadの構造または解釈が変わった場合にのみ**更新されてきた
- gameVersion側の更新（10.3.1→10.3.2→10.3.3→12.3）と時期は重なる部分もあるが、
  1対1に連動しているわけではなく、Phase 13.3cのschemaVersion 6→7のタイミングでは
  gameVersionは更新されていない。両者は独立した軸であることを確認した

## 両者を独立管理する理由

- gameVersionは「どのゲーム内容から記録されたか」というプレイ内容の識別子であり、
  ゲームバランス調整や新機能追加など、payload構造に影響しない変更でも更新されうる
- schemaVersionは「このJSONをどう解釈すればよいか」という構造の識別子であり、
  ゲーム内容が変わってもフィールド構成が変わらなければ更新の必要がない
- 両者を単一の値に統合すると、ゲーム内容が変わるたびに無関係な構造互換性まで
  バージョンが上がったように見え、逆に構造が変わってもゲーム内容の変化が伴わない場合に
  区別できなくなる。それぞれ独立した更新トリガーを持たせることで、
  エクスポートされたJSONを読む側が「内容の新しさ」と「構造の解釈方法」を別々に判断できる

## 採用したgameVersion更新規則

- 形式は常に`'phase-<整数>'`（例: `'phase-18'`）。同一Phase内の小フェーズ番号
  （`.1`、`.2`など）は含めない
- 完成したPhase全体のproduction gameplayまたはtelemetryの意味に関わる変更が
  mainへ`--ff-only`で統合された時点でのみ更新する
- 1つのPhaseが複数のsub-phase branch（例: Phase 18.1/18.2/18.3）に分かれて作業される場合、
  Phase全体がmainへ統合されるまでは更新しない（sub-phase単位では更新しない）
- 文書・試遊HTML・テストのみの変更（production gameplayへの影響がないもの）では更新しない
- 同一Phase内の軽微な修正では、telemetry比較上明確に別バージョンとして扱う必要がない限り更新しない
- この規則は`src/game/telemetry.ts`の`TelemetryDocument.gameVersion`フィールドのdoc commentに
  そのまま明文化し、コード上でも参照できるようにした

## phase-12.3からphase-18への更新理由

Phase 18（罠の3状態、千里眼の実、telemetryのtrap_revealed/trap_triggered区別、ミニマップ表示）が
Phase 18.1〜18.3を経て`99edfe7528df489e8d71f9b1769fe30b74676efe`でmainへ完全統合済みであり、
上記規則における「完成Phase全体のmain統合」の条件を満たす最新の値であるため、`'phase-18'`へ更新した。

## Phase 13〜17で更新されていなかった事実

監査の結果、gameVersionはPhase 10.3.1で導入されたのち10.3.2・10.3.3・12.3の3回のみ更新され、
Phase 13（experience/level、ability point割り当て、ability数値効果、speed/action-gauge）、
Phase 14（五属性エンチャント基盤・取得・戦闘効果・敵属性相性・カメラ/ダッシュ）、
Phase 15（コア戦闘・recovery/satiety/poison・SOL/属性/ability・ランダム地上アイテム・
敵数調整・斜め攻撃ブロック）、Phase 16（早期バランス調整）、Phase 17（視界・探索記憶・暗い部屋）を
通じて一度も更新されていなかったことを確認した。これは明文化された更新規則が
これまで存在しなかったためであり、今回のPhase 18時点での更新は、その空白期間を埋めるための
1回限りの追いつき更新であると同時に、今後は今回定めた規則に従って各完成Phase統合時に
更新することを意図している。

## schemaVersionを変更しなかった理由

Phase 18のtelemetry変更（`trap_revealed`/`trap_triggered`イベントの追加、
`clairvoyance_used`の`item_used`型再利用）は、いずれも既存の`RunEventPayload`型の
union拡張であり、既存フィールドの意味変更や削除を一切伴っていない。
`RunSummary`の構造にも変更はない。したがって「telemetry payloadの構造および
解釈互換性の変更」という更新条件に該当せず、`schemaVersion: 7`のまま維持した。
今回のタスクでもgameVersion更新のみを理由にschemaVersionを更新することはしていない。

## 変更ファイル

- `src/game/telemetry.ts`: `gameVersion: 'phase-12.3'`を`gameVersion: CURRENT_GAME_VERSION`
  （新設した単一の定数`export const CURRENT_GAME_VERSION = 'phase-18'`）へ変更し、
  `TelemetryDocument.gameVersion`フィールドへ更新規則を明文化したdoc commentを追加した。
  値は重複して複数箇所に埋め込まれていなかったため、既存設計への追加変更は
  定数化のみで完結している
- `src/game/__tests__/phase-13-3c-ability-ui-telemetry.test.ts`: 既存のschemaVersion 7検証
  テスト群と同じファイル内に、production のtelemetry生成経路（`createRunTelemetry`→
  `processTurn`→`recordTurn`→`buildTelemetryDocument`）を通してgameVersionが
  `'phase-18'`になることを検証する新規テスト2件を追加。実装内部を直接検査するのではなく、
  既存形式に合わせて生成結果（`TelemetryDocument`）を検査する形にした

新規テストファイルは作成していない（既存ファイルへ自然に追加できたため）。

## 自動検証結果

- targeted: `phase-13-3c-ability-ui-telemetry.test.ts`（36件）、telemetry関連既存テスト
  （`phase-10-3-1-telemetry.test.ts`、`phase-10-3-2-telemetry-fix.test.ts`、
  `phase-10-3-3-damage-recovery-fix.test.ts`、`phase-10-3-3a-healing-field-rename.test.ts`、
  `phase-18-2-telemetry.test.ts`、計130件）を実行し全通過
- full: `npx vitest run` → 84ファイル / 1954テスト全通過（Phase 18統合時点の1952件から2件増）
- `npx tsc --noEmit` → エラーなし
- `npx vite build` → ビルド成功
- build後、`gameVersion: 'phase-12.3'`のリテラルがproduction code中に残っていないことを確認
  （`'phase-12.3'`という文字列は、新設したdoc comment内の歴史的記述としてのみ残存）
- `schemaVersion: 7`が変更されていないことを確認
- package.json/package-lock.jsonに差分がないことを確認

## main統合結果

全検証成功後、`maintenance-game-version-policy`ブランチ上で単一commit
「chore: define telemetry game version policy」を作成し、mainへ`--ff-only`で統合、
`origin/main`へ通常pushした（詳細ハッシュは本コミット後にコミットメッセージ／
リポジトリのログを参照）。
