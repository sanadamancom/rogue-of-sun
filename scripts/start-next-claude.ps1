param(
    [switch]$HandoffTest
)

$ErrorActionPreference = "Stop"

$RepoDir = "D:\rogue-of-sun"
Set-Location $RepoDir

if ($HandoffTest) {
    $Prompt = @"
This is a Claude session handoff smoke test.

Read CLAUDE.md and inspect the current repository state.

Do not:
- modify any file
- invoke Codex or Gemini
- create a commit
- push
- start or advance any development phase
- create or update .ai/task.md

After verifying the repository context, output only:

HANDOFF_OK
BRANCH <current-branch>
HEAD <full-head-sha>

Then stop.
"@
}
else {
    $Prompt = @"
Continue ROGUE OF SOL development.

Read CLAUDE.md, current git state, and canonical planning/spec/history documents.
Recover the current development state from the repository.

Follow CLAUDE.md strictly.
Do not rely on prior Claude conversation history.
Determine the current phase and next bounded task, then proceed according to project policy.
"@
}

claude $Prompt
