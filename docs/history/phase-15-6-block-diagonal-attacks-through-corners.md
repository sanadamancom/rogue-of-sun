# Phase 15.6: 斜め角抜け攻撃の禁止

作成日: 2026-08-05
対象commit: `phase-15-6-block-diagonal-attacks-through-corners`ブランチ（`main` HEAD `c0f4fd10a6db2ab2cdcfc4832424fa1fbfce2c3b`から分岐）

## 1. 対象範囲

「斜めに隣接する攻撃者と対象者の間の両方の直交タイルが壁で塞がれている場合、その斜め攻撃を成立させない」というルールを、プレイヤー→敵・敵→プレイヤーの両方向へ一貫して適用した。既存の斜め移動禁止ルール（`canMove`）と全く同じ角定義を共有し、遠距離攻撃・射線判定・移動そのものには一切手を加えていない。

## 2. 発見した不整合

`map.ts`の`canMove`は既に「斜め移動時、両方の直交タイル（sideA/sideB）が歩行可能でなければ移動を禁止する」という角抜け禁止ルールを持っていた。しかし、隣接攻撃の判定はこのルールを一切共有していなかった。

- **プレイヤー側**（`turn.ts`の`resolveFacingAttack`）：`destinationOf(player.pos, direction)`で対象タイルを求め、そこに敵がいれば無条件で攻撃していた。斜め方向でも角抜けチェックは存在しなかった。
- **敵側**（`turn.ts`の`tryMeleeAttack`、8方向近接種全て共通）：`isAdjacent`（8方向）で隣接判定するのみで、角抜けチェックは存在しなかった。

このため、壁の対角に位置するプレイヤーと敵が、両者の間の直交2マスがともに壁で塞がれていても、斜めに攻撃し合えてしまっていた（移動では通れない角を、攻撃だけはすり抜けられるという不整合）。

`hammer-knockback-weapon.test.ts`の既存テスト「does not knock back diagonally through a blocked corner」がこの不整合の実例だったことを確認した（同テストのコメントには「sideA=(3,3)は壁、sideB=(2,4)は壁」という状況で「攻撃は成立し、ノックバックだけが角によって阻まれる」ことが明記されていた）。このテスト自体が本フェーズの対象そのものだったため、新しい正しい挙動（攻撃自体が成立しない）に合わせて書き換えた。

## 3. 実装

`map.ts`に`isDiagonalCornerOpen(map, from, to)`を新設した。

```ts
export function isDiagonalCornerOpen(map: GameMap, from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return true; // 斜め以外は常に許可
  const sideA: Vec2 = { x: from.x + dx, y: from.y };
  const sideB: Vec2 = { x: from.x, y: from.y + dy };
  return isWalkable(map, sideA) && isWalkable(map, sideB);
}
```

既存の`canMove`をこの関数を使うようリファクタリングし、移動判定と攻撃判定が完全に同一の角定義を共有するようにした（移動用と攻撃用で別々の判定式を持たない）。

- **プレイヤー側**：`resolveFacingAttack`の隣接攻撃判定に、`isDiagonalCornerOpen(map, player.pos, destination)`が真の場合のみ対象を検索するガードを追加した。角が塞がれている場合、`target`は`undefined`のまま扱われ、既存の「隣接に対象がいない場合」の経路（reach-2武器の判定、最終的にwhiff）へ自然に合流する。
- **敵側**：`tryMeleeAttack`の先頭近くに`isDiagonalCornerOpen(state.map, enemy.pos, player.pos)`のガードを追加した。8方向近接攻撃を行う全種（bok・golem・sword・axe・bat・mummy・cockatrice、および共有関数を通る全ての敵種別）が単一の関数を経由するため、1箇所の修正で全種へ一貫して適用される。角が塞がれている場合`tryMeleeAttack`は`false`を返し、呼び出し元は既存の`tryChaseStep`（移動を試みる、不可能なら待機）へ自動的にフォールバックする——この呼び出しパターンは既存の全ての敵行動関数に既に存在しており、新たな分岐やAI再設計は一切不要だった。

## 4. 対象外にした攻撃経路

