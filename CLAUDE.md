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