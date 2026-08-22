$ErrorActionPreference = 'Stop'

# Process assertions use stub claude/hermes commands. The notification-contract
# restrictions that only Claude itself can enforce are checked directly in the
# generated prompt/source text; no real Claude or Codex process is launched.

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$OrchestratorSource = Join-Path $RepoRoot 'scripts\hermes-orchestrate.ps1'
$FragmentsSource = Join-Path $RepoRoot 'scripts\hermes-message-fragments.ps1'
$Fixtures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-Fixture {
    $Root = Join-Path ([IO.Path]::GetTempPath()) ('hermes-start-notification-' + [guid]::NewGuid().ToString('N'))
    $Scripts = Join-Path $Root 'scripts'
    $Bin = Join-Path $Root 'bin'
    $Control = Join-Path $Root '.ai\control'
    New-Item -ItemType Directory -Path $Scripts, $Bin, $Control -Force | Out-Null
    Copy-Item -LiteralPath $OrchestratorSource -Destination (Join-Path $Scripts 'hermes-orchestrate.ps1')
    Copy-Item -LiteralPath $FragmentsSource -Destination (Join-Path $Scripts 'hermes-message-fragments.ps1')

    @'
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
$Capture = Join-Path (Split-Path $PSScriptRoot -Parent) '.ai\control\notifications.jsonl'
$Message = [string]$Arguments[$Arguments.Count - 1]
[ordered]@{ message = $Message } | ConvertTo-Json -Compress | Add-Content -LiteralPath $Capture -Encoding UTF8
'@ | Set-Content -LiteralPath (Join-Path $Bin 'hermes.ps1') -Encoding UTF8

    @'
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
$null = [Console]::In.ReadToEnd()
$StatusPath = Join-Path (Get-Location) '.ai\status.json'
switch ($env:HERMES_TEST_SCENARIO) {
    'start_then_exit1' { exit 1 }
    'quota_exit_without_status' { [Console]::Error.WriteLine('session limit reached'); exit 1 }
    'successful_session' {
        [ordered]@{ protocol_version = 1; status = 'CONTINUE'; reason = 'completed'; phase = 'phase-live'; task = 'task-live'; commit_sha = '0123456789abcdef0123456789abcdef01234567' } |
            ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
        exit 0
    }
    'user_decision_required' {
        [ordered]@{ protocol_version = 1; status = 'USER_DECISION_REQUIRED'; reason = '判断が必要です'; phase = 'phase-decision'; task = 'task-decision'; commit_sha = $null } |
            ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
        exit 0
    }
    default { exit 2 }
}
'@ | Set-Content -LiteralPath (Join-Path $Bin 'claude.ps1') -Encoding UTF8

    @'
param([string]$RepoDir, [string]$DecisionId, [switch]$Json)
Write-Error 'synthetic publish failure'
exit 1
'@ | Set-Content -LiteralPath (Join-Path $Scripts 'hermes-publish-decision-base.ps1') -Encoding UTF8

    Set-Content -LiteralPath (Join-Path $Root '.gitignore') -Value ".ai/`n" -Encoding UTF8
    & git -C $Root init --quiet
    & git -C $Root config user.email 'test@example.invalid'
    & git -C $Root config user.name 'test'
    & git -C $Root add -A
    & git -C $Root commit --quiet -m 'fixture'
    $Fixtures.Add($Root)
    return $Root
}

