# Hermes status protocol

A Claude session launched by Hermes must write `.ai/status.json` as its last action before exiting, unconditionally. This includes a session whose only outcome is "I need to ask a human something." A prose question without a status file is a protocol violation, and Hermes fails closed.

## Writing the status file

Claude must write `.ai/status.json` with `scripts/hermes-write-status.ps1`, not by hand-constructing the JSON with the Write or Edit tool:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hermes-write-status.ps1 -Status CONTINUE -Reason "..." -Phase "24.6c4d" -Task "..." -CommitSha "..."
```

The script mechanically sets `protocol_version` to `1` and requires `-Status` (from the fixed enum) and a non-empty `-Reason`; `-Phase` and `-Task` are optional and become JSON `null` when omitted. `-CommitSha` is required for `USER_DECISION_REQUIRED` and must be the full 40-hex lowercase SHA of the current reviewed `HEAD`; for `CONTINUE`, `SESSION_BOUNDARY`, and `BLOCKED` it remains optional and becomes JSON `null` when omitted. It exits non-zero on an invalid status, missing reason, or missing decision commit SHA, so Claude never has to reconstruct the schema from prose, and a session can never silently omit `protocol_version` the way a hand-written file can. If the script itself cannot run for some reason, that is a `BLOCKED` condition, not a license to hand-write the file as a fallback.

Hermes independently re-validates whatever ends up on disk after the session exits (protocol_version, known status values, valid JSON) regardless of how it was produced, so the helper is a reliability aid for Claude, not a trust boundary for Hermes.

## Schema

The file uses this schema:

```json
{
  "protocol_version": 1,
  "status": "CONTINUE | SESSION_BOUNDARY | USER_DECISION_REQUIRED | BLOCKED",
  "reason": "short summary",
  "phase": "current phase or null",
  "task": "last/current bounded task or null",
  "commit_sha": "full 40-hex lowercase SHA of current reviewed HEAD for USER_DECISION_REQUIRED; otherwise a commit SHA or null"
}
```

Status values mean:

- `CONTINUE`: State is verified and committed, and the next bounded task is unambiguous from canonical roadmap/specs. Hermes may launch a fresh Claude CLI session automatically.
- `SESSION_BOUNDARY`: A fresh-session turnover is needed, not necessarily a finished phase. If the next phase or task is unambiguous, Hermes may continue automatically as it does for `CONTINUE`.
- `USER_DECISION_REQUIRED`: A game-design, UX, balance, product, architecture, or other explicit human decision is unresolved. Hermes must stop and never answer for the user.
- `BLOCKED`: A serious blocker could not be resolved safely through Claude's normal bounded Codex-correction workflow. Hermes must stop.

For `USER_DECISION_REQUIRED`, `reason` remains a single string, but Claude must author that string as self-contained Japanese Discord Markdown. It uses a heading, a bold phase/task line with identifier-like values in inline code, and the verbatim section labels `判断事項`, `選択肢`, `停止理由`, and `人間に求める回答`; labels must not be shortened or renamed. `BLOCKED` follows the same rule with the verbatim sections `問題`, `実施済み確認`, `なぜ自動継続できないか`, and `人間に必要な対応`. Hermes, Codex, and downstream surfaces forward the string verbatim; they never reconstruct, summarize, translate, prefix, or reformat it. For example, this synthetic status is sufficiently self-contained:

```json
{
  "protocol_version": 1,
  "status": "USER_DECISION_REQUIRED",
  "reason": "## ⚠️ 人による判断が必要です\n\n**Phase:** `synthetic-verification` / **Task:** `depth-40-affix-stacking`\n\n**判断事項:**\n架空の深度40敵アフィックスプールで、ボーナスをどのように合成するか決定が必要です。\n\n**選択肢:**\n- **A:** 加算する — 後半の難易度上昇が緩やかになります。\n- **B:** 乗算する — 後半の難易度上昇が急になります。\n\n**停止理由:**\nこの選択で能力値の式と遭遇調整の両方が変わるため、実装を停止しています。\n\n**人間に求める回答:**\n意図する後半の難易度曲線に基づき、A または B を回答してください。",
  "phase": "hypothetical phase",
  "task": "Define hypothetical depth-40 affix stacking",
  "commit_sha": "0123456789abcdef0123456789abcdef01234567"
}
```

A reason such as `"Need a design decision"` fails this bar because it does not identify the decision, options, blocking impact, or necessary context.

Ordinary test failures, implementation defects, and first-attempt Codex failures are not `BLOCKED` by default. Claude should first use the normal bounded correction workflow and report `BLOCKED` only when that workflow cannot proceed safely.

Hermes trusts only `.ai/status.json` for continuation decisions. It never interprets Claude's prose output to decide whether to continue.

See [Hermes Decision Base publishing](hermes-decision-base-publish.md) for the safety-checked ref published when a user decision is required.
