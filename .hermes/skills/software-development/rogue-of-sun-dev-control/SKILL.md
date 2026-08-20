---
name: rogue-of-sun-dev-control
description: Checks, starts, stops and answers ROGUE OF SOL dev requests.
version: 0.2.0
metadata:
  hermes:
    tags: [rogue-of-sun, hermes-orchestration, discord]
    category: software-development
---

# ROGUE OF SOL Development Control

Route natural-language Discord requests to the repository's four bounded
development-control operations. Always answer the human in concise, natural
Japanese; this skill grants no general shell-execution capability.

## When to Use

**Hard rule:** For every ROGUE OF SOL development-control request shaped as
start, status, stop, or an answer to a pending decision, use this skill's
bounded interface. General git, terminal, and filesystem access does not
override this rule. Do **not** independently run `git status`, `git log`,
`ls`, `find`, inspect repository files, or otherwise investigate the
repository to answer or act on such a request.

- 「開発を開始して」「続きを進めて」など、開発開始の依頼は `start`。
- 「状態を教えて」「今どうなってる？」など、進捗確認は `status`。
- 「開発を止めて」「いったん停止して」など、停止依頼は `stop`。
- 未回答の判断事項が通知済みで、ユーザーが「Aで進めて。理由は…」のように明示的な回答を返した場合は `answer`。
- Don't use for: arbitrary PowerShell or shell commands. Use only the four
  bounded operations against this repository, even when another command is
  phrased as a development request.

## Prerequisites

- Repository: `C:\dev\rogue-of-sun`.
- Use the Hermes `terminal` tool only to invoke
  `scripts\hermes-dev-control.ps1 -Command <start|status|stop|answer> [-Answer "<text>"] [-DecisionId "<id>"]`.
- Read `docs/ops/hermes-discord-control.md` for complete command semantics;
  do not duplicate or broaden that contract.

## Procedure

0. Unless this skill is genuinely irrelevant, route any repository-status or
   development-control-shaped Discord message in this project context through
   `scripts\hermes-dev-control.ps1` before using any other tool. Do not perform
   preliminary repository investigation.

1. For a start request, use `terminal` in `C:\dev\rogue-of-sun` to run
   `scripts\hermes-dev-control.ps1 -Command start`. It returns immediately;
   do not wait for development to finish. Reply in concise Japanese that
   development started, without pasting script stdout verbatim.

2. For a status request, use `terminal` to run
   `scripts\hermes-dev-control.ps1 -Command status -Json` (the non-JSON form
   is also allowed). Compose a natural Japanese summary covering whether it
   is running, the current phase/task, the last commit, and whether a decision
   is pending and what it concerns. Format the Discord reply with a short
   Markdown heading or bold label, inline code for commit SHA/phase/task
   identifiers, and one or two bullets for pending-decision information.
   Never paste raw JSON or an English key-value dump into Discord.

3. For a stop request, use `terminal` to run
   `scripts\hermes-dev-control.ps1 -Command stop`. Tell the user in Japanese
   that the cooperative stop was requested and will take effect at the next
   safe session boundary. Never claim it is immediate or kill an in-progress
   session.

4. **Critical — forward the human's words verbatim.** Use `answer` only when
   the user is clearly answering a previously notified pending decision. Run
   `scripts\hermes-dev-control.ps1 -Command answer -Answer "<the user's literal text, unmodified>"`.
   Never invent, summarize, improve, translate, or decide the answer for the
   user, and never fabricate an answer when no decision is pending. An
   optional known `-DecisionId "<id>"` may be included. If the command fails
   closed because there is no pending decision, the ID is stale, or the
   orchestrator is still running, report that fact in Japanese; do not retry
   with a guessed or modified answer.

5. Do not use this skill to execute any other PowerShell or shell command a
   user requests. Only the four bounded invocations of
   `hermes-dev-control.ps1` above are in scope.

## Pitfalls

- `start` and `answer` are non-blocking. Do not hold the Discord conversation
  open for a multi-minute session. The human checks later with a separate
  `status` message.
- Never paste raw Claude/Codex stdout or `.ai/control/logs/` content into
  Discord. Use only the short Japanese summaries above and the orchestrator's
  own `-Notify` notifications.
- A pending decision is required for `answer`; a development-like phrase is
  not enough to infer one.

## Verification

The human can run
`scripts\hermes-dev-control.ps1 -Command status` directly from
`C:\dev\rogue-of-sun` and compare its state with the skill's Japanese summary.
Confirm that no command outside `start`, `status`, `stop`, or `answer` ran.
