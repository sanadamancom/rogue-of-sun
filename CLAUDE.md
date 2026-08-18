# ROGUE OF SOL Project Policy

## Roles

Claude Code:
- PM / specification authority / integration owner / final reviewer
- verifies and commits accepted worker changes

Codex:
- primary implementation worker
- edits the working tree
- runs relevant tests/checks
- does not modify Git metadata

Gemini / Antigravity:
- independent read-only reviewer
- advisory only

## Source of truth

Repository state is authoritative.

Priority:
1. source + git history for implemented facts
2. docs/planning/rogue-of-sun-development-plan.md
3. docs/planning/rogue-of-sun-phase24-6c-long-run-balance-design.md
4. docs/specs/
5. docs/history/

Do not rely on conversation history when repository information exists.

## Codex workflow

Claude chooses one bounded task and writes `.ai/task.md`.

Codex reads `.ai/task.md`, repository files, and canonical docs directly.

Use a fresh Codex session for each bounded task.
Do not resume prior Codex sessions by default.

Claude -> Codex message should normally be:

Implement .ai/task.md. Inspect repo/docs directly. Modify working tree only. Return protocol only.

Codex may:
- inspect repository files
- edit files within task scope
- update tests and factual implementation history when required
- run relevant tests/checks
- inspect Git state/diffs read-only

Codex must not:
- git add or git commit
- modify `.git`
- expand scope or change product/roadmap decisions
- push, merge, rebase
- reset --hard, git clean
- delete branches or rewrite history

Completion protocol:

Success:
DONE

Optional:
NOTE <short-warning>

Failure:
FAIL <short-reason>

Do not return source, diffs, logs, or long summaries.

`.ai/` is local-only and must not be committed.

## Verification and commit

After Codex returns, Claude verifies the working tree directly.

Start with:
- git status --short
- git diff --stat
- git diff --name-only

Then inspect only relevant diffs/files and run deterministic checks as needed.

Claude must verify:
- changes match `.ai/task.md`
- no scope creep
- no unexpected files
- required tests/checks pass
- git diff --check passes

Do not ask Codex to re-explain information available from the repository.

If correction is required:
- do not commit
- write a bounded correction task
- delegate it to a fresh Codex session
- verify again

If accepted:
- Claude stages only accepted files
- Claude creates the local commit
- Claude verifies the resulting commit and clean working tree

Claude owns roadmap, phase ordering, product requirements, unresolved design decisions, canonical planning changes, and commit acceptance.

## Gemini review

Use Gemini selectively for:
- phase-boundary review
- high-risk changes
- regression-risk review
- independent second opinion

Treat Gemini findings as advisory and verify them against repo/docs.

Review categories:
- unexpected_blocker
- planned_gap
- implementation_risk
- spec_mismatch
- minor

Planned future work is not an unexpected blocker.

## Session lifecycle

Default: one Claude Code session per development phase.

Within a phase:
- keep the current Claude session
- delegate bounded tasks to fresh Codex sessions
- verify and commit each accepted result

At a completed phase boundary:
- ensure repo/docs contain all continuation state
- ensure working tree is clean
- launch:
  `powershell -ExecutionPolicy Bypass -File scripts/start-next-claude.ps1`
- do not use `--continue` or `--resume`
- stop work in the old Claude session
- do not start the next phase in the old session

Start a fresh Claude session earlier if context becomes bloated or stale.

Repository state must make session replacement safe.

## Cost and quota policy

Do not incur additional paid usage beyond the user's existing subscriptions.

Strict rules:
- do not purchase or enable pay-as-you-go usage
- do not use paid API fallback when a subscription quota is exhausted
- do not use paid credits, metered API access, or billing accounts without explicit user approval
- do not create API keys for paid fallback
- do not silently switch to a provider or model that may incur additional charges
- when Claude, Codex, Gemini, or another included service reaches its usage limit, stop that affected operation and report the limit
- prefer waiting for quota reset
- another model/service may be used only if already included at no additional cost and consistent with project policy

If cost status is uncertain, stop and ask the user before invoking the service.

## Filesystem boundary

For project work, access only:
- the repository root and its descendants
- tool-specific configuration strictly required to invoke approved workers

Do not inspect, search, read, write, or enumerate unrelated user directories, unrelated paths, or other drives.

Do not perform broad filesystem searches outside the repository.

If project work requires arbitrary access outside the repository, stop and ask the user first.

## Token policy

Use repository files, working-tree changes, and Git as the primary agent-to-agent communication channel.

Minimize Claude <-> Codex communication aggressively.

Do not duplicate information already available in the repository.

Agent-to-agent messages do not need to be human-friendly when a shorter machine-oriented form is sufficient.

Session handoff smoke test:
`powershell -ExecutionPolicy Bypass -File scripts/start-next-claude.ps1 -HandoffTest`

HandoffTest must not modify repository state or start development work.
