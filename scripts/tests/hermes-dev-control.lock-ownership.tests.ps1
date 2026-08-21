$ErrorActionPreference = 'Stop'

# Synthetic regression coverage for the PID-reuse / lock-ownership fix.
# No real Hermes orchestrator, Claude CLI, or Codex is ever launched here.
# "Unrelated process" scenarios use a throwaway PowerShell process that this
# test itself spawns and owns; it is never a real Hermes orchestrator and is
# always cleaned up by this test, never left for the control script to
# discover killable.

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LockIdentitySource = Join-Path $RepoRoot 'scripts\hermes-lock-identity.ps1'
$ControllerSource = Join-Path $RepoRoot 'scripts\hermes-dev-control.ps1'
. $LockIdentitySource

$Fixtures = [System.Collections.Generic.List[string]]::new()
$SpawnedBystanders = [System.Collections.Generic.List[int]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-NoKillVerbsInSource {
    # Fail-closed guarantee, verified statically rather than dynamically:
    # this sandboxed host's own nested-process cleanup semantics (a Job
    # Object cascade unrelated to this repo's code -- confirmed by spawning
    # bystanders through WMI, outside this test's process tree, and still
    # observing them swept when a nested `powershell -File` child exits)
    # make "is the bystander PID still alive after N seconds" an unreliable
    # signal in this environment. The actual safety property that matters --
    # the control script never issues a command that could terminate an
    # unrelated process -- is verified directly against the source instead.
    $ForbiddenPatterns = @('taskkill', 'Stop-Process', 'Stop-Service', 'net stop', '\.Kill\(')
    foreach ($Path in @($ControllerSource, $LockIdentitySource)) {
        $Text = Get-Content -LiteralPath $Path -Raw
        foreach ($Pattern in $ForbiddenPatterns) {
            Assert-True (-not [regex]::IsMatch($Text, $Pattern, 'IgnoreCase')) "$(Split-Path $Path -Leaf) must not contain '$Pattern'"
        }
    }
}

function Start-Bystander {
    # A process this test owns and will stop itself. Stands in for "some
    # unrelated process now holds this PID" without depending on real OS PID
    # reuse timing.
    $Proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 120') -WindowStyle Hidden -PassThru
    $SpawnedBystanders.Add($Proc.Id)
    Start-Sleep -Milliseconds 300
    $Proc.Refresh()
    return $Proc
}

function Stop-Bystander([System.Diagnostics.Process]$Proc) {
    if (-not $Proc) { return }
    try { if (-not $Proc.HasExited) { Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue } } catch {}
    $SpawnedBystanders.Remove($Proc.Id) | Out-Null
}

function New-ControlFixture {
    $Root = Join-Path ([System.IO.Path]::GetTempPath()) ('hermes-lock-test-' + [guid]::NewGuid().ToString('N'))
    $Scripts = Join-Path $Root 'scripts'
    $Control = Join-Path $Root '.ai\control'
    New-Item -ItemType Directory -Path $Scripts, $Control -Force | Out-Null
    Copy-Item -LiteralPath $ControllerSource -Destination (Join-Path $Scripts 'hermes-dev-control.ps1')
    Copy-Item -LiteralPath $LockIdentitySource -Destination (Join-Path $Scripts 'hermes-lock-identity.ps1')

    # Stub orchestrator: idles under this test's control instead of running
    # the production orchestrator.
    $Stub = @'
param(
    [string]$RepoDir,
    [int]$MaxSessions,
    [int]$SessionTimeoutSeconds,
    [switch]$Notify,
    [string]$NotifyTarget,
    [string]$PromptBase64
)
Start-Sleep -Seconds 120
'@
    Set-Content -LiteralPath (Join-Path $Scripts 'hermes-orchestrate.ps1') -Value $Stub -Encoding UTF8
    $Fixtures.Add($Root)

    # 'start' requires a clean git working tree; .ai/control holds this
    # fixture's own lock/log/pending-decision scratch files, which must not
    # count as dirt.
    Set-Content -LiteralPath (Join-Path $Root '.gitignore') -Value ".ai/`n" -Encoding UTF8
    & git -C $Root init --quiet
    & git -C $Root config user.email 'test@example.invalid'
    & git -C $Root config user.name 'test'
    & git -C $Root add -A
    & git -C $Root commit --quiet -m 'init'

    return $Root
}

function Invoke-Control([string]$Root, [string]$Command, [string[]]$ExtraArgs) {
    $Controller = Join-Path $Root 'scripts\hermes-dev-control.ps1'
    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Controller -Command $Command -RepoDir $Root @ExtraArgs 2>&1)
    $ExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorAction
    return [pscustomobject]@{ ExitCode = $ExitCode; Text = ($Output -join "`n") }
}

function Write-Lock([string]$Root, [hashtable]$Fields) {
    $Ordered = [ordered]@{}
    foreach ($Key in $Fields.Keys) { $Ordered[$Key] = $Fields[$Key] }
    $Ordered | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root '.ai\control\lock.json') -Encoding UTF8
}

function Set-Pending([string]$Root, [string]$Id = 'decision-test') {
    [ordered]@{ decisionId = $Id; reason = 'synthetic decision reason' } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root '.ai\control\pending-decision.json') -Encoding UTF8
}

