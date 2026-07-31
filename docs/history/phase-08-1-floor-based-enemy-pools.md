# Phase 08.1 階層別敵出現テーブル

## 目的

Phase 07.6の人間によるプレイテストを受け、通常敵の出現候補をフロアごとに段階的に解禁します。1Fをボクとバットだけに限定し、初期状態でも探索を継続できるようにします。敵のHP、攻撃力、特殊行動、出現数、配置規則は変更しません。

## 開始時のHEAD

`6ec115f6e838fab0706efdacaab44dd0982c43d1`（origin/mainと一致、working tree clean）

## 調査した既存の敵生成経路

- `src/game/enemy-def.ts`：`ENEMY_DEFINITIONS`（各敵の正式なhp/attack/behaviorType等）と`ENEMY_TYPES_IN_ORDER`（9種の固定順序）。
- `src/game/state.ts`の`chooseSpecies(count, rng)`：フロア生成時、`ENEMY_TYPES_IN_ORDER`全体から`rng()`で1体ずつ独立抽選していました（重複あり）。
- `src/game/state.ts`の`buildFloorState`：`choosePlacement`で敵の配置座標（`ENEMY_COUNT_PER_FLOOR = 2`）を決定するRNGストリームと、`chooseSpecies`用のRNGストリーム（`floorSeed ^ 0x8f3c9d21`）は独立しており、敵種選択が配置座標の決定性に影響しないことを確認しました。
- `src/game/mapgen.ts`の`choosePlacement`：座標のみを返し、敵種は関知しません。
- `floor`番号は`buildFloorState`の引数としてすでに保持されており、`createInitialState`（floor=1固定）と`advanceToNextFloor`（`state.floor + 1`）から渡されます。
- `buildRosterPreviewFloorState`（テスト/開発専用、全9種を1体ずつ強制配置）は`forcedSpecies`引数でチョイス処理自体を迂回しており、今回の変更の影響を受けないことを確認しました。

## 採用した階層別候補集合

累積解禁方式を採用しました（フロア数が上がるほど候補が増え、既存の候補が外れることはありません）。

| フロア | 候補集合 |
|---|---|
| 1F | ボク、バット |
| 2F | ボク、バット、スパイダー |
| 3F | ボク、バット、スパイダー、コカトリス、マミー |
| 4F | ボク、バット、スパイダー、コカトリス、マミー、ソード、アックス |
| 5F以降 | 全9種（上記＋ゴーレム、クラーケン） |

候補内の選択確率は既存方式どおり均等選択のままです。新しい重み付けや出現保証は追加していません。

## 実装した正式な定義位置

`src/game/enemy-def.ts`に以下を追加しました。

- `ENEMY_FIRST_APPEARANCE_FLOOR: Record<EnemyType, number>`：各敵種の初出階を宣言的に保持する単一のテーブル。
- `getEnemyPoolForFloor(floor: number): EnemyType[]`：指定フロアで解禁済みの敵種を`ENEMY_TYPES_IN_ORDER`の順序で返す、読み取り専用の単一の正式な定義。

switchの分岐に敵名を重複記述する設計は避け、初出階テーブル＋フィルタという宣言的な形にしました。既存設計（`ENEMY_TYPES_IN_ORDER`を正とする順序管理）とも整合します。

`src/game/state.ts`の`chooseSpecies`は、第3引数として候補プール（`EnemyType[]`）を受け取るように変更しました。`ENEMY_TYPES_IN_ORDER`固定参照をやめ、呼び出し元が`getEnemyPoolForFloor(floor)`の結果を渡すようにしています。RNGの消費順序（1体につき`rng()`を1回、既存のスロット順）は変更していません。`buildFloorState`内で`floorPool = getEnemyPoolForFloor(floor)`を計算し、`forcedSpecies`が指定されていない通常経路でのみこのプールを使用します。

## 変更ファイル

- `src/game/enemy-def.ts`：`ENEMY_FIRST_APPEARANCE_FLOOR`、`getEnemyPoolForFloor`を追加（既存のエクスポートは変更なし）。
- `src/game/state.ts`：`chooseSpecies`にプール引数を追加し、`buildFloorState`でフロア別プールを渡すよう変更。
- `src/game/__tests__/enemy-type.test.ts`：フロア1が全9種から抽選される前提だった既存2件を、フロア別プール前提に更新（後述）。
- `src/game/__tests__/floor-enemy-pools.test.ts`：新規追加。
- `docs/history/phase-07-6-normal-enemy-human-playtest.md`：新規追加。
- `docs/history/phase-08-1-floor-based-enemy-pools.md`：本ファイル。

## 既存テストの更新内容

`enemy-type.test.ts`の以下2件は、フロア1で9種全部が候補になっていた旧仕様を前提にしていたため、今回の仕様変更と直接衝突していました。

- 「always generates exactly 2 enemies per floor, each a valid roster species」→ そのフロアの`getEnemyPoolForFloor`結果内に収まることを確認する内容に変更。
- 「makes every one of the 9 species a reachable normal-spawn outcome across enough seeds」→ フロア1の解禁プール（ボク・バットのみ）だけが出現し、それ以外は出現しないことを確認する内容に変更。

上記以外の既存テスト（`enemy-roster-foundation.test.ts`等）は、`buildRosterPreviewFloorState`（`forcedSpecies`使用）や敵個別の能力値・挙動を検証するものであり、今回の変更の影響を受けないため変更していません。

## 追加したテスト（`floor-enemy-pools.test.ts`）

- 1F〜4Fの厳密な候補集合一致、5F・6Fが全9種であることの決定的テスト。
- 各フロアで未解禁の敵種が候補集合に含まれないことの排他テスト。
- 累積解禁（前フロアの候補集合が次フロアの部分集合であること）の確認。
- `createInitialState`／`advanceToNextFloor`による実際の生成結果が、複数seedにわたり該当フロアの候補集合内に収まることの統合テスト（1F単体、および1F→2F→3Fの遷移）。
- 同一seed・同一フロアで敵種構成が再現されることの決定性テスト。
- 敵数が引き続き2体であることの確認。
- マップ生成・配置座標の決定性が敵種プール制限の影響を受けていないことの確認。

ランダム試行から出現確率を推定するテストや、偶然の出現待ちをするテストは追加していません。

## 検証結果（自動）

- `npx tsc --noEmit`：エラー0件。
- `npx vitest run`：**31ファイル / 376件**、全成功（既存360件＋新規16件）。
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし。
- `git diff --check`：成功（末尾空白・改行混在等の問題なし）。
- `package.json`／`package-lock.json`：差分なし。

## 維持していることの確認

- 敵の性能（HP・攻撃力・特殊行動・移動能力）：`enemy-def.ts`内の各`ENEMY_DEFINITIONS`エントリは変更していません。
- 敵数：`ENEMY_COUNT_PER_FLOOR = 2`は変更していません。
- 配置規則：`choosePlacement`は変更していません。
- 回復・武器：実装していません（今回のスコープ外）。
- 過去履歴（`docs/history/`内の既存ファイル）：書き換えていません。

## 今回の位置づけ

今回の出現テーブルは、成長要素（回復・武器・経験値等）が未実装の段階での暫定構成です。5F以降のバランスや、1Fが最終的に適正難度になったとは断定していません。次の候補としては、最低限の回復導線の検討が挙げられますが、今回のcommitには含めていません。
