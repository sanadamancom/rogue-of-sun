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
    Send-HermesNotification "**失敗**`n`n理由: ``$Message``"
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
        $HermesPath = $script:HermesCommandPath
        if (-not $HermesPath) {
            $HermesCommand = Get-Command hermes -ErrorAction SilentlyContinue
            if ($HermesCommand) { $HermesPath = $HermesCommand.Source }
        }
        if (-not $HermesPath) { Write-Warning "Hermes notification skipped: hermes executable not found"; return }
        & $HermesPath send --to $NotifyTarget --quiet $Message
        if ($LASTEXITCODE -ne 0) { Write-Warning "Hermes notification failed with exit code $LASTEXITCODE" }
    }
    catch { Write-Warning "Hermes notification failed: $($_.Exception.Message)" }
}

function Get-OrphanedCodexWorker {
    param([datetime]$ClaudeProcessStartTime)

    @(
        Get-CimInstance Win32_Process | Where-Object {
            $CandidateProcess = $_
            if ([string]::IsNullOrWhiteSpace([string]$CandidateProcess.CommandLine) -or
                $CandidateProcess.CommandLine.IndexOf('codex', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                return $false
            }
            try {
                $WmiCreationDate = if ($CandidateProcess.CreationDate -is [datetime]) {
                    [Management.ManagementDateTimeConverter]::ToDmtfDateTime($CandidateProcess.CreationDate)
                }
                else {
                    [string]$CandidateProcess.CreationDate
                }
                $CreationTime = [Management.ManagementDateTimeConverter]::ToDateTime($WmiCreationDate)
                return $CreationTime -ge $ClaudeProcessStartTime
            }
            catch {
                Write-Warning "Hermes: could not read creation time for possible Codex worker PID $($CandidateProcess.ProcessId): $($_.Exception.Message)"
                return $false
            }
        }
    )
}

function Wait-OrphanedCodexWorker {
    param(
        [object[]]$Process,
        [int]$TimeoutSeconds
    )

    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $RemainingProcessIds = @($Process | ForEach-Object { [int]$_.ProcessId })
    while ($RemainingProcessIds.Count -gt 0 -and [DateTime]::UtcNow -lt $Deadline) {
        $RemainingProcessIds = @($RemainingProcessIds | Where-Object {
            $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue)
        })
        if ($RemainingProcessIds.Count -gt 0) {
            $RemainingMilliseconds = [int][Math]::Max(0, ($Deadline - [DateTime]::UtcNow).TotalMilliseconds)
            Start-Sleep -Milliseconds ([Math]::Min(5000, $RemainingMilliseconds))
        }
    }
    $RemainingProcessIds = @($RemainingProcessIds | Where-Object {
        $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue)
    })

    [pscustomobject]@{
        TimedOut = $RemainingProcessIds.Count -gt 0
        RemainingProcessIds = $RemainingProcessIds
    }
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

$HermesCommand = Get-Command hermes -ErrorAction SilentlyContinue
$script:HermesCommandPath = if ($HermesCommand) { $HermesCommand.Source } else { $null }
if ($Notify -and $script:HermesCommandPath) {
    $SessionNotificationContract = @"
Notifications are enabled for this session. You may send at most 3 short Japanese Discord Markdown progress notifications, and only at these checkpoints: (1) immediately after identifying the bounded phase/task, (2) immediately after delegating to Codex and before waiting for it, and (3) immediately after tests/build verification completes, with only a pass/fail summary. For checkpoints (1) and (2), use the heading "### 🔨 実装中", put phase/task identifier-like tokens in inline code, and add only 1-2 short lines. For checkpoint (3), use the heading "### 🧪 検証中", followed by only a short pass/fail summary in 1-2 lines. Use the Hermes terminal tool to invoke exactly:
& '$($script:HermesCommandPath)' send --to '$NotifyTarget' --quiet '<short Discord Markdown message>'
Do not send at any other checkpoint. Never include raw Claude/Codex stdout, full diffs, full test output, or long English narration. These messages are purely informational Discord narration: they do not update .ai/status.json or .ai/control/state.json, carry no machine-protocol meaning, and never replace the required final .ai/status.json write. The orchestrator's own notifications remain separate and unchanged.
"@
}
elseif ($Notify) {
    $SessionNotificationContract = "Notifications were requested, but hermes.exe could not be resolved. Do not attempt any in-session Discord notification."
}
else {
    $SessionNotificationContract = "Notifications are disabled for this session. Do not invoke hermes.exe or attempt any Discord notification."
}

