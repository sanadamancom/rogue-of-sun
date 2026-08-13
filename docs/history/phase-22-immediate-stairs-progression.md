# Phase 22: 階段即時進行への仕様変更（鍵システム廃止）

## 決定

Phase 22.1として計画されていた「各階の鍵持ち敵→鍵ドロップ→鍵回収→鍵による階段解放」
の実装は行わない。代わりに、以下の仕様を採用する。

- 階段はフロア生成時点から利用可能。
- プレイヤーが階段タイルへ到達すれば、生存している敵の有無に関係なく次階へ進む。
- floor 3の階段へ到達すれば、生存している敵の有無に関係なくVictoryとなる。

理由：

- シレン型の「探索を続けるか、階段で撤退するか」という判断を維持するため。
- 敵探索・全滅を毎階の義務にせず、アイテム・装備・カード・経験値・モンスターハウス報酬を
  探索継続の任意報酬とするため。

鍵持ち敵、鍵ドロップ、鍵取得、鍵による出口解放を対象とした先行指示（Phase 22.1）は実行して
いない。着手前の状態確認の結果、鍵関連の未完成branchや変更は存在しなかった。

## 変更前の全敵撃破条件

`src/game/turn.ts`の`processTurn`内、フロア遷移判定の直前に以下があった。

```ts
const reachedExit = state.player.pos.x === state.exit.x && state.player.pos.y === state.exit.y;
const stairsUnlocked = state.enemies.every((enemy) => !enemy.alive);
...
} else if (reachedExit && stairsUnlocked) {
  state.phase = state.floor >= state.totalFloors ? 'victory' : 'floor_cleared';
}
```

`stairsUnlocked`は、その階の全敵（monsterHouse由来の敵を含む`state.enemies`全体）が
死亡していることを要求していた。

## 採用した階段進行条件

`stairsUnlocked`判定を削除し、`reachedExit`のみで進行判定を行う。ただし、`fixed_specification.
trigger`の「プレイヤーの成立した移動が階段タイル上で終了した場合に進行判定する」を維持するため、
以下のガードを追加した。

```ts
const wasOnExitBeforeAction =
  posBeforeAction.x === state.exit.x && posBeforeAction.y === state.exit.y;
const reachedExit =
  (actualMoveHappened || wasOnExitBeforeAction) &&
  state.player.pos.x === state.exit.x &&
  state.player.pos.y === state.exit.y;
...
} else if (reachedExit) {
  state.phase = state.floor >= state.totalFloors ? 'victory' : 'floor_cleared';
}
```

`wasOnExitBeforeAction`は、ターン開始時点で既に階段タイル上にいた場合（フロア遷移直後の
状態や既存テストのテレポート方式のセットアップ）を許容するためのもの。`actualMoveHappened`
は、このターンでプレイヤー自身の`move`アクションによって実際に位置が変化したことを表す
（既存の`slow_trap`関連ロジックで既に使われていた変数を流用）。

これにより、敵フェーズ中の受動的な移動（例：クラーケンの触手による引き寄せ）だけで階段タイル
へ到達しても、それ単体では進行しない（`enemy-behavior-kraken.test.ts`の既存テストで検証）。

## gameoverとフロア遷移の優先順位

変更していない。既存どおり：

```ts
if (playerDefeated) {
  state.phase = 'gameover';
} else if (reachedExit) {
  state.phase = state.floor >= state.totalFloors ? 'victory' : 'floor_cleared';
}
```

`playerDefeated`が優先されるため、階段到達ターンに敵から攻撃されて死亡した場合は
`gameover`となり、フロア進行は発生しない。

## 階段到達ターンの処理順

変更していない。プレイヤー行動 → 敵行動解決 → 飢餓/毒などの状態処理 → プレイヤー死亡判定 →
自然回復 → エフェクト経過 → `reachedExit`判定 → ターン数加算 → web寿命更新 →
`gameover`/`floor_cleared`/`victory`確定、という既存の順序をそのまま維持している。
階段利用のための追加ターン消費、敵の二重行動、確認ダイアログはいずれも追加していない。

## モンスターハウス未攻略時の進行

`state.map.monsterHouse`が`hidden`または`revealed`のいずれでも、また`spawnSource:
'monster_house'`の敵が生存していても、階段到達によるフロア進行は妨げられない
（`phase-22-immediate-stairs-progression.test.ts`で検証）。モンスターハウスの生成・発覚・
報酬ロジック自体は変更していない。次階へ進んだ場合、前階の`monsterHouse`状態・敵・罠・
groundItemは既存の`advanceToNextFloor`/フロア再生成ロジックにより破棄される（既存仕様維持）。

## ゲームコンセプト文書の変更

`docs/rogue-of-sun-game-concept.md`から鍵関連の記述を削除した。

- 「基本ゲームルール」：「各フロアを探索し、鍵を入手して次のフロアを目指す。」→
  「各フロアの階段（出口）へ到達すると次のフロアへ進む。」
- 「フロア進行」：鍵持ち敵の探索・撃破・鍵回収・鍵による解放という5ステップの手順を、
  階段が生成時点から利用可能であることと、探索が任意の強化・報酬であることを明記した
  3ステップの手順に置き換えた。
- 「アイテム」：ドロップ対象の説明から「鍵」を削除。
- 用語集の`Ground Item`説明から「鍵」を削除。

将来の特別な扉・イベント用の鍵を明示的に禁止する記述は追加していない（現状の記述は単に
現行仕様の反映であり、将来拡張を妨げるものではない）。

