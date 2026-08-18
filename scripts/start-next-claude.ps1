param(
    [switch]$HandoffTest
)

$ErrorActionPreference = "Stop"

$RepoDir = "D:\rogue-of-sun"

if ($HandoffTest) {
    $Prompt = @"
This is a Claude Code Desktop session handoff smoke test.

Read CLAUDE.md and inspect the current repository state.

Do not:
- modify any file
- modify .ai/task.md
- invoke Codex or Gemini
- create a commit
- push
- start or advance any development phase

Output only:

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

$EncodedPrompt = [System.Uri]::EscapeDataString($Prompt)
$EncodedFolder = [System.Uri]::EscapeDataString($RepoDir)

$Uri = "claude://code/new?q=$EncodedPrompt&folder=$EncodedFolder"

Start-Process $Uri
