param(
    [string]$RepoDir = "C:\dev\rogue-of-sun",
    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxSessions = 1,
    [ValidateRange(1, [int]::MaxValue)]
    [int]$SessionTimeoutSeconds = 3600,
    [string]$Prompt,
    [string]$PromptBase64,
    [switch]$SmokeTest,
    [switch]$Notify,
    [string]$NotifyTarget = 'discord:#rogue-of-sun'
)

$ErrorActionPreference = "Stop" # All process and protocol anomalies fail closed.

function Stop-HermesWithError {
    param([string]$Message)
    if ($script:ControlStatePath) {
        Write-ControlState -Status "failed" -Reason $Message
    }
    Send-HermesNotification "ROGUE OF SOL オーケストレーション失敗: $Message"
    Write-Error "Hermes fail-closed: $Message"
    exit 1
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $TempPath = "$Path.tmp.$PID"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $TempPath -Encoding UTF8
    Move-Item -LiteralPath $TempPath -Destination $Path -Force
}

function Write-ControlState {
    param(
        [string]$Status,
        [string]$Reason = $null,
        [object]$SessionStatus = $null
    )
    if (-not $script:ControlStatePath) { return }
    $State = [ordered]@{
        status = $Status; reason = $Reason; phase = $null; task = $null
        commit_sha = $null; updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        sessionCount = $script:SessionCount; maxSessions = $MaxSessions; pid = $PID
    }
    if ($SessionStatus) {
        $State.reason = [string]$SessionStatus.reason
        $State.phase = $SessionStatus.phase
        $State.task = $SessionStatus.task
        $State.commit_sha = $SessionStatus.commit_sha
    }
    Write-JsonAtomic -Path $script:ControlStatePath -Value $State
}

function Send-HermesNotification {
    param([string]$Message)
    if (-not $Notify) { return }
    try {
        $HermesCommand = Get-Command hermes -ErrorAction SilentlyContinue
        if (-not $HermesCommand) { Write-Warning "Hermes notification skipped: hermes executable not found"; return }
        & $HermesCommand.Source send --to $NotifyTarget --quiet $Message
        if ($LASTEXITCODE -ne 0) { Write-Warning "Hermes notification failed with exit code $LASTEXITCODE" }
    }
    catch { Write-Warning "Hermes notification failed: $($_.Exception.Message)" }
}

try {
    $ResolvedRepoDir = (Resolve-Path -LiteralPath $RepoDir -ErrorAction Stop).Path
}
catch {
    Stop-HermesWithError "repository directory does not exist: $RepoDir"
}

$ControlDir = Join-Path $ResolvedRepoDir ".ai\control"
New-Item -ItemType Directory -Path $ControlDir -Force | Out-Null
$script:ControlStatePath = Join-Path $ControlDir "state.json"
$StopRequestPath = Join-Path $ControlDir "stop-request.json"
$PendingDecisionPath = Join-Path $ControlDir "pending-decision.json"
$script:SessionCount = 0

$ExitContract = @"
This is a Hermes non-interactive orchestration session, not an interactive or Desktop session.

Regardless of outcome--successful continuation, a finished bounded task, a decision needed from a human, or an unresolved blocker--you must write a valid .ai/status.json according to docs/ops/hermes-status-protocol.md as your last action before exiting. There is no exit path that skips this requirement.

If a game-design, UX, balance, product, or architecture decision requires a human under CLAUDE.md, do not merely ask the question in prose and stop. Write status "USER_DECISION_REQUIRED". Its reason must be self-contained so an upstream notification surface such as Discord can forward it verbatim: state the decision needed, why it blocks progress, the concrete options being considered (for example, "A: ... / B: ..."), and all context the human needs to answer.

For an unresolved blocker, write status "BLOCKED" and explain the blocker and why the normal bounded Codex-correction workflow could not resolve it. For "CONTINUE" or "SESSION_BOUNDARY", ensure reason, phase, task, and commit_sha accurately reflect what this session actually did.

Hermes treats a missing or invalid .ai/status.json as a hard failure regardless of terminal output. A prose-only answer is never sufficient.
"@

