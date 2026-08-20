# Hermes/Discord USER_DECISION_REQUIRED往復のsynthetic検証（maintenance-hermes-discord-roundtrip-verification）

## 位置づけ

これはゲームバランス／設計上の意思決定記録ではない。Hermes/Discord制御層
（`scripts/hermes-orchestrate.ps1`、`scripts/hermes-dev-control.ps1`）が
commit `4591b8b`（atomic-write crash修正・notify targetのdefault修正）後、
**実リポジトリ・実binary（`hermes.exe`／実`claude` CLI）に対して**
`USER_DECISION_REQUIRED` → Discord通知 → `pending-decision.json` →
`answer` → 新規セッション起動、というhuman-decision往復全体を正しく
往復できるかどうかを確認するための、機構検証専用のsynthetic testである。

## 経緯

- `docs/ops/hermes-status-protocol.md`が例示として使っているものと同一の
  syntheticシナリオ（「hypothetical depth-40 enemy affix poolをA:加算／
  B:乗算のどちらでstackさせるか」）を、`.ai/task.md`の是正taskの検証手順
  （`scripts/hermes-dev-control.ps1 -Command start`でsynthetic
  `USER_DECISION_REQUIRED`を発生させ、`status`をpollし、
  `pending-decision.json`を確認し、`answer`で応答する）に沿って実際に
  一往復させた。
- Hermes経由で起動されたセッションが`USER_DECISION_REQUIRED`を返し、
  `docs/ops/hermes-discord-control.md`記載のとおり
  `.ai/control/pending-decision.json`が生成され、`hermes send`による
  Discord通知が行われた。
- 人間から`answer`コマンド経由で「SYNTHETIC TEST ANSWER: choose A
  (additive stacking). This is a synthetic control-layer verification
  only.」という回答が literal text として渡され、新規Claude CLIセッション
  （本記録を書いているセッション）が起動された。
- 本セッションはその回答を受け取り、`docs/ops/hermes-discord-control.md`
  §「Human-decision round trip」が要求するとおり「canonical
  documentationへ記録してから通常workflowへ戻る」を実行している。

## 明示的な非決定事項

depth-40+ enemy affix poolのbonus合成方式（加算 vs 乗算）は、本repository
に実在するgame-design課題ではない。現時点でdepth-40+ enemy affix pool自体
がまだ設計・実装されていない（`docs/planning/rogue-of-sun-phase24-6c-long-run-balance-design.md`
参照）。したがって「Aを選んだ」というsynthetic回答を、実際のbalance
仕様として`docs/planning/`や`docs/specs/`へ反映することはしない。将来
depth-40+ enemy affix poolを実際に設計する際は、このsynthetic testの結果
ではなく、その時点の canonical design doc とcurrent repository stateに
基づいて改めて意思決定すること。

## 確認できた事実（機構としての結論）

Hermes/Discord USER_DECISION_REQUIRED往復（session→通知→
pending-decision.json→human answer→新規session起動→canonical
documentationへの記録→通常workflow復帰）は、`4591b8b`の2つの修正
（`Write-JsonAtomic`のfile-replace crash修正、notify targetの
`discord:#rogue-of-sun` default化）を適用した状態で、実repository・実
binaryに対して最後まで機能した。

- headless commit verification: this line was appended and committed by a Hermes-launched non-interactive Claude session with no human present to approve tool calls, confirming the headless permission bypass lets a session complete its own accepted git commit.

## 追加往復（Japanese-ized通知後の再検証）

commit `4810c95`（headless承認bypassとDiscord通知のJapanese化）適用後、同一の
synthetic `USER_DECISION_REQUIRED`往復をもう一度実施した。今回の人間からの
literal回答は次の通り：

> SYNTHETIC TEST ANSWER: no action needed, this is purely a
> notification-pipeline verification response.

この回答も上記「明示的な非決定事項」節と同様、実在するgame-design/balance
決定ではない。「no action needed」という回答内容自体が、depth-40+ enemy
affix poolのbonus合成方式についてA/Bいずれも選択しておらず、canonical
planning docへ反映すべきbalance仕様は存在しない。本節はHermes/Discord
control layerが、Japanese化された通知文言を経由しても
`USER_DECISION_REQUIRED` → Discord通知 → `answer` → 新規session起動 →
canonical documentationへの記録、という往復を最後まで問題なく再現できた
ことのみを記録する。

- 2026-08-21 final integration verification: a Hermes-launched headless Claude session committed this synthetic docs-only marker after the Japanese decision/progress contract update.

## 第三往復（リポジトリローカルskill・Japanese化最終統合後の再検証）

commit `6a632bb`（リポジトリローカルHermes skillの追加とJapanese human-facing
language contractの導入）適用後、同一のsynthetic `USER_DECISION_REQUIRED`
往復をもう一度実施した。今回の人間からの literal回答は次の通り：

> SYNTHETIC TEST ANSWER: choose A. This is purely a Japanese-content
> round-trip verification response, not a real balance decision.

この回答も上記2回の往復と同様、実在するgame-design/balance決定ではない。
depth-40+ enemy affix poolのbonus合成方式（加算 vs 乗算）について「A（加算）
を選ぶ」という体裁を取ってはいるが、depth-40+ enemy affix pool自体が本
repositoryにまだ存在しないため、この回答を`docs/planning/`や`docs/specs/`
の実際のbalance仕様へ反映することはしない。将来depth-40+ enemy affix pool
を実際に設計する際は、このsynthetic testの結果ではなく、その時点の
canonical design docとcurrent repository stateに基づいて改めて意思決定
すること。

本節はHermes/Discord control layerが、リポジトリローカルskillと
Japanese human-facing language contractの最終統合後も
`USER_DECISION_REQUIRED` → Discord通知 → `pending-decision.json` →
`answer` → 新規session起動 → canonical documentationへの記録 → 通常
workflow復帰、という往復を最後まで問題なく再現できたことのみを記録する。

## 第四往復（Discord通知の構造化Markdown化後の再検証）

commit `f001c59`（Discord human-facing通知を構造化Markdownとして整形）
適用後、同一のsynthetic `USER_DECISION_REQUIRED`往復をもう一度実施した。
今回の人間からのliteral回答は次の通り：

> SYNTHETIC TEST ANSWER: choose A. This is purely a Markdown-formatting
> round-trip verification response, not a real balance decision.

この回答も上記3回の往復と同様、実在するgame-design/balance決定ではない。
depth-40+ enemy affix poolのbonus合成方式（加算 vs 乗算）について「A（加算）
を選ぶ」という体裁を取ってはいるが、depth-40+ enemy affix pool自体が本
repositoryにまだ存在しないため、この回答を`docs/planning/`や`docs/specs/`
の実際のbalance仕様へ反映することはしない。将来depth-40+ enemy affix pool
を実際に設計する際は、このsynthetic testの結果ではなく、その時点の
canonical design docとcurrent repository stateに基づいて改めて意思決定
すること。

本節はHermes/Discord control layerが、Discord human-facing通知の構造化
Markdown化後も`USER_DECISION_REQUIRED` → Discord通知（構造化Markdown形式）
→ `pending-decision.json` → `answer` → 新規session起動 → canonical
documentationへの記録 → 通常workflow復帰、という往復を最後まで問題なく
再現できたことのみを記録する。
