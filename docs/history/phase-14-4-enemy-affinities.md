# Phase 14.4 敵属性相性設定

## 目的

Phase 14.1で実装したweak/neutral/resist構造を実際の敵定義へ適用し、9種
の実敵へ確定した五属性相性を設定する。weakは指定5件のみとし、resistは
今回設定しない。フロスト弱点が0件であることは意図した仕様として維持す
る。Phase 14.3の属性攻撃・イベント・ログ・telemetryは既存の共通計算
（`ENEMY_DEFINITIONS[target.type].elementalAffinities`参照）を通じて
自動的にこの新しい相性を反映し、`turn.ts`側の実装変更は一切行わない。

## precheck結果

- 開始時point: local HEAD = origin/main = `928cedb85284d4acecc8b9d5a8d9f990f9d7dc3e`
- working tree: clean
- 既存テスト: 63ファイル、1579件、全成功
- `npx tsc --noEmit` / `npx vite build`: 成功
- `enemy-def.ts`に対象9敵と五属性neutralの定義が存在すること、
  `computeElementalDamage`とweak/neutral/resist倍率（150/100/50）が
  Phase 14.1完了時のままであること、Phase 14.3の属性発動対象
  （sword/spear/hammer）・属性基礎値（10）・SOL消費（sol=1、他4属性=2）
  ・ココロ補正・戦闘解決順序が完了報告どおりであること、
  `sol_enchantment_used`と`element_enchantment_used`の役割分離、
  telemetryのschemaVersion 7・export名v7を確認した。
- 全条件一致を確認した上で、mainから作業ブランチ
  `phase-14-4-enemy-affinities` を作成した（同名の既存local/remote
  ブランチなし）。

## 変更前の敵相性定義

Phase 14.1〜14.3時点では、9種の実敵（bok, cockatrice, spider, bat,
mummy, golem, sword, axe, kraken）全てが五属性（sol/flame/frost/cloud/
earth）すべてneutralだった。

## 実装した9敵×五属性の相性表

| 敵 | sol | flame | frost | cloud | earth |
|---|---|---|---|---|---|
| bok | **weak** | neutral | neutral | neutral | neutral |
| cockatrice | neutral | neutral | neutral | neutral | **weak** |
| spider | neutral | neutral | neutral | neutral | neutral |
| bat | neutral | neutral | neutral | neutral | neutral |
| mummy | neutral | **weak** | neutral | neutral | neutral |
| golem | neutral | neutral | neutral | **weak** | neutral |
| sword | neutral | neutral | neutral | neutral | neutral |
| axe | neutral | neutral | neutral | neutral | neutral |
| kraken | neutral | **weak** | neutral | neutral | neutral |

weak合計5件、resist合計0件、frost weak合計0件。

## 各弱点およびneutral設定の根拠

- **bok → sol weak**: グール系統として扱い、資料上のグール系のソル
  弱点を採用した。
- **cockatrice → earth weak**: ゾクタイのコカトリスを参照し、アース
  弱点を採用した。
- **spider → 全属性neutral**: ゾクタイ資料では属性弱点なし。スパイダー
  を敵ロースターから削除せず、五属性neutralのまま維持した。
- **bat → 全属性neutral**: ゾクタイのバットを参照し、属性弱点なし。
- **mummy → flame weak**: 初代ボクタイのマミーを参照し、フレイム弱点
  を採用した（ゾクタイ側のソル弱点は今回採用していない）。
- **golem → cloud weak**: ゾクタイのクレイゴーレム相当として扱い、
  クラウド弱点を採用した。
- **sword → 全属性neutral**: 原作上の弱点は武器系統に関するものであり、
  属性弱点へ置換していない。
- **axe → 全属性neutral**: 原作上の弱点は武器系統または攻撃方法に
  関するものであり、属性弱点へ置換していない。
- **kraken → flame weak**: ゾクタイのオクトパス相当として扱い、
  フレイム弱点を採用した。