$ExitContract = @"
This is a Hermes non-interactive orchestration session, not an interactive or Desktop session.

Regardless of outcome--successful continuation, a finished bounded task, a decision needed from a human, or an unresolved blocker--you must write a valid .ai/status.json according to docs/ops/hermes-status-protocol.md as your last action before exiting. There is no exit path that skips this requirement.

Never delegate to Codex, Gemini, Antigravity, or any other worker as a background, asynchronous, or detached task and then exit while it is still running. This Hermes non-interactive orchestration session has no later turn to resume on: once this process exits, nothing continues it, and no "I'll wait for the completion notification" promise can ever be honored, because there is no later turn in which that notification could arrive. This is not hypothetical: a prior Hermes session ran Codex through a subagent/Agent-style tool that defaulted to running in the background, stated it would wait for the notification, and then its --print turn ended with Codex still running and no .ai/status.json ever written (the orphaned commit 75edcae incident). The Agent tool and the Task tool are both disallowed for this reason; do not attempt to route around that restriction through any other subagent, plugin agent (including any codex-rescue-style agent), MCP tool, or mechanism that returns before the worker has actually finished. The only acceptable way to run Codex is a direct, blocking Bash call such as `codex exec --dangerously-bypass-approvals-and-sandbox "..."` invoked via the Bash tool, which does not return until Codex exits. Every worker delegation must be synchronous: invoke it in the foreground, wait for it to actually finish before doing anything else procedural, then independently verify its result according to the normal CLAUDE.md Codex workflow by inspecting the diff, running the required checks, and confirming scope. If the result is accepted, stage and commit it yourself exactly as in any other Claude session. Only after the full delegate synchronously -> wait -> verify -> commit-if-accepted cycle is complete may you write the final .ai/status.json and exit. An unfinished, still-running worker is never a valid reason to write SESSION_BOUNDARY or any other status and exit at a natural bounded-task boundary. If a worker genuinely cannot finish within this session, including because it would exceed the session timeout, report that honestly as BLOCKED with the human-facing Japanese reason required below; never paper it over by claiming you will finish it next time.

If a game-design, UX, balance, product, or architecture decision requires a human under CLAUDE.md, do not merely ask the question in prose and stop. Write status "USER_DECISION_REQUIRED". The reason remains one JSON string, but you must author that string itself as natural, self-contained Japanese Discord Markdown in exactly this section shape (with real newlines encoded correctly by JSON):
## ⚠️ 人による判断が必要です
**Phase:** `<phase>` / **Task:** `<task>`

**判断事項:**
<what needs to be decided>

**選択肢:**
- **A:** <option A> — <impact>
- **B:** <option B> — <impact>

**停止理由:**
<why work is currently stopped>

**人間に求める回答:**
<what answer is wanted>

Use every heading and bold section label above verbatim, including **人間に求める回答:**; do not shorten, rename, translate, or omit any label. Replace every placeholder with complete Japanese content and put phase/task identifier-like tokens in inline code. The reason must contain all context the human needs.

For an unresolved blocker, write status "BLOCKED". The reason remains one JSON string, but you must author that string itself as natural, self-contained Japanese Discord Markdown in exactly this section shape:
## 🛑 開発がブロックされました

**Phase:** `<phase>` / **Task:** `<task>`

**問題:**
<what is blocked>

**実施済み確認:**
<what was already checked or attempted>

**なぜ自動継続できないか:**
<why the normal bounded Codex-correction workflow could not resolve it>

**人間に必要な対応:**
<what action or answer is needed>

Use every heading and bold section label above verbatim; do not shorten, rename, translate, or omit any label. Replace every placeholder with complete Japanese content and put phase/task identifier-like tokens in inline code. Claude authors the final Markdown while writing reason. Hermes, Codex, and every downstream layer must forward reason verbatim exactly as written, Markdown and all; they must never reconstruct, re-summarize, translate, prefix, or reformat Claude's decision or blocker content. Only the reason field for USER_DECISION_REQUIRED and BLOCKED has this authored-language requirement. Keep phase, task, commit_sha, every other protocol field, prompt/log content, and code identifiers in their original English or source form. CONTINUE and SESSION_BOUNDARY reasons may be English or Japanese. For "CONTINUE" or "SESSION_BOUNDARY", ensure reason, phase, task, and commit_sha accurately reflect what this session actually did.

