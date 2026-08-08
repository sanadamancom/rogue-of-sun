# Phase 18.1: 罠の発見状態（revealed）追加

## 位置づけ

Phase 18.0の実コード監査により、slow_trapとpoison_trapはPhase 12.2/12.3で既に
実装済みであることが判明した。development plan上の「Phase 18: 罠」は新規基盤
実装ではなく、既存罠を完成させるフェーズとして扱う。Phase 18.1では、既存の
`TrapTile`/`triggered`を置き換えず、発見状態（`revealed`）を追加して
未発見・発見済み未発動・発動済みの3状態を成立させた。

千里眼の実、ミニマップ新規表示、telemetry追加はPhase 18.2以降へ残す。

## 採用した3状態

`TrapTile`に新規`revealed: boolean`を追加し、既存`triggered: boolean`と組み合わせて表現する。

| 状態 | revealed | triggered |
|---|---|---|
| hidden（未発見） | false | false |
| revealed_untriggered（発見済み未発動） | true | false |
| triggered_inactive（発動済み） | true | true |

不変条件: `triggered=true` は常に `revealed=true` を伴う。`revealed=false` かつ
`triggered=true` の組み合わせは生成・更新しない。

セーブ機構が存在しないため、旧`triggered`のみのデータに対する互換処理は新設していない。

## プレイヤー発動時の状態遷移

`turn.ts`のプレイヤー移動処理内、既存の未発動罠判定ループに`revealed = true`の
代入を1行追加しただけで、それ以外の効果付与・イベント発行・ログ・ターン処理順は
変更していない。未発見罠を踏んだ場合と、（将来的な）発見済み未発動罠を踏んだ場合の
両方が同じコードパスで`revealed=true, triggered=true`へ遷移する。

## 敵の扱い

敵移動処理へは一切手を加えていない。敵は既存仕様どおり罠を発動しない。
`phase-18-1-trap-discovery.test.ts`にて、敵が未発見罠・発見済み未発動罠のいずれの
上を通過しても状態が変化しないことをテストで固定した。

## 配置・RNG

`mapgen.ts`の`chooseTrapPosition`、`state.ts`の罠専用RNGストリーム（XOR定数含む）は
一切変更していない。罠生成箇所2か所（slow_trap/poison_trap）に`revealed: false`を
追加しただけで、既存RNG消費順・配置候補条件・個数は不変。

## 描画

`main.ts`の`drawTraps()`を`triggered`基準から`revealed`基準の描画対象判定へ変更した。

- `revealed=false`: 描画しない（通常床と同一）
- `revealed=true, triggered=false`: 種別ごとの形状を、細い警告色（黄）の輪郭のみで表示
- `revealed=true, triggered=true`: 既存のPhase 12.2/12.3の見た目（slow_trapのオレンジ円＋X、poison_trapの紫ダイヤ＋中心点）を完全に維持

視界・暗い部屋との連携（発見済み罠を視界外でも記憶表示する仕組みの新設）はこの
フェーズでは行っていない。ミニマップへの罠表示も追加していない。

## Phase 18.2へ残した範囲

- 千里眼の実の追加とそれによる発見経路
- ミニマップへの罠表示
- telemetryへのtrap_triggered接続
- 視界・暗い部屋とrevealed状態の明示的な連携仕様

## 検証

- targeted: 罠生成・プレイヤー移動・敵移動・状態効果・描画（対象コードの型/ロジック）・フロア状態初期化に関わる既存テストおよび新規`phase-18-1-trap-discovery.test.ts`（9件）を実行し全通過
- full: `npx vitest run` → 81ファイル / 1926テスト全通過
- `npx tsc --noEmit` → エラーなし
- `npx vite build` → ビルド成功

装備解除不能バグの調査・修正は行っていない。development planファイル（リポジトリ内・外部添付のいずれも）は変更していない。