- **太陽銃**（`resolveSolarGunAttack`）：`castGazeRay`による直線レイ判定であり、隣接攻撃ではない。射線自体が既に壁・角抜けを考慮した判定（既存のドキュメントコメント「wall/bounds/diagonal corner-cut aware」）を使っており、対象外。
- **スピア（reach2）**：`resolveFacingAttack`内の2マス先攻撃は、既に各セグメントで`canMove`を独立に適用しており、角抜け禁止は既に機能していた。変更不要。
- **コカトリスの視線攻撃**（`cockatrice_gaze`）：`castGazeRay`ベースの遠距離攻撃であり、隣接攻撃ではない。対象外。
- **クラーケンの触手攻撃**（`kraken_tentacle_strike`）：隣接ベースではなく、`tentacleCrossCells`による範囲攻撃であり、対象外。
- **スパイダーの近接攻撃**：もともと`isOrthogonallyAdjacent`（4方向のみ）で判定しており、斜め攻撃自体を行わない設計（既存仕様、Phase 15.6で変更せず）。

## 5. ターン消費規則

「壁方向への移動または成立しない攻撃」の既存の消費規則を監査した結果、独自の判断は不要だった。

- プレイヤー側：角で塞がれた対象は`resolveFacingAttack`内で「隣接に対象なし」と同じ経路をたどり、既存の`player_whiff`イベント発行＋`consumed: true`という、既存の「空振り時もターンを消費する」ルールへ自然に合流する。新しい特別扱いを追加していない。
- 敵側：`tryMeleeAttack`が`false`を返すと、呼び出し元は既存の`tryChaseStep`を試みる（成功すれば移動として1ターン消費、失敗すれば待機として1ターン消費）——これも既存のフォールバック構造そのままで、新しい分岐は追加していない。

## 6. 壁以外に斜め移動を妨げる地形がないことの確認

`types.ts`の`Tile`型は`'floor' | 'wall'`の2値のみであり、それ以外の地形種別は存在しない。したがって「壁以外の地形」による角抜け禁止は考慮不要であることを確認した。

## 7. 既存テストの修正

`hammer-knockback-weapon.test.ts`の「does not knock back diagonally through a blocked corner」を、新しい正しい挙動（攻撃自体が不成立になる）を検証する内容へ書き換えた。旧テストは「攻撃は成立し、ノックバックのみ角で阻まれる」ことを検証していたが、これは本フェーズが修正した不整合そのものだったため、テストの検証対象自体を刷新した（数値だけの調整ではない）。書き換え後は、プレイヤーの攻撃が不成立であること（`playerAttacked: false`、敵HP不変）、および同じ角に阻まれて敵からの反撃も成立しないこと（プレイヤーHP不変）を検証している。

## 8. 新規追加テスト

`phase-15-6-block-diagonal-attacks-through-corners.test.ts`（24件）を新設し、以下を検証した。

- `isDiagonalCornerOpen`/`canMove`の共有ロジック自体（sideA単独遮断・sideB単独遮断・両方遮断・両方開放・カーディナル方向は常に許可）
- プレイヤー攻撃：カーディナル4方向・開放斜め・sideA遮断・sideB遮断・両方遮断の各ケース、および角で阻まれた攻撃が撃破・経験値付与に一切つながらないこと
- 敵攻撃：同様の全ケース、および角で阻まれた場合に`enemy_attack`・`enemy_attack_missed`のいずれのイベントも一切発行されない（外れ扱いにもならない、完全な不成立）こと、既存のchase-step AIへ正しくフォールバックすること
- 回帰確認：斜め移動の角抜け禁止自体は無変更であること、開放斜め移動・カーディナル移動・カーディナル攻撃が無影響であること、角に阻まれない通常の撃破・経験値付与は従来どおり機能すること、複数敵種別（axe・sword種）でも同じ規則が一貫して適用されること

## 9. 全体テスト結果

`npx vitest run`：**71ファイル / 1806件 全成功**（新規24件を含む）。既存の決定性・多数seed生成テスト（1000シード・300マルチフロア含む）は本フェーズで一切変更しておらず、全て無変更のまま通過することを確認した。

## 10. RNGと決定性への影響

`isDiagonalCornerOpen`・`canMove`はいずれも純粋関数で乱数を一切使用しない。攻撃判定への角チェック追加は、既存の乱数消費（命中判定のロール）が行われる**前**に判定される（角で塞がれている場合、命中判定のロール自体に到達しない——`resolveEnemyAttackHit`のロールは`tryMeleeAttack`が角チェックを通過した場合のみ呼び出される）。したがって、角で攻撃が阻まれるケースでは、従来ロールされていた命中判定の乱数消費が発生しなくなる点が唯一の消費順序への影響である。これは「攻撃自体が不成立になる」という仕様変更の直接的かつ意図した結果であり、既存の決定性テスト・多数seedテストは全て無変更のまま成功しているため、他の乱数ストリーム（マップ生成・配置・種別選択・アイテム生成）への影響はないことを確認した。