$SessionNotificationContract

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
Send-HermesNotification "## 🚀 開発開始`n`nROGUE OF SOL の開発を開始しました。"

while ($SessionCount -lt $MaxSessions) {
    if (Test-Path -LiteralPath $StopRequestPath) {
        Remove-Item -LiteralPath $StopRequestPath -Force
        Write-ControlState -Status "stopped_by_request" -Reason "Cooperative stop request honored between sessions."
        Send-HermesNotification "## ⏹️ 開発停止`n`n協調停止リクエストにより安全に停止しました。"
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
    # Disallowing Task AND Agent is a structural requirement, not best-effort: the Agent tool (e.g. subagent_type codex:codex-rescue)
    # defaults to run_in_background=true and returns immediately with a completion notification promised for "later" -- but a
    # --print session has no later turn to receive it. Confirmed root cause of the 75edcae orphaned-worker incident: Claude used
    # Agent to delegate to Codex in the background, said it would "wait for the notification", and then the --print turn ended,
    # leaving Codex running detached with no .ai/status.json ever written. Task was already disallowed and did not prevent this,
    # because Agent is a distinct tool name. Blocking both forces the only remaining delegation path: a direct, synchronous,
    # foreground `codex exec ...` Bash call, which the Bash tool already executes and blocks on. Orphan detection below remains
    # a fail-closed backstop, not the primary defense.
    if ($ClaudeCommand.CommandType -eq 'Application') {
        $ProcessInfo.FileName = $ClaudeCommand.Source
        $ProcessInfo.Arguments = '--print --dangerously-skip-permissions --disallowedTools Task,Agent'
    }
    else {
        $ProcessInfo.FileName = 'powershell.exe'
        $EscapedClaudePath = $ClaudeCommand.Source.Replace('"', '""')
        $ProcessInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$EscapedClaudePath`" --print --dangerously-skip-permissions --disallowedTools Task,Agent"
    }

    $ClaudeProcess = New-Object System.Diagnostics.Process
    $ClaudeProcess.StartInfo = $ProcessInfo
    try {
        if (-not $ClaudeProcess.Start()) {
            Stop-HermesWithError "Claude CLI process did not start"
        }
        $ClaudeProcessStartTime = $ClaudeProcess.StartTime
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
        $OrphanedWorkers = @(Get-OrphanedCodexWorker -ClaudeProcessStartTime $ClaudeProcessStartTime)
        if ($OrphanedWorkers.Count -gt 0) {
            foreach ($Worker in $OrphanedWorkers) {
                Write-Host "Hermes: detected possible orphaned Codex worker PID $($Worker.ProcessId): $($Worker.CommandLine)"
            }
            $WaitResult = Wait-OrphanedCodexWorker -Process $OrphanedWorkers -TimeoutSeconds $SessionTimeoutSeconds
            $DetectedProcessText = ($OrphanedWorkers | ForEach-Object {
                "PID $($_.ProcessId) ($($_.CommandLine))"
            }) -join '; '
            if ($WaitResult.TimedOut) {
                $WaitOutcome = "The wait timed out after $SessionTimeoutSeconds seconds; these processes were still running: $($WaitResult.RemainingProcessIds -join ', ')."
                $NotificationWaitOutcome = "待機が $SessionTimeoutSeconds 秒でタイムアウトしました。実行中の PID: ``$($WaitResult.RemainingProcessIds -join ', ')``"
                Write-Host "Hermes: timed out waiting for possible orphaned Codex worker PID(s): $($WaitResult.RemainingProcessIds -join ', ')."
            }
            else {
                $WaitOutcome = 'All detected processes finished while Hermes waited.'
                $NotificationWaitOutcome = '検出したプロセスは Hermes の待機中にすべて終了しました。'
                Write-Host 'Hermes: all possible orphaned Codex workers finished.'
            }
            $OrphanReason = "Claude exited without writing .ai/status.json. Detected possible orphaned Codex worker process(es): $DetectedProcessText. $WaitOutcome The working tree may contain unverified changes requiring human or Claude review before any further orchestration."
            Write-ControlState -Status 'orphaned_worker' -Reason $OrphanReason
            Send-HermesNotification "## ⚠️ 取り残されたバックグラウンド worker を検出しました`n`n**Phase:** ``Hermes orchestration`` / **Task:** ``orphaned worker detection```n`n**問題:**`nClaude セッションが ``.ai/status.json`` を書かずに終了し、Codex と思われるプロセスが実行中でした。`n`n**待機結果:**`n$NotificationWaitOutcome`n`n**必要な対応:**`nworking tree に未検証の変更が残っている可能性があります。次の ``start`` の前に ``hermes-dev-control.ps1 status`` と ``git status`` を確認し、人間または Claude が変更をレビューしてください。"
            Write-Error 'Hermes fail-closed: Claude CLI did not write .ai/status.json and possible orphaned Codex worker process(es) were detected'
            exit 1
        }
        Stop-HermesWithError "Claude CLI did not write .ai/status.json"
    }

    try {
        $SessionStatus = Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
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
        Send-HermesNotification "## ✅ タスク完了`n`nコミット: ``$CurrentCommitSha```n限定タスクをコミットしました。"
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
        $PublishScriptPath = Join-Path $PSScriptRoot 'hermes-publish-decision-base.ps1'
        $PublishOutput = @()
        $PublishExitCode = 1
        try {
            $PreviousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $PublishOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PublishScriptPath -RepoDir $ResolvedRepoDir -DecisionId $DecisionId -Json 2>&1)
            $PublishExitCode = $LASTEXITCODE
            $ErrorActionPreference = $PreviousErrorActionPreference
        }
        catch {
            $ErrorActionPreference = $PreviousErrorActionPreference
            $PublishOutput = @($_.Exception.Message)
            $PublishExitCode = 1
        }
        $PublishText = (($PublishOutput | ForEach-Object { [string]$_ }) -join "`n").Trim()
        $PublishResult = $null
        if ($PublishExitCode -eq 0) {
            try { $PublishResult = $PublishText | ConvertFrom-Json -ErrorAction Stop }
            catch { $PublishOutput += "Invalid publish JSON: $($_.Exception.Message)" }
        }
        if ($PublishExitCode -eq 0 -and $PublishResult -and $PublishResult.verified -eq $true) {
            $Pending['published'] = $true
            $Pending['decisionBranch'] = [string]$PublishResult.decisionBranch
            Write-JsonAtomic -Path $PendingDecisionPath -Value $Pending
            $PublishHeader = "## ⚠️ Decision Base Published`n`n**Repository:** ``$($PublishResult.repositorySlug)```n**Branch:** ``$($PublishResult.decisionBranch)```n**Decision Base Commit:** ``$($PublishResult.commitSha)```n**Working Tree:** ``clean```n`n"
            Send-HermesNotification ($PublishHeader + [string]$SessionStatus.reason)
        }
        else {
            $FailureText = (($PublishOutput | ForEach-Object { [string]$_ }) -join "`n").Trim()
            if ([string]::IsNullOrWhiteSpace($FailureText)) { $FailureText = "publish process exited with code $PublishExitCode" }
            if ($FailureText.Length -gt 1000) { $FailureText = $FailureText.Substring(0, 1000) + '...' }
            $Pending['published'] = $false
            $Pending['publishFailureReason'] = $FailureText
            Write-JsonAtomic -Path $PendingDecisionPath -Value $Pending
            $FailureBlock = "`n`n`n**⚠️ Decision Base publish に失敗しました。ChatGPT はこの commit をまだ参照できません。**`nDecision Base SHA: ``$([string]$SessionStatus.commit_sha)```n失敗理由: $FailureText"
            Send-HermesNotification ([string]$SessionStatus.reason + $FailureBlock)
        }
    }
    elseif ($SessionStatus.status -eq 'BLOCKED') {
        Send-HermesNotification ([string]$SessionStatus.reason)
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
        Send-HermesNotification "### 🔄 セッション交代`n`n新しいセッションで自動継続します。"
    }
    Write-Host "Hermes: status permits autonomous continuation; starting a fresh session."
}