属性分布を均等化する目的での推測弱点追加は行っていない（フロスト弱点が
0件であることを仕様誤りとして扱っていない）。将来フロスト弱点を設ける
場合は、敵バリエーションまたは新規敵で検討することとし、Phase 14.4では
追加しなかった。原作資料から確定できないresistは設定せず、resist機構
自体は将来用としてそのまま維持した。

## スパイダーを維持して全属性neutralとしたこと

`affinity_policy`の「スパイダーを定義、出現対象、テスト対象から削除し
ない」に従い、`enemy-def.ts`のspider定義・`ENEMY_TYPES_IN_ORDER`・出現
テーブルはいずれも変更していない。相性値も全属性neutralのまま。

## マミーをフレイム弱点にしたこと / クラーケンをフレイム弱点にしたこと

いずれも上記の根拠どおり、初代ボクタイのマミーおよびゾクタイのオクト
パス相当としてフレイム弱点を採用した。

## 属性ダメージ、物理ダメージ、SOL消費への反映結果

`turn.ts`の`applyPlayerAttackToEnemy`は変更していない。Phase 14.3で
実装済みの`ENEMY_DEFINITIONS[target.type].elementalAffinities[element]`
参照が新しい相性値を自動的に読み取るため、実装コードへの変更は
`enemy-def.ts`の相性値だけで完結する。実際の攻撃経路でのテスト結果：

- bok+sol、cockatrice+earth、mummy+flame、golem+cloud、kraken+flame
  のいずれも、`computeElementalDamage(10, 'weak') = 15`が
  `sol_enchantment_used`/`element_enchantment_used`のペイロード
  （`bonusDamage`/`elementalDamage`）へ正しく反映される。
- physicalDamage（`baseDamage`）はweak/neutralで完全に同一（bok+sol
  とspider+solを比較して確認）。
- ミンド rank5でmummy+flameを攻撃すると、`floor(15 * 150 / 100) = 22`
  になることを確認（ココロ補正後の基礎値へ相性倍率が適用される順序）。
- weak倍率で撃破しても`enemy_defeated`が1回だけ発火し、`targetHpAfter`
  が0でクランプされることを確認。

## ミス、空振り、SOL不足、RNG順序の回帰結果

- weak対象（bok+sol）でもSOL消費は引き続き1、mummy+flameのような
  weak・4属性でも引き続き2であることを確認。
- ミス時（`player_attack_missed`）は相性に関係なくSOL非消費・属性
  イベント非発生であることを確認。
- 空振り（対象不在）ではcombat RNGが消費されないことを確認
  （`combatRngState`が不変）。
- 相性設定によって命中判定・combat RNG呼び出し位置や回数は変更されて
  いない（`turn.ts`への変更なし）。

## イベント、ログ、telemetryへの反映結果

- `sol_enchantment_used`・`element_enchantment_used`のイベント名・
  payload構造・発生位置・件数はPhase 14.3から無変更。weak攻撃時は
  `affinity: 'weak'`、非弱点攻撃時は`affinity: 'neutral'`が正しく
  payloadへ入ることをテストで確認。
- 両イベントが同一ヒットで重複発生しないことを確認。
- message logは既存の共通文言（`${属性名}の力が攻撃に宿った。`）を
  weak時もそのまま使用しており、専用のweak文言は追加していない。
- telemetryの`additionalDamage`へ相性適用後の値（例: mummy+flameで
  15）が入ることを確認。

## telemetry v7を維持したこと

`schemaVersion: 7`、エクスポートファイル名`rogue-of-sun-run-v7-...`は
無変更。`telemetry.ts`自体への変更は行っていない。

## 既存Phase 14.3テストの更新箇所

bokをデフォルト攻撃対象として使っていた既存テスト（Phase 10.1〜14.3の
複数ファイル）が、bokの新しいsol weak化によって「neutral時の固定値
10」という前提が崩れて失敗したため、以下の対応を行った：

