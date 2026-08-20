# Hermes status protocol

A Claude session launched by Hermes must write `.ai/status.json` as its last action before exiting, unconditionally. This includes a session whose only outcome is "I need to ask a human something." A prose question without a status file is a protocol violation, and Hermes fails closed.

The file uses this schema:

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

For `USER_DECISION_REQUIRED`, `reason` must be self-contained enough for an upstream human-facing surface to forward directly. It must state what decision is needed, the concrete options, why the decision blocks progress, and the context the human needs to answer. For example, this hypothetical status is sufficiently self-contained:

```json
{
  "protocol_version": 1,
  "status": "USER_DECISION_REQUIRED",
  "reason": "Choose how a hypothetical depth-40 enemy affix pool should combine bonuses: A: add bonuses together, producing gentler scaling; or B: multiply bonuses, producing sharper late-game difficulty. Implementation is blocked because this balance choice changes both the stat formula and encounter tuning. Please choose A or B based on the intended late-game difficulty curve.",
  "phase": "hypothetical phase",
  "task": "Define hypothetical depth-40 affix stacking",
  "commit_sha": null
}
```

A reason such as `"Need a design decision"` fails this bar because it does not identify the decision, options, blocking impact, or necessary context.

Ordinary test failures, implementation defects, and first-attempt Codex failures are not `BLOCKED` by default. Claude should first use the normal bounded correction workflow and report `BLOCKED` only when that workflow cannot proceed safely.

Hermes trusts only `.ai/status.json` for continuation decisions. It never interprets Claude's prose output to decide whether to continue.