if ($SmokeTest) {
    $MaxSessions = 1
    $EffectivePrompt = @"
$ExitContract

This is a read-only Hermes CLI handoff smoke test.

Read CLAUDE.md and inspect the current repository state only as needed.
Do not modify any repository file except .ai/status.json. Do not modify .ai/task.md.
Do not invoke Codex, Gemini, or Antigravity. Do not commit, push, merge, rebase, or start development work.

As an example appropriate to this smoke test, write .ai/status.json with this protocol shape:
{
  "protocol_version": 1,
  "status": "SESSION_BOUNDARY",
  "reason": "Hermes read-only smoke test completed",
  "phase": null,
  "task": "Hermes smoke test",
  "commit_sha": null
}
Make no other repository changes, then exit.
"@
}
elseif ($PSBoundParameters.ContainsKey('PromptBase64')) {
    try { $DecodedPrompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PromptBase64)) }
    catch { Stop-HermesWithError "PromptBase64 is invalid: $($_.Exception.Message)" }
    $EffectivePrompt = @"
$ExitContract

$DecodedPrompt
"@
}
elseif ($PSBoundParameters.ContainsKey('Prompt')) {
    $EffectivePrompt = @"
$ExitContract

$Prompt
"@
}
else {
    $EffectivePrompt = @"
$ExitContract

Continue ROGUE OF SOL development in a fresh non-interactive Claude CLI session.

Read CLAUDE.md, current git state, and canonical planning/spec/history documents. Recover the current development state from the repository and follow CLAUDE.md strictly. Do not rely on prior conversation history. Determine the current phase and next bounded task, then proceed according to project policy.

Hermes uses only .ai/status.json for its continuation decision. Do not push, merge, rebase, or rewrite history.
"@
}

$GitDirectory = & git -C $ResolvedRepoDir rev-parse --git-dir 2>$null
if ($LASTEXITCODE -ne 0 -or -not $GitDirectory) {
    Stop-HermesWithError "not a git repository: $ResolvedRepoDir"
}

try {
    $ClaudeCommand = Get-Command claude -ErrorAction Stop
}
catch {
    Stop-HermesWithError "the claude CLI was not found on PATH"
}

$StatusPath = Join-Path $ResolvedRepoDir ".ai\status.json"
$SessionCount = 0
$script:SessionCount = 0
$KnownStatuses = @("CONTINUE", "SESSION_BOUNDARY", "USER_DECISION_REQUIRED", "BLOCKED")
$PreviousCommitSha = $null
try { $PreviousCommitSha = (& git -C $ResolvedRepoDir log -1 --format=%H 2>$null) } catch {}
Write-ControlState -Status "running" -Reason "orchestration started"
Send-HermesNotification "ROGUE OF SOL 開発を開始しました。"

