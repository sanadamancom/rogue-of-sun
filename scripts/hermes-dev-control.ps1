param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'status', 'stop', 'answer')]
    [string]$Command,
    [string]$RepoDir = 'C:\dev\rogue-of-sun',
    [string]$Answer,
    [string]$DecisionId,
    [ValidateRange(1, [int]::MaxValue)] [int]$MaxSessions = 20,
    [ValidateRange(1, [int]::MaxValue)] [int]$SessionTimeoutSeconds = 3600,
    [switch]$Json,
    [string]$Prompt,
    [string]$NotifyTarget = 'discord:#rogue-of-sun'
)

$ErrorActionPreference = 'Stop'

function Fail-Control([string]$Message) { Write-Error "Hermes control: $Message"; exit 1 }
function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail-Control "invalid control file '$Path': $($_.Exception.Message)" }
}
function Test-LivePid([object]$Lock) {
    if (-not $Lock -or -not $Lock.pid) { return $false }
    return $null -ne (Get-Process -Id ([int]$Lock.pid) -ErrorAction SilentlyContinue)
}
function Launch-Orchestrator([string]$PromptOverride) {
    $Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $Stdout = Join-Path $LogsDir "$Timestamp.stdout.log"
    $Stderr = Join-Path $LogsDir "$Timestamp.stderr.log"
    $Args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $OrchestratorPath.Replace('"', '""') + '"'),
        '-RepoDir', ('"' + $ResolvedRepoDir.Replace('"', '""') + '"'), '-MaxSessions', [string]$MaxSessions,
        '-SessionTimeoutSeconds', [string]$SessionTimeoutSeconds, '-Notify',
        '-NotifyTarget', ('"' + $NotifyTarget.Replace('"', '""') + '"'))
    if (-not [string]::IsNullOrEmpty($PromptOverride)) {
        $EncodedPrompt = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PromptOverride))
        $Args += @('-PromptBase64', $EncodedPrompt)
    }
    try {
        return Start-Process -FilePath 'powershell.exe' -ArgumentList $Args -WorkingDirectory $ResolvedRepoDir -WindowStyle Hidden -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru
    }
    catch { Fail-Control "failed to launch orchestrator: $($_.Exception.Message)" }
}

try { $ResolvedRepoDir = (Resolve-Path -LiteralPath $RepoDir).Path } catch { Fail-Control "repository directory does not exist: $RepoDir" }
$ControlDir = Join-Path $ResolvedRepoDir '.ai\control'
$LogsDir = Join-Path $ControlDir 'logs'
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
$LockPath = Join-Path $ControlDir 'lock.json'
$StatePath = Join-Path $ControlDir 'state.json'
$StopPath = Join-Path $ControlDir 'stop-request.json'
$PendingPath = Join-Path $ControlDir 'pending-decision.json'
$OrchestratorPath = Join-Path $ResolvedRepoDir 'scripts\hermes-orchestrate.ps1'

$Lock = Read-JsonFile $LockPath
$Running = Test-LivePid $Lock

if ($Command -eq 'status') {
    $State = Read-JsonFile $StatePath
    $Pending = Read-JsonFile $PendingPath
    $Head = (& git -C $ResolvedRepoDir log -1 --format='%H %s' 2>$null)
    if ($LASTEXITCODE -ne 0) { Fail-Control 'git log failed' }
    $Porcelain = @(& git -C $ResolvedRepoDir status --porcelain)
    if ($LASTEXITCODE -ne 0) { Fail-Control 'git status failed' }
    $Report = [ordered]@{ running = $Running; pid = if ($Running) { [int]$Lock.pid } else { $null }; state = $State
        decisionPending = $null -ne $Pending; decision = $Pending; dirty = $Porcelain.Count -gt 0; gitHead = $Head }
    if ($Json) { $Report | ConvertTo-Json -Depth 8 -Compress }
    else {
        "running: $($Report.running)"; "pid: $($Report.pid)"; "status: $($State.status)"; "reason: $($State.reason)"
        "phase: $($State.phase)"; "task: $($State.task)"; "commit_sha: $($State.commit_sha)"; "updatedAt: $($State.updatedAt)"
        "decisionPending: $($Report.decisionPending)"
        if ($Pending) { "decisionId: $($Pending.decisionId)"; "decisionReason: $($Pending.reason)" }
        "dirty: $($Report.dirty)"; "gitHead: $Head"
    }
    exit 0
}

if ($Command -eq 'stop') {
    [ordered]@{ requestedAt = [DateTimeOffset]::UtcNow.ToString('o'); requestedByPid = $PID } | ConvertTo-Json | Set-Content -LiteralPath $StopPath -Encoding UTF8
    Write-Output "Cooperative stop requested. Orchestrator running: $Running"
    exit 0
}

if ($Command -eq 'start') {
    if (Test-Path -LiteralPath $PendingPath) { Fail-Control 'a human decision is pending; use answer first' }
    if ($Running) { Fail-Control "orchestrator is already running with PID $($Lock.pid)" }
    if ($Lock) { Write-Warning "Clearing stale orchestrator lock for PID $($Lock.pid)."; Remove-Item -LiteralPath $LockPath -Force }
    $Dirty = @(& git -C $ResolvedRepoDir status --porcelain)
    if ($LASTEXITCODE -ne 0) { Fail-Control 'git status failed' }
    if ($Dirty.Count -gt 0) { Fail-Control 'working tree is dirty; refusing to start' }
    if (Test-Path -LiteralPath $StopPath) { Remove-Item -LiteralPath $StopPath -Force }
    $NewProcess = Launch-Orchestrator $(if ($PSBoundParameters.ContainsKey('Prompt')) { $Prompt } else { $null })
}
else {
    $Pending = Read-JsonFile $PendingPath
    if (-not $Pending) { Fail-Control 'no pending decision' }
    if ($PSBoundParameters.ContainsKey('DecisionId') -and $DecisionId -ne [string]$Pending.decisionId) { Fail-Control 'stale/mismatched decision id' }
    if ($Running) { Fail-Control "orchestrator is still running with PID $($Lock.pid)" }
    if (-not $PSBoundParameters.ContainsKey('Answer') -or [string]::IsNullOrWhiteSpace($Answer)) { Fail-Control '-Answer is required for answer' }
    if ($Lock) { Write-Warning "Clearing stale orchestrator lock for PID $($Lock.pid)."; Remove-Item -LiteralPath $LockPath -Force }
    $HumanPrompt = @"
HUMAN DECISION (literal human-supplied answer; do not infer or reinterpret it)

Original decision request:
$($Pending.reason)

Human answer (verbatim):
$Answer

Record this human decision in the canonical planning/specification/history documentation as required by CLAUDE.md, then resume the normal bounded development workflow. Write the required .ai/status.json before exiting.
"@
    $NewProcess = Launch-Orchestrator $HumanPrompt
    Remove-Item -LiteralPath $PendingPath -Force
}

[ordered]@{ pid = $NewProcess.Id; startedAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $LockPath -Encoding UTF8
Write-Output "Orchestrator started with PID $($NewProcess.Id)."