## 変更ファイル一覧

- `src/game/turn.ts`（production変更）
- `docs/rogue-of-sun-game-concept.md`（ゲームコンセプト文書）
- `src/game/__tests__/multi-floor.test.ts`（既存テスト更新）
- `src/game/__tests__/enemy-type.test.ts`（既存テスト更新）
- `src/game/__tests__/enemy-behavior-kraken.test.ts`（コメント更新のみ、期待値は不変）
- `src/game/__tests__/phase-22-immediate-stairs-progression.test.ts`（新規テスト）
- `docs/history/phase-22-immediate-stairs-progression.md`（本ファイル）

鍵関連の型（`ItemId`、`EnemyActor`フィールド、`GameState`フィールド）は追加していない。

## 更新した既存テスト

- `multi-floor.test.ts`
  - 旧「does not advance the floor when any enemy is still alive at the exit」を
    「advances the floor when every enemy is still alive at the exit」に置換
    （敵が生存していても`floor_cleared`になることを検証）。
  - 旧「does not advance the floor when only one of two enemies has been defeated」を
    「advances the floor when only one of two enemies has been defeated」に置換。
- `enemy-type.test.ts`
  - 旧「keeps the stairs locked until all enemies are defeated」を
    「reaching the exit yields floor_cleared even with every enemy still alive」に置換。
- `enemy-behavior-kraken.test.ts`
  - 「does not trigger floor advancement even if pulled onto the exit tile」の期待値
    （`state.phase`が`'playing'`のまま、`floor_advanced`イベントが発生しない）は変更して
    いない。コメントを「全敵未撃破だから」から「プレイヤー自身の成立した移動でないから」に
    修正した。

無関係なテストの緩和、敵戦闘テストの削除、モンスターハウステストの期待値変更、フロア遷移
以外のphase判定変更は行っていない。

## 新規テスト

`src/game/__tests__/phase-22-immediate-stairs-progression.test.ts`（14テスト）：

- floor 1/2/3それぞれで敵全生存中でも`floor_cleared`/`victory`になること
- `spawnSource: 'monster_house'`の敵が生存していても進行できること
- `hidden`/`revealed`いずれのモンスターハウスでも進行できること
- 階段未到達では進行しないこと
- 階段上の敵を攻撃しただけでは進行しないこと
- 移動不成立では進行しないこと（壁衝突等）
- 階段到達ターンに死亡した場合は`gameover`が優先されること
- 1回の階段到達で1階層だけ進むこと
- フロア遷移後に前階の敵とモンスターハウス状態が残らないこと
- HP等のcarry-overが維持されること
- 同一runSeedで次階生成結果が再現すること

## 200seed×3階の結果

`processTurn`/`advanceToNextFloor`など本番経路を用いたheadlessスクリプトで、seed 1〜200
×floor 1〜3（合計600通り）を検証した。

- 生成例外：0件
- 階段が到達可能なfloorタイル上にあることを確認：全600件OK
- 敵が生存した状態での階段進行判定成立：全600件OK
- floor 1・2は`floor_cleared`、floor 3は`victory`になることを確認：全600件OK
- モンスターハウス発生階（73件）・非発生階（527件）のいずれでも進行できることを確認
- 同一seedでのfloor 1生成結果（seed、exit座標）の再現性を確認：200件OK
- 進行例外：0件

検証用スクリプトは一時ファイルとして作成し、確認後に削除した（commit対象外）。

## 全テスト・型検査・build結果

- `npx vitest run`：103ファイル / 2550テスト、全て成功
  （開始時点は102ファイル / 2536テスト。新規ファイル1件・新規テスト14件を追加）
- `npx tsc --noEmit`：エラーなし
- `npx vite build`：成功（`dist/assets/index-*.js`が1.6MB超という既存のチャンクサイズ
  警告のみ。本Phaseの変更に起因するものではない）
- `git diff --check`：問題なし（whitespaceエラーなし）

## manual / headless確認結果

実ブラウザでのPlaywright確認は本監査では実施していない（上記の200seed×3階のheadless
シミュレーションで、新runの開始・敵を倒さず階段到達・floor 1→2→3の進行・floor 3での
Victory・HPが階段移動で回復しないこと・モンスターハウス未攻略での進行、を代替検証した）。

実ブラウザで未確認の事項：

- UI上での階段到達時の視覚的フィードバック（既存の演出をそのまま利用しており、変更して
  いないため実害は低いと判断）
- 実際のプレイヤー入力（キーボード操作）による階段到達の操作感

## 後続へ延期した事項

- 階段即降りの強さ、探索せず進む戦略の最適化可否のプレイテスト
- アイテム・経験値・カード・モンスターハウス報酬が十分な探索動機になっているかの検証
- 階段到達時の確認操作の要否
- 特別フロア限定の扉、イベント専用の鍵、脱出用アイテムといった将来的な任意システム
- 階段移動SE、フロア遷移演出、フェード、階段到達時のメッセージなどの演出面

## Phase 22完了判定

completion_standardの各項目を満たしている：

- 生存敵がいても階段を利用できる：確認済み
- 最終階でも全敵撃破を要求しない：確認済み
- gameover優先順位とターン順を維持：確認済み（コード変更なし）
- 鍵関連実装が存在しない：確認済み（着手前からゼロ、今回も追加していない）
- Phase 21および既存ゲームシステムを壊していない：全テスト・型検査・build通過で確認
- 全テスト、型検査、buildが通る：確認済み

Phase 22は完了と判定する。
