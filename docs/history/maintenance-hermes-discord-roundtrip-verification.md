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
