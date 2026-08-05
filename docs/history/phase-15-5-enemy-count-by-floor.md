# Phase 15.5: 敵配置数のフロア別固定化

作成日: 2026-08-05
対象commit: `phase-15-5-enemy-count-by-floor`ブランチ（`main` HEAD `b7fd14535d2fc4ffb75e406fdee9847a81f6ab47`から分岐）

## 1. 対象範囲

通常生成される敵数を、全フロア共通の固定値2体から、フロアごとの固定値（floor1=6、floor2=7、floor3=8）へ変更した。敵種別の段階的解禁・配置規則・戦闘処理・決定性はすべて維持し、変更したのは「配置数」だけである。

## 2. 変更前の敵数

`mapgen.ts`の`ENEMY_COUNT_PER_FLOOR = 2`（全フロア共通の固定値）。`choosePlacement(map, rng, count)`の`count`引数のデフォルト値として使われていた。`state.ts`のbuildFloorStateは`floor`引数を受け取っていたが、これを敵数の算出に一切使っておらず、「floor→敵数」の対応表はコード上どこにも存在しなかった（Phase 15.4a監査で確認済みの内容と一致）。

## 3. 新しいfloor別敵数と正本の配置場所

`mapgen.ts`に`ENEMY_COUNT_BY_FLOOR: Record<number, number> = {1:6, 2:7, 3:8}`を新設した。`ENEMY_COUNT_PER_FLOOR`（既存、値2のまま維持）のすぐ下に配置し、「配置数」という同じ責務のもとで一元管理する。

**責務の分離**：`mapgen.ts`は敵の「配置数」（`ENEMY_COUNT_PER_FLOOR`／`ENEMY_COUNT_BY_FLOOR`／`choosePlacement`）を、`enemy-def.ts`は「配置候補となる種別プール」（`ENEMY_FIRST_APPEARANCE_FLOOR`／`getEnemyPoolForFloor`）をそれぞれ所有するという既存の分担を維持し、新設した敵数テーブルを`enemy-def.ts`側へ混在させなかった。

## 4. enemyCount overrideの優先順位

`state.ts`のbuildFloorState内、`choosePlacement`呼び出し直前で以下の解決式を追加した。

```ts
const resolvedEnemyCount = enemyCount ?? ENEMY_COUNT_BY_FLOOR[floor] ?? ENEMY_COUNT_PER_FLOOR;
const placement = choosePlacement(map, placementRng, resolvedEnemyCount);
```

- `enemyCount`（`buildFloorState`の既存オプション引数）が明示的に渡された場合は常に最優先される。`??`（null合体演算子）を使っているため、`enemyCount=0`も「未指定」とは区別され、有効な上書き値として扱われる。
- `buildRosterPreviewFloorState`（テスト・開発専用、9種全部を強制配置する経路）は`enemyCount=ENEMY_TYPES_IN_ORDER.length`（9）を明示的に渡しており、この解決式によって常にfloor別値より優先されるため、既存の表示内容・対象数は一切変化しない。
- `enemyCount`未指定の通常経路（`createInitialState`・`advanceToNextFloor`）は`ENEMY_COUNT_BY_FLOOR[floor]`を使用する。

## 5. 未定義floorのfallback

`ENEMY_COUNT_BY_FLOOR`に存在しないfloor番号（0以下、4以上）に対しては、`ENEMY_COUNT_BY_FLOOR[floor]`が`undefined`を返し、`??`チェーンにより`ENEMY_COUNT_PER_FLOOR`（2）へフォールバックする。例外はthrowしない。`TOTAL_FLOORS=3`のため、この経路は通常プレイでは一切到達しない防御的処理である。

## 6. 敵種別poolを変更していないこと

`enemy-def.ts`の`ENEMY_FIRST_APPEARANCE_FLOOR`・`getEnemyPoolForFloor`・`chooseSpecies`（state.ts）はいずれも無変更。`chooseSpecies(placement.enemies.length, speciesRng, floorPool)`は既に配置数を動的に参照する実装だったため、敵数が2→6/7/8へ増えても追加の変更なしに正しく機能する。floor2限定のgolem重複差し替え処理（インデックスベース、RNG非消費）も配置数に依存しないため無変更で正しく動作する。

## 7. RNGと決定性への影響

- `placementRng`（`floorSeed ^ 0x51ed270b`）が消費するrng()呼び出し回数は、配置数の増加分だけ増える（2→6/7/8）。これは`choosePlacement`内の「1体につき1回」というサンプリングロジックそのままの結果であり、アルゴリズム自体は変更していない。
- `speciesRng`（`floorSeed ^ 0x8f3c9d21`）も同様に配置数と同じ回数だけ消費するよう、既に配置後の`placement.enemies.length`を参照する実装だったため、変更なしで正しくスケールする。
- 敵配置・種別選択のいずれのRNGストリームも、アイテム生成側（個数・種類・座標の3ストリーム）・罠生成側（2ストリーム）とは独立したXOR定数で分離されたままであり、統合・共有はしていない。
- 敵数が増えたことで、アイテム・罠配置時の「既に使用されている座標」の除外リストの内容は変わる（敵が多い分、除外される座標が増える）が、これは各アイテム・罠それぞれの独立ストリームの消費順序や消費回数自体には影響しない（除外リストの中身が変わるだけで、rng()の呼び出し回数・順序は不変）。
- 同一seed・同一carryでの再現性は、`phase-15-5-enemy-count-by-floor.test.ts`の決定性テスト（同一seed、carry値を変えても敵配置は変わらないこと、異なるseedでは配置が固定化されていないこと）で検証済み。

## 8. 多数seedおよび3階通し試験結果

- 1000シードでのfloor1生成：候補不足によるthrowなし、全件成功。
- 1000シードでの敵配置座標検証：全敵が歩行可能タイル・開始地点/出口と非重複・開始地点に非隣接であることを確認。
- 300シードでの3階通し生成：floor1=6体・floor3=8体を含む全フロアの規定数を確認、例外なし。
- 既存の`robustness.test.ts`（1000シード）・`multi-floor-robustness.test.ts`（100シード×3フロア）もあわせて成功を確認。

## 9. アイテムと罠の配置数を維持したこと

Phase 15.4bで導入した床落ちアイテム総数2〜6個の分布抽選ロジック・floor別段階poolは無変更。敵数増加後も100シード×3フロアにわたり、groundItemsが常に2〜6個の範囲に収まること、敵・アイテム・罠・開始地点・出口のいずれの座標も重複しないことを新規テストで確認した。アイテム個数・種類・座標の3本の独立RNGストリーム、罠の2本の独立RNGストリームはいずれも本フェーズで変更していない。

## 10. out_of_scopeとして残したバランス項目

敵種別pool・初出階・出現率、elite/boss/特殊敵、敵AI、敵HP・攻撃力・経験値、敵レベルアップ、遠距離攻撃敵、マップサイズ・部屋数、アイテム出現数・抽選率、罠数・罠効果、満腹度・HP・SOLの調整、武器・防具・属性効果の調整は、いずれも本フェーズで変更していない。
