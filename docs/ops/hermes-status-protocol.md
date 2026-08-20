# Hermes status protocol

Claude sessions launched by Hermes write `.ai/status.json` before exiting when they intend to hand control back to the outer loop. The file uses this schema:

```json
{
  "protocol_version": 1,
  "status": "CONTINUE | SESSION_BOUNDARY | USER_DECISION_REQUIRED | BLOCKED",
  "reason": "short summary",
  "phase": "current phase or null",
  "task": "last/current bounded task or null",
  "commit_sha": "last accepted commit SHA or null"
}
```

Status values mean:

- `CONTINUE`: State is verified and committed, and the next bounded task is unambiguous from canonical roadmap/specs. Hermes may launch a fresh Claude CLI session automatically.
- `SESSION_BOUNDARY`: A fresh-session turnover is needed, not necessarily a finished phase. If the next phase or task is unambiguous, Hermes may continue automatically as it does for `CONTINUE`.
- `USER_DECISION_REQUIRED`: A game-design, UX, balance, product, architecture, or other explicit human decision is unresolved. Hermes must stop and never answer for the user.
- `BLOCKED`: A serious blocker could not be resolved safely through Claude's normal bounded Codex-correction workflow. Hermes must stop.

Ordinary test failures, implementation defects, and first-attempt Codex failures are not `BLOCKED` by default. Claude should first use the normal bounded correction workflow and report `BLOCKED` only when that workflow cannot proceed safely.

Hermes trusts only `.ai/status.json` for continuation decisions. It never interprets Claude's prose output to decide whether to continue.