- `phase-10-1-sol-enchant.test.ts`（3件）、`phase-10-2-combat-stat-
  scale.test.ts`（1件）、`phase-10-3-1-telemetry.test.ts`（1件）、
  `phase-10-3-3-damage-recovery-fix.test.ts`（1件）、`phase-12-1-
  temporary-effect-banana.test.ts`（1件）: 対象敵をbokから、全属性
  neutralのまま変わらないspiderへ差し替え（アサーション自体は無変更）。
- `phase-14-1-element-foundation.test.ts`: 「全敵が五属性neutral」と
  いうPhase 14.1当時の事実を検証していた1テストを、「五属性すべてに
  有効なElementalAffinity値が入っている」という構造検証へ更新（bok/
  spider差し替えが必要だった2テストは同様にspiderへ差し替え）。
- `phase-14-2-element-acquisition-selection.test.ts`（1件）: 同様に
  bokからspiderへ差し替え。
- `phase-14-3-element-combat-effects.test.ts`: 「全敵が五属性neutral」
  というPhase 14.3当時の事実を検証していた1テストを、本Phase 14.4の
  確定相性表と照合するテストへ更新（bok使用の1テストはspiderへ
  差し替え）。

いずれも数値計算アサーション自体・取得/解禁/切替/telemetry互換等の
既存仕様は変更しておらず、対象敵の選び方（あるいは相性表そのものの
期待値）だけを新しい確定表に合わせて更新した。

## 新規および更新テストの内容

新規`phase-14-4-enemy-affinities.test.ts`（49件）: 相性表の完全一致
検証、9敵構成維持、weak5件/resist0件/frost0件の集計検証、5つのweak
組み合わせと4つのneutral専用敵の実攻撃経路検証、ミンドrank併用検証、
撃破判定検証、SOL消費・ミス・RNG非干渉検証、イベント/ログ/telemetry
統合検証。

## 全テストファイル数、件数、結果

64ファイル、1628件、全成功（既存1579件 + 新規49件）。
`npx tsc --noEmit`: 成功。`npx vite build`: 成功。`git diff --check`:
問題なし。

## 変更ファイル一覧

- `src/game/enemy-def.ts`: 9敵の`elementalAffinities`を確定表へ更新
  （5敵の値変更＋9敵全てへ根拠コメント追加）
- `src/game/__tests__/phase-10-1-sol-enchant.test.ts`: 対象敵をbokから
  spiderへ変更（3箇所）
- `src/game/__tests__/phase-10-2-combat-stat-scale.test.ts`: 同上
  （1箇所）
- `src/game/__tests__/phase-10-3-1-telemetry.test.ts`: 同上（1箇所）
- `src/game/__tests__/phase-10-3-3-damage-recovery-fix.test.ts`: 同上
  （1箇所）
- `src/game/__tests__/phase-12-1-temporary-effect-banana.test.ts`:
  同上（1箇所）
- `src/game/__tests__/phase-14-1-element-foundation.test.ts`: 旧
  「全敵neutral」テストを構造検証へ更新、2箇所で対象敵をspiderへ変更
- `src/game/__tests__/phase-14-2-element-acquisition-selection.test.ts`:
  対象敵をbokからspiderへ変更（1箇所）
- `src/game/__tests__/phase-14-3-element-combat-effects.test.ts`: 旧
  「全敵neutral」テストを確定相性表との照合へ更新、1箇所で対象敵を
  spiderへ変更
- `src/game/__tests__/phase-14-4-enemy-affinities.test.ts`（新規）:
  本フェーズの検証テスト
- `docs/history/phase-14-4-enemy-affinities.md`（新規、本文書）

`turn.ts`、`combat.ts`、`events.ts`、`message-log.ts`、`telemetry.ts`
への変更は一切行っていない（`enemy-def.ts`の相性値だけで反映される
ことを確認済み）。

## unrelatedな変更がないこと

dependency・package-lock・Pages・deployment設定・敵能力値（HP/攻撃/
防御/命中/回避/経験値）・武器能力値・SOL最大値/チャージ/日照処理・
属性選択UIへの変更は一切行っていない。

## Phase 14.5へ未着手であること

weak/resist専用ログ文言、ダメージ内訳の詳細表示、完成版演出（Phase
14.5相当）には着手していない。
