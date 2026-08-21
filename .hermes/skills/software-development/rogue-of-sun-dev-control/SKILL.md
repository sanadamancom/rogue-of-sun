---
name: rogue-of-sun-dev-control
description: Checks, starts, stops and answers ROGUE OF SOL dev requests, including /ros-answer.
version: 0.3.1
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
override this rule. Do not independently run repository inspection commands.

- Development start/continue requests route to `start`.
- Current-state questions route to `status`.
- Stop/pause requests route to `stop`.
- `/ros-answer <text>` is the canonical `answer` trigger. A clearly stated
  Japanese answer to a previously notified pending decision is also accepted.
- Do not use this skill for arbitrary PowerShell or shell commands. Only the
  four bounded operations against this repository are allowed.

### Read-only infrastructure contract

During Discord control routing, `scripts/hermes-dev-control.ps1` and
`scripts/hermes-orchestrate.ps1` are **read-only infrastructure**. Never use
`Read`, `Edit`, `Patch`, `Write`, or an equivalent inspect-then-modify tool on
either file. No invocation outcome authorizes investigating, diagnosing,
repairing, or improving these files.

For `start`, `status`, or `stop`, invoke the corresponding control command
through `terminal` exactly once. For `answer`, follow Procedure 4's bounded
status/temp-file/answer/cleanup sequence and invoke the answer command exactly
once. Then do nothing else procedural: do not inspect afterward, retry, loop,
or use an alternate approach. Forward the human's literal text verbatim and
never infer or decide it.

If an invocation fails for any reason, including non-zero exit, fail-closed
error, unexpected output, or quota/provider failure, do not investigate, open
or edit files, or attempt a workaround. Report the concrete failure in
Japanese, briefly summarize stdout/stderr without flooding the reply, and
stop. Diagnosis and correction belong to the normal Claude -> Codex ->
Claude-verifies -> Claude-commits workflow.

Do not change `terminal.cwd`, Hermes global/Gateway configuration, or restart
the Gateway.

## Prerequisites

- Repository: `C:\dev\rogue-of-sun`.
- Use `terminal` only for the four bounded control operations and Procedure
  4's local answer temp-file handling.
- Read `docs/ops/hermes-discord-control.md` for complete semantics; do not
  broaden that contract.

## Procedure

0. Route any repository-status or development-control-shaped Discord message
   through this bounded interface before any other tool. Do not perform
   preliminary repository investigation.

1. For start, run `scripts\hermes-dev-control.ps1 -Command start` from
   `C:\dev\rogue-of-sun`. It returns immediately. Reply in concise Japanese
   that development started; do not paste stdout verbatim.

2. For status, run `scripts\hermes-dev-control.ps1 -Command status -Json`
   (non-JSON is also allowed). Give a natural Japanese summary of running
   state, phase/task, last commit, and pending decision. Use a short Markdown
   heading or bold label, inline code for identifiers, and one or two pending
   decision bullets. Never paste raw JSON or an English key-value dump.

3. For stop, run `scripts\hermes-dev-control.ps1 -Command stop`. Say in
   Japanese that cooperative stop was requested for the next safe session
   boundary. Never claim it is immediate or kill a session.

4. **Critical — forward the human's words verbatim.** First run
   `scripts\hermes-dev-control.ps1 -Command status -Json`, fetch
   `decision.decisionId`, and confirm `decisionPending` is true. If not, reply
   `現在、回答待ちのhuman decisionはありません。` and stop. Never invent or
   guess a decision ID.

   Create a unique file under `$env:TEMP`. Assign the completely unmodified
   answer to `$Text` using a single-quoted PowerShell here-string (`@'` on its
   own line, literal answer, then `'@` on its own line). Write it with
   `Set-Content -LiteralPath <tempfile> -Value $Text -Encoding UTF8 -NoNewline`.
   This exact technique is required because it tolerates quotes, backticks,
   and multiline/Japanese content that a double-quoted argument cannot.

   Invoke `scripts\hermes-dev-control.ps1 -Command answer -AnswerFile
   "<tempfile>" -DecisionId "<the fetched decisionId>"` exactly once through
   `terminal`. Delete the temp file afterward regardless of outcome, using
   `finally` around invocation and cleanup. This is local temp-file cleanup,
   not repository/control-state modification. Never retry automatically.

   On success reply `Decision <id> の回答を受理しました。Hermesを再開しました。`
   On failure relay the concrete fail-closed reason in Japanese: no pending
   decision, stale/mismatched ID, orchestrator already running, empty answer,
   another answer already being processed, or immediate orchestrator exit
   with the human decision preserved. Never guess or modify the answer.

5. Execute no other requested PowerShell or shell command. Only these four
   bounded operations are in scope.

## Pitfalls

- `start` and `answer` are non-blocking. The human checks later with a separate
  status request.
- Never paste raw Claude/Codex stdout or `.ai/control/logs/` into Discord. Use
  short Japanese summaries and orchestrator notifications.
- A pending decision is required; a development-like phrase is insufficient.

## Verification

The human may run `scripts\hermes-dev-control.ps1 -Command status` directly
from `C:\dev\rogue-of-sun` and compare it with the Japanese summary. Confirm
that no command outside `start`, `status`, `stop`, or `answer` ran.