function Invoke-Scenario([string]$Root, [string]$Scenario) {
    $OldPath = $env:PATH
    $OldScenario = $env:HERMES_TEST_SCENARIO
    try {
        $env:PATH = (Join-Path $Root 'bin') + [IO.Path]::PathSeparator + $OldPath
        $env:HERMES_TEST_SCENARIO = $Scenario
        $Previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\hermes-orchestrate.ps1') -RepoDir $Root -MaxSessions 1 -SessionTimeoutSeconds 10 -Notify 2>&1)
        $ExitCode = $LASTEXITCODE
        $ErrorActionPreference = $Previous
    }
    finally {
        $env:PATH = $OldPath
        $env:HERMES_TEST_SCENARIO = $OldScenario
    }
    $Capture = Join-Path $Root '.ai\control\notifications.jsonl'
    $Messages = if (Test-Path -LiteralPath $Capture) {
        @(Get-Content -LiteralPath $Capture -Encoding UTF8 | ForEach-Object { ($_ | ConvertFrom-Json).message })
    } else { @() }
    [pscustomobject]@{ ExitCode = $ExitCode; Output = ($Output -join "`n"); Messages = $Messages }
}

try {
    foreach ($FailureScenario in @('start_then_exit1', 'quota_exit_without_status')) {
        $Root = New-Fixture
        $Result = Invoke-Scenario $Root $FailureScenario
        $Text = $Result.Messages -join "`n"
        Assert-True ($Result.ExitCode -ne 0) "$FailureScenario must use the failure path"
        Assert-True ($Text -notmatch '開発開始|開発を開始しました|実装中') "$FailureScenario must not claim development/task start"
        Assert-True ($Text -match 'セッション開始試行に失敗しました') "$FailureScenario must identify the failed start attempt"
        Assert-True ($Text -match '確認済みの Phase / Task の進行、判断、コミットはありません') "$FailureScenario must disclaim confirmed progress"
        Assert-True ($Result.Output -notmatch 'orphaned|取り残された') "$FailureScenario must not enter orphan detection"
    }

    $Root = New-Fixture
    $Result = Invoke-Scenario $Root 'successful_session'
    $Text = $Result.Messages -join "`n"
    Assert-True ($Result.ExitCode -eq 0) 'successful_session must complete normally'
    Assert-True ($Text.Contains("## ✅ タスク完了`n`nコミット: ``0123456789abcdef0123456789abcdef01234567```n限定タスクをコミットしました。")) 'existing completion notification must remain unchanged'

    $Root = New-Fixture
    $Result = Invoke-Scenario $Root 'user_decision_required'
    $PendingPath = Join-Path $Root '.ai\control\pending-decision.json'
    Assert-True ($Result.ExitCode -eq 0) 'user_decision_required must remain a controlled stop'
    Assert-True (Test-Path -LiteralPath $PendingPath) 'user_decision_required must still create a Decision Packet source record'
    Assert-True ((Get-Content -LiteralPath $PendingPath -Raw | ConvertFrom-Json).reason -eq '判断が必要です') 'decision reason must remain verbatim'
    Assert-True (($Result.Messages -join "`n") -match 'Decision Base publish に失敗しました') 'decision publish gating notification must remain active'

    $Root = New-Fixture
    [ordered]@{ status = 'SESSION_BOUNDARY'; phase = 'stale-phase'; task = 'stale-task'; commit_sha = 'stale-commit'; updatedAt = '2000-01-01T00:00:00Z'; pid = 999999 } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root '.ai\control\state.json') -Encoding UTF8
    [ordered]@{ protocol_version = 1; status = 'CONTINUE'; reason = 'old'; phase = 'stale-phase'; task = 'stale-task'; commit_sha = 'stale-commit' } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root '.ai\status.json') -Encoding UTF8
    $Result = Invoke-Scenario $Root 'start_then_exit1'
    $Text = $Result.Messages -join "`n"
    Assert-True ($Text -notmatch 'stale-phase|stale-task|stale-commit') 'stale metadata must not appear in new start-related notifications'

    $Source = Get-Content -LiteralPath $OrchestratorSource -Raw
    foreach ($RequiredContractText in @(
            'after inspecting the live repository and canonical documents',
            'Never use .ai/control/state.json, a pre-existing .ai/status.json',
            'must never assert that a task has been completed, a decision has been applied, or a commit has been completed')) {
        Assert-True ($Source.Contains($RequiredContractText)) "notification contract must contain: $RequiredContractText"
    }

    Write-Output 'All Hermes start-notification tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