try {
    Assert-NoKillVerbsInSource

    # --- Case 1: genuine live orchestrator -> running=True ---
    $Bystander = Start-Bystander
    $Lock = [pscustomobject]@{ pid = $Bystander.Id; processStartTimeUtc = $Bystander.StartTime.ToUniversalTime().ToString('o') }
    Assert-True (Test-LivePid $Lock) 'Case 1: matching pid+start-time identity must be treated as live'
    Stop-Bystander $Bystander

    # --- Case 2: process has exited -> running=False, treated as stale ---
    $Bystander = Start-Bystander
    $ExitedLock = [pscustomobject]@{ pid = $Bystander.Id; processStartTimeUtc = $Bystander.StartTime.ToUniversalTime().ToString('o') }
    Stop-Bystander $Bystander
    Start-Sleep -Milliseconds 300
    Assert-True (-not (Test-LivePid $ExitedLock)) 'Case 2: exited process must not be treated as live'

    # --- Case 3: PID reuse (same pid, mismatched process identity) -> running=False ---
    $Bystander = Start-Bystander
    $ReusedLock = [pscustomobject]@{ pid = $Bystander.Id; processStartTimeUtc = ([DateTime]::UtcNow.AddDays(-1)).ToString('o') }
    Assert-True (-not (Test-LivePid $ReusedLock)) 'Case 3: pid match with mismatched start time must not be treated as live'
    $Bystander.Refresh()
    Assert-True (-not $Bystander.HasExited) 'Case 3: the ownership check itself (Test-LivePid, a pure read-only query) must not have touched the unrelated process'
    Stop-Bystander $Bystander

    # --- Case 4: legacy lock (pid only), unrelated process happens to hold that pid ---
    $Bystander = Start-Bystander
    $LegacyLock = [pscustomobject]@{ pid = $Bystander.Id }
    Assert-True (-not (Test-LivePid $LegacyLock)) 'Case 4: legacy pid-only lock must never be trusted as live'
    $Bystander.Refresh()
    Assert-True (-not $Bystander.HasExited) 'Case 4: the ownership check itself must not have touched the unrelated process'
    Stop-Bystander $Bystander

    # --- Case 5: answer + stale reused pid must not be falsely rejected ---
    # (the "must not kill the bystander" property for this end-to-end path is
    # covered by Assert-NoKillVerbsInSource above, not by a live-process
    # check here -- see that function's comment for why.)
    $Root = New-ControlFixture
    Set-Pending $Root
    $Bystander = Start-Bystander
    Write-Lock $Root @{ pid = $Bystander.Id; processStartTimeUtc = ([DateTime]::UtcNow.AddDays(-1)).ToString('o') }
    $Result = Invoke-Control $Root 'answer' @('-Answer', 'synthetic test answer')
    Assert-True ($Result.ExitCode -eq 0) "Case 5: answer must not be falsely rejected as orchestrator-still-running for a reused-pid stale lock. Output: $($Result.Text)"
    Stop-Bystander $Bystander
    $NewLockPath = Join-Path $Root '.ai\control\lock.json'
    if (Test-Path -LiteralPath $NewLockPath) {
        $NewLockPid = [int]((Get-Content -LiteralPath $NewLockPath -Raw | ConvertFrom-Json).pid)
        try { Wait-Process -Id $NewLockPid -Timeout 5 -ErrorAction SilentlyContinue } catch {}
        try { Stop-Process -Id $NewLockPid -Force -ErrorAction SilentlyContinue } catch {}
    }

    # --- Case 6: start + stale reused pid must succeed ---
    $Root = New-ControlFixture
    $Bystander = Start-Bystander
    Write-Lock $Root @{ pid = $Bystander.Id }
    $Result = Invoke-Control $Root 'start' @()
    Assert-True ($Result.ExitCode -eq 0) "Case 6: start must not be falsely rejected for a legacy reused-pid stale lock. Output: $($Result.Text)"
    Stop-Bystander $Bystander
    $NewLockPath = Join-Path $Root '.ai\control\lock.json'
    if (Test-Path -LiteralPath $NewLockPath) {
        $NewLockPid = [int]((Get-Content -LiteralPath $NewLockPath -Raw | ConvertFrom-Json).pid)
        try { Wait-Process -Id $NewLockPid -Timeout 5 -ErrorAction SilentlyContinue } catch {}
        try { Stop-Process -Id $NewLockPid -Force -ErrorAction SilentlyContinue } catch {}
    }

    # --- Case 7: genuine live orchestrator -> double start must still be rejected ---
    $Root = New-ControlFixture
    $Bystander = Start-Bystander
    Write-Lock $Root @{ pid = $Bystander.Id; processStartTimeUtc = $Bystander.StartTime.ToUniversalTime().ToString('o') }
    $Result = Invoke-Control $Root 'start' @()
    Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'already running') 'Case 7: genuine live orchestrator (verified identity) must still block a second start'
    Stop-Bystander $Bystander

    Write-Output 'All hermes lock-ownership tests passed.'
}
finally {
    foreach ($BystanderPid in @($SpawnedBystanders)) {
        try { Stop-Process -Id $BystanderPid -Force -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($Root in $Fixtures) {
        $LockPath = Join-Path $Root '.ai\control\lock.json'
        if (Test-Path -LiteralPath $LockPath) {
            try {
                $StubPid = [int]((Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json).pid)
                Stop-Process -Id $StubPid -Force -ErrorAction SilentlyContinue
            }
            catch {}
        }
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
