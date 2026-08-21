# Phase 24.6c3a2: 罠数のdepth接続

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §13・§16 row `24.6c3a` に基づき実装した。

## 1. 実装

- 現在depthに応じた罠slot数をdepth 1～10で2、11～19で3、20～26で4とし、範囲外は最寄りのbandへ防御的に丸めた。下降・上昇legによる分岐は設けていない。
- 既存slot 1・2の位置選択、部屋優先・fallback、RNG streamとXOR定数を維持した。
- slot 3・4には位置と種類ごとに独立したRNG streamと固有のXOR定数を追加し、それ以前に配置された全罠位置を累積して除外した。slotが対象depthでない場合、または位置を確保できない場合、その種類抽選は消費しない。
- `TRAP_TYPE_WEIGHTS`と`selectTrapType`の値・挙動、日照、light/mixed/dark比率、productionの`TOTAL_FLOORS`は変更していない。

## 2. 検証

- depth 1／10／11／19／20／26と範囲外の境界をtestで固定した。
- syntheticなdepth 11・20のfloor生成で3／4罠経路へ到達し、同一seedで結果が決定的であることを確認した。
- `npm run typecheck` / `npm test` / `npm run build` を実行し、すべて通過した。