while ($SessionCount -lt $MaxSessions) {
    if (Test-Path -LiteralPath $StopRequestPath) {
        Remove-Item -LiteralPath $StopRequestPath -Force
        Write-ControlState -Status "stopped_by_request" -Reason "Cooperative stop request honored between sessions."
        Send-HermesNotification "ROGUE OF SOL オーケストレーションを手動停止しました。"
        exit 0
    }
    $DisplaySession = $SessionCount + 1
    Write-Host "Hermes: checking repository state before session $DisplaySession of $MaxSessions."
    $WorkingTreeStatus = @(& git -C $ResolvedRepoDir status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        Stop-HermesWithError "git status failed"
    }
    if ($WorkingTreeStatus.Count -gt 0) {
        Stop-HermesWithError "working tree is dirty; refusing to launch a session"
    }

    if (Test-Path -LiteralPath $StatusPath) {
        Write-Host "Hermes: removing stale status file."
        Remove-Item -LiteralPath $StatusPath -Force
    }

    Write-Host "Hermes: launching fresh non-interactive Claude CLI session $DisplaySession of $MaxSessions."
    $ProcessInfo = New-Object System.Diagnostics.ProcessStartInfo
    $ProcessInfo.WorkingDirectory = $ResolvedRepoDir
    $ProcessInfo.UseShellExecute = $false
    $ProcessInfo.RedirectStandardInput = $true

    # Headless Hermes has no human to approve tools; bypassing prompts keeps orchestration functional while CLAUDE.md, the prompt contract, and status validation still enforce project policy.
    if ($ClaudeCommand.CommandType -eq 'Application') {
        $ProcessInfo.FileName = $ClaudeCommand.Source
        $ProcessInfo.Arguments = '--print --dangerously-skip-permissions'
    }
    else {
        $ProcessInfo.FileName = 'powershell.exe'
        $EscapedClaudePath = $ClaudeCommand.Source.Replace('"', '""')
        $ProcessInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$EscapedClaudePath`" --print --dangerously-skip-permissions"
    }

    $ClaudeProcess = New-Object System.Diagnostics.Process
    $ClaudeProcess.StartInfo = $ProcessInfo
    try {
        if (-not $ClaudeProcess.Start()) {
            Stop-HermesWithError "Claude CLI process did not start"
        }
        $ClaudeProcess.StandardInput.Write($EffectivePrompt)
        $ClaudeProcess.StandardInput.Close()
    }
    catch {
        Stop-HermesWithError "failed to start Claude CLI: $($_.Exception.Message)"
    }

    if (-not $ClaudeProcess.WaitForExit($SessionTimeoutSeconds * 1000)) {
        Write-Error "Hermes: Claude CLI exceeded the $SessionTimeoutSeconds-second timeout; stopping it."
        try { $ClaudeProcess.Kill() } catch { Write-Error "Hermes: failed to stop timed-out process: $($_.Exception.Message)" }
        $ClaudeProcess.WaitForExit()
        Stop-HermesWithError "Claude CLI session timed out"
    }

    if ($ClaudeProcess.ExitCode -ne 0) {
        Stop-HermesWithError "Claude CLI exited with code $($ClaudeProcess.ExitCode)"
    }
    Write-Host "Hermes: Claude CLI exited successfully; reading status file."

    if (-not (Test-Path -LiteralPath $StatusPath -PathType Leaf)) {
        Stop-HermesWithError "Claude CLI did not write .ai/status.json"
    }

    try {
        $SessionStatus = Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        Stop-HermesWithError ".ai/status.json is not valid JSON: $($_.Exception.Message)"
    }

    if ($SessionStatus.protocol_version -ne 1) {
        Stop-HermesWithError "unrecognized status protocol_version '$($SessionStatus.protocol_version)'"
    }
    if ([string]$SessionStatus.status -notin $KnownStatuses) {
        Stop-HermesWithError "unrecognized status '$($SessionStatus.status)'"
    }

    $SessionCount++
    $script:SessionCount = $SessionCount
    Write-ControlState -Status ([string]$SessionStatus.status) -SessionStatus $SessionStatus
    Write-Host "Hermes: status=$($SessionStatus.status); reason=$($SessionStatus.reason); phase=$($SessionStatus.phase); task=$($SessionStatus.task); commit_sha=$($SessionStatus.commit_sha)"

    $CurrentCommitSha = [string]$SessionStatus.commit_sha
    if ($CurrentCommitSha -and $CurrentCommitSha -ne $PreviousCommitSha) {
        Send-HermesNotification "ROGUE OF SOL 限定タスクをコミットしました: $CurrentCommitSha"
        $PreviousCommitSha = $CurrentCommitSha
    }

    if ($SessionStatus.status -eq 'USER_DECISION_REQUIRED') {
        $DecisionSource = "$($SessionStatus.reason)|$($SessionStatus.phase)|$($SessionStatus.task)|$([DateTimeOffset]::UtcNow.ToString('o'))"
        $Hasher = [System.Security.Cryptography.SHA256]::Create()
        try { $DecisionId = ([BitConverter]::ToString($Hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($DecisionSource))).Replace('-', '').Substring(0, 12).ToLowerInvariant()) }
        finally { $Hasher.Dispose() }
        $Pending = [ordered]@{
            decisionId = $DecisionId; status = 'USER_DECISION_REQUIRED'; reason = [string]$SessionStatus.reason
            phase = $SessionStatus.phase; task = $SessionStatus.task; commit_sha = $SessionStatus.commit_sha
            createdAt = [DateTimeOffset]::UtcNow.ToString('o')
        }
        Write-JsonAtomic -Path $PendingDecisionPath -Value $Pending
        Send-HermesNotification "ROGUE OF SOL 人による判断が必要です: $($SessionStatus.reason)"
    }
    elseif ($SessionStatus.status -eq 'BLOCKED') {
        Send-HermesNotification "ROGUE OF SOL ブロックされています: $($SessionStatus.reason)"
    }

    if ($SessionStatus.status -in @('USER_DECISION_REQUIRED', 'BLOCKED')) {
        Write-Host "Hermes: controlled stop requested by status '$($SessionStatus.status)': $($SessionStatus.reason)"
        exit 0
    }

    if ($SessionCount -ge $MaxSessions) {
        Write-Host "Hermes: maximum session cap ($MaxSessions) reached; stopping normally."
        exit 0
    }

    if ($SessionStatus.status -eq 'SESSION_BOUNDARY') {
        Send-HermesNotification "ROGUE OF SOL セッションを交代し、新しいセッションで自動継続します。"
    }
    Write-Host "Hermes: status permits autonomous continuation; starting a fresh session."
}
