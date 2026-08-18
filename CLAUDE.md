# ROGUE OF SOL Project Policy

## Roles

Claude Code:
- PM
- task decomposition
- specification authority
- integration owner
- final reviewer

Codex:
- primary implementation worker
- edits the local repository directly
- runs tests/checks
- creates local git commits

Gemini / Antigravity:
- independent read-only reviewer
- advisory only

## Source of truth

Use the repository as authoritative shared state.

Priority:
1. current source and git history for implemented facts
2. docs/planning/rogue-of-sun-development-plan.md
3. docs/planning/rogue-of-sun-phase24-6c-long-run-balance-design.md
4. docs/specs/
5. docs/history/

Do not use model conversation history as the source of truth when repository information exists.

## Claude -> Codex

Claude chooses exactly one bounded implementation task.

Codex must inspect the repository and canonical documents itself.

Do not transfer source code, diffs, logs, or long repository context through agent messages when Codex can read them locally.

Codex may:
- inspect repository files
- edit source and tests
- update implementation history
- run relevant tests/build/typecheck/lint
- git add
- git commit

Codex must not:
- choose the next phase
- expand task scope
- change product requirements
- change roadmap decisions
- push
- merge
- rebase
- reset --hard
- git clean
- delete branches
- rewrite history

## Minimal completion protocol

On success, Codex should return only:

DONE <commit-sha>

Optional second line:

NOTE <short-warning>

On failure:

FAIL <short-reason>

Do not return source code, diffs, long summaries, or test logs.

Claude reads those directly from git and the repository.

## Claude verification

After Codex finishes, Claude verifies directly from the repository.

Prefer:
- git status
- git show --stat <sha>
- targeted git diff
- relevant files
- relevant deterministic checks

Do not ask Codex to explain information already available in the commit.

If correction is needed, delegate a new bounded correction task to Codex.

## Documentation

Codex may update:
- docs/history/
- implementation records
- factual documentation required by the delegated task

Claude owns:
- roadmap
- phase ordering
- product requirements
- unresolved design decisions
- canonical planning changes

## Gemini

Gemini / Antigravity is an independent read-only reviewer.

Use model:
- Gemini 3.1 Pro (High)

Use Gemini selectively for:
- phase-boundary review
- high-risk implementation review
- independent regression-risk review
- post-Codex second opinion when useful

Gemini must not:
- edit files
- create files
- delete files
- run shell commands
- run git commands
- modify repository state

Gemini findings are advisory only.

Claude must independently verify Gemini findings against:
- repository state
- canonical planning documents
- specifications
- git history

Do not classify a planned future implementation item as an unexpected blocker.

Prefer these review categories:
- unexpected_blocker
- planned_gap
- implementation_risk
- spec_mismatch
- minor

## Token policy

Minimize Claude <-> Codex communication aggressively.

Git and repository files are the primary communication channel.

Messages do not need to be human-friendly if a shorter machine-oriented form is sufficient.
## Task handoff

Use `.ai/task.md` as the implementation contract for Codex.

Claude writes or updates `.ai/task.md`.
Codex reads `.ai/task.md` and repository sources directly.

Claude -> Codex message should normally be:

Implement .ai/task.md. Inspect repo/docs directly. Commit locally. Return protocol only.

Do not duplicate task details in agent messages.

`.ai/` is local-only and must not be committed.

## Session lifecycle

Use one Claude Code session per development phase by default.

Within a phase:
- keep the same Claude session
- delegate bounded implementation tasks to Codex
- verify each Codex commit before continuing

At a phase boundary:
- finish and verify the current phase
- ensure repository state and canonical docs contain everything needed for continuation
- do not rely on conversation-only context
- tell the user that the current Claude session can be closed
- provide one minimal bootstrap prompt for a new Claude session

The bootstrap prompt should normally be:

Continue ROGUE OF SOL development. Read CLAUDE.md, current git state, canonical planning/spec/history docs, determine the current phase and next bounded task, then proceed according to project policy.

Do not carry large summaries between Claude sessions when the information is already present in the repository.

Start a fresh session earlier if:
- conversation context has become unnecessarily large
- the task changes to a substantially different phase or objective
- stale conversational assumptions could interfere with repository truth

Repository state, not Claude session history, must make session replacement safe.

At a completed phase boundary, when the repository state is finalized and clean:

- launch the next Claude Code session with:
  `powershell -ExecutionPolicy Bypass -File scripts/start-next-claude.ps1`
- do not use `--continue` or `--resume`
- after the new session is launched, stop work in the current session
- do not continue implementing the next phase in the old session
