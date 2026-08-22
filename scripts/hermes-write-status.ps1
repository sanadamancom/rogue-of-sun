param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("CONTINUE", "SESSION_BOUNDARY", "USER_DECISION_REQUIRED", "BLOCKED")]
    [string]$Status,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Reason,

    [string]$Phase,
    [string]$Task,
    [string]$CommitSha,

    [string]$RepoDir = "C:\dev\rogue-of-sun"
)

# Deterministic writer for .ai/status.json (docs/ops/hermes-status-protocol.md).
# Claude supplies only semantic fields; this script mechanically emits
# protocol_version: 1 and enforces required-field/enum validity so the
# schema is never hand-reconstructed from prose. See incident: a real
# Hermes session (commit 2dab43c) wrote a structurally valid status file
# by hand but omitted protocol_version, which Hermes correctly rejected.

$ErrorActionPreference = "Stop"

try {
    $ResolvedRepoDir = (Resolve-Path -LiteralPath $RepoDir -ErrorAction Stop).Path
}
catch {
    Write-Error "hermes-write-status: repository directory does not exist: $RepoDir"
    exit 1
}

if ($Status -ceq 'USER_DECISION_REQUIRED' -and
    (-not $PSBoundParameters.ContainsKey('CommitSha') -or [string]::IsNullOrWhiteSpace($CommitSha))) {
    Write-Error 'hermes-write-status: USER_DECISION_REQUIRED requires -CommitSha (the current reviewed HEAD)'
    exit 1
}

$AiDir = Join-Path $ResolvedRepoDir ".ai"
if (-not (Test-Path -LiteralPath $AiDir)) {
    New-Item -ItemType Directory -Path $AiDir -Force | Out-Null
}
$StatusPath = Join-Path $AiDir "status.json"

$Record = [ordered]@{
    protocol_version = 1
    status           = $Status
    reason           = $Reason
    phase            = if ($PSBoundParameters.ContainsKey('Phase') -and $Phase) { $Phase } else { $null }
    task             = if ($PSBoundParameters.ContainsKey('Task') -and $Task) { $Task } else { $null }
    commit_sha       = if ($PSBoundParameters.ContainsKey('CommitSha') -and $CommitSha) { $CommitSha } else { $null }
}

$TempPath = "$StatusPath.tmp.$PID"
try {
    $Record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $TempPath -Encoding UTF8
    Move-Item -LiteralPath $TempPath -Destination $StatusPath -Force
}
catch {
    if (Test-Path -LiteralPath $TempPath) { Remove-Item -LiteralPath $TempPath -Force -ErrorAction SilentlyContinue }
    Write-Error "hermes-write-status: failed to write status file: $($_.Exception.Message)"
    exit 1
}

Write-Host "hermes-write-status: wrote $StatusPath (status=$Status)"
