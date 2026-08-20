# Hermes Discord control surface

`scripts/hermes-dev-control.ps1` is the repository-side, bounded interface for detached Hermes orchestration. Invoke it with `-Command start`, `status`, `stop`, or `answer` from the repository host.

- `start` rejects a pending decision, a live single-instance lock, or a dirty working tree; clears stale locks and stop requests; then launches the orchestrator detached with notifications enabled.
- `status` quickly reports the live PID check, last control state, full pending decision, current commit, and dirty-tree state. Add `-Json` for machine-readable output.
- `stop` writes a cooperative request. It never kills Claude or changes repository content; the orchestrator honors it between sessions.
- `answer -Answer <text> [-DecisionId <id>]` rejects missing, stale, or racing decisions, then launches a fresh session with the literal answer explicitly labeled as a human decision. The pending file is removed only after launch succeeds.

## Human-decision round trip

A fresh Claude session writes `USER_DECISION_REQUIRED` with a self-contained reason. The orchestrator persists `.ai/control/pending-decision.json`, notifies Discord with that full reason, and exits. A human reads it and supplies `answer <text>`. A fresh Claude session receives the original reason and the answer explicitly labeled as a human decision, records it in canonical documentation when CLAUDE.md requires that, and resumes normal work. Pending state is cleared only after that handoff launches successfully.

Hermes and this control layer never generate, infer, select, or improve an answer. Only literal text supplied by a human through `answer` is forwarded.

## Safety and remaining wiring

The normal git invariants remain in force: no push, merge, rebase, history rewrite, `git reset --hard`, or `git clean`; only Claude creates development commits; and an unexpected dirty tree fails closed.

One manual step remains: register a Hermes Discord-side hook/tool mapping home-channel `start`, `status`, `stop`, and `answer <text>` messages to `scripts/hermes-dev-control.ps1 -Command <...>`. This requires editing the live Gateway configuration (`~/.hermes/config.yaml` shell-hooks, as described by `hermes hooks --help`) and is deliberately outside this repository-only change. Until then, invoke the commands manually as the user or from an interactive Hermes/Claude session operating on this repository. The supported mapping must expose only these bounded commands, never arbitrary shell execution.
