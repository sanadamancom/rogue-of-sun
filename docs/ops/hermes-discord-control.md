# Hermes Discord control surface

`scripts/hermes-dev-control.ps1` is the repository-side, bounded interface for detached Hermes orchestration. Invoke it with `-Command start`, `status`, `stop`, or `answer` from the repository host.

- `start` rejects a pending decision, a live single-instance lock, or a dirty working tree; clears stale locks and stop requests; then launches the orchestrator detached with notifications enabled.
- `status` quickly reports the live PID check, last control state, full pending decision, current commit, and dirty-tree state. Add `-Json` for machine-readable output. When the project-local skill turns this data into a Discord reply, it uses a short Markdown heading or bold label, inline code for commit SHA/phase/task identifiers, and one or two bullets for pending-decision information; it never pastes the raw output.
- `stop` writes a cooperative request. It never kills Claude or changes repository content; the orchestrator honors it between sessions.
- `answer -Answer <text> [-DecisionId <id>]` rejects missing, stale, or racing decisions, then launches a fresh session with the literal answer explicitly labeled as a human decision. The pending file is removed only after launch succeeds.

## Human-decision round trip

A fresh Claude session writes `USER_DECISION_REQUIRED` with a self-contained reason. The orchestrator persists `.ai/control/pending-decision.json`, notifies Discord with that full reason, and exits. A human reads it and supplies `answer <text>`. A fresh Claude session receives the original reason and the answer explicitly labeled as a human decision, records it in canonical documentation when CLAUDE.md requires that, and resumes normal work. Pending state is cleared only after that handoff launches successfully.

Hermes and this control layer never generate, infer, select, or improve an answer. Only literal text supplied by a human through `answer` is forwarded.

## Project-local Discord skill

The project-local skill at
`.hermes/skills/software-development/rogue-of-sun-dev-control/SKILL.md`
routes natural-language Hermes Discord requests to the same four bounded
`start`, `status`, `stop`, and `answer` operations. It summarizes results in
natural Japanese and forwards a human decision answer literally. It is not a
general shell interface and must never execute arbitrary commands.

The repository must be trusted once by a human before Hermes loads this skill:

```powershell
hermes skills trust C:\dev\rogue-of-sun
```

This manual trust step is required. Repository automation must not run it.

## Human-facing language policy

Discord-facing text is Japanese: fixed orchestrator notification labels,
`USER_DECISION_REQUIRED` and `BLOCKED` reason content, replies composed by the
project-local skill, and optional short in-session progress notifications.
Decision and blocker reasons are authored in Japanese Discord Markdown by
Claude and forwarded verbatim; Hermes and Codex do not translate, summarize,
prefix, reconstruct, reformat, or otherwise alter them. A decision uses the
`## ⚠️ 人による判断が必要です` heading, an inline-code Phase/Task line, and
separate bold-labeled sections for the decision, bulleted options and impacts,
stop reason, and requested answer. A blocker uses
`## 🛑 開発がブロックされました` with sections for the problem, checks
already attempted, why bounded correction cannot continue, and the human
action needed.

Other notifications use lightweight Discord Markdown: `##` headings for
development start, committed task, and cooperative stop; `###` headings for
implementing, verification, and session turnover; and a short bold failure
label for orchestration errors. Phase, task, and commit SHA identifiers use
inline code. Messages remain mobile-readable and normally only a few lines.
No Discord-bound message includes raw stdout, full diffs, full test listings,
or unbounded content, and every message stays comfortably below Discord's
message-length limit.

The internal machine protocol remains English/original. This includes
`.ai/status.json` status values and JSON field names, phase/task values when
they are identifiers, code identifiers, commit SHAs, CLI command names, and
Claude/Codex prompts and logs. None of those are translated. Optional
in-session progress lines are informational only: they neither update control
state nor replace the required `.ai/status.json` result.

## Safety

The normal git invariants remain in force: no push, merge, rebase, history rewrite, `git reset --hard`, or `git clean`; only Claude creates development commits; and an unexpected dirty tree fails closed.

The project-local skill is the Discord-side natural-language routing layer. Its
supported mapping exposes only the four bounded commands and never arbitrary
shell execution. No Hermes installation or `~/.hermes/config.yaml` change is
part of this repository integration.
