# Hermes control-layer lock ownership helpers.
#
# Windows PIDs are reused. A lock.json that records only a PID cannot prove
# that the process currently holding that PID is the orchestrator that wrote
# the lock. These helpers bind a lock to a process by PID + process start
# time (analogous to a Unix pid+start_time identity), and refuse to treat a
# lock as live unless that identity can be verified against the live process
# table. Legacy locks that predate this identity field are never trusted as
# live on PID presence alone.

function Get-ProcessStartTimeUtc {
    param([Parameter(Mandatory = $true)] [int]$ProcessId)
    try {
        $Proc = Get-Process -Id $ProcessId -ErrorAction Stop
        return $Proc.StartTime.ToUniversalTime()
    }
    catch { return $null }
}

function New-OrchestratorLockRecord {
    param([Parameter(Mandatory = $true)] [System.Diagnostics.Process]$Process)
    $Process.Refresh()
    [ordered]@{
        schemaVersion       = 2
        pid                 = $Process.Id
        processStartTimeUtc = $Process.StartTime.ToUniversalTime().ToString('o')
        executable          = $Process.ProcessName
        startedAt           = [DateTimeOffset]::UtcNow.ToString('o')
    }
}

function Write-OrchestratorLock {
    param(
        [Parameter(Mandatory = $true)] [System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)] [string]$LockPath
    )
    New-OrchestratorLockRecord -Process $Process | ConvertTo-Json | Set-Content -LiteralPath $LockPath -Encoding UTF8
}

# Returns $true only when $Lock records a process identity (pid + start time)
# that matches a currently running process. A lock missing the identity
# field (legacy schema) or one whose recorded start time does not match the
# live process at that PID is treated as not-live (stale), never as running.
function Test-LivePid {
    param([object]$Lock)

    if (-not $Lock -or -not $Lock.pid) { return $false }
    if (-not $Lock.processStartTimeUtc) { return $false }

    $LockPid = 0
    if (-not [int]::TryParse([string]$Lock.pid, [ref]$LockPid)) { return $false }

    $ActualStartUtc = Get-ProcessStartTimeUtc -ProcessId $LockPid
    if (-not $ActualStartUtc) { return $false }

    try {
        $RecordedStart = [DateTime]::Parse(
            [string]$Lock.processStartTimeUtc, $null,
            [System.Globalization.DateTimeStyles]::RoundtripKind)
        $RecordedStartUtc = $RecordedStart.ToUniversalTime()
    }
    catch { return $false }

    # Small tolerance: repeated StartTime reads / JSON round-tripping can
    # differ by well under a second; this is far tighter than the window
    # needed to distinguish two unrelated processes.
    return [Math]::Abs(($ActualStartUtc - $RecordedStartUtc).TotalSeconds) -lt 2
}
