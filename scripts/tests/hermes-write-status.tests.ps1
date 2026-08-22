$ErrorActionPreference = 'Stop'

$WriterScript = (Resolve-Path (Join-Path $PSScriptRoot '..\hermes-write-status.ps1')).Path
$Fixtures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-Fixture {
    $Root = Join-Path ([IO.Path]::GetTempPath()) ('hermes-write-status-test-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    $Fixtures.Add($Root)
    return $Root
}

function Invoke-Writer([string]$Root, [string[]]$Arguments) {
    $Previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WriterScript -RepoDir $Root @Arguments 2>&1)
    $Code = $LASTEXITCODE
    $ErrorActionPreference = $Previous
    [pscustomobject]@{ ExitCode = $Code; Text = ($Output -join "`n") }
}

try {
    $Sha = '0123456789abcdef0123456789abcdef01234567'

    $Root = New-Fixture
    $Result = Invoke-Writer $Root @('-Status', 'USER_DECISION_REQUIRED', '-Reason', 'decision needed', '-CommitSha', $Sha)
    Assert-True ($Result.ExitCode -eq 0) 'decision_with_valid_commit_sha should succeed'
    $Status = Get-Content -LiteralPath (Join-Path $Root '.ai\status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ([string]$Status.commit_sha -ceq $Sha) 'decision status should preserve the supplied commit SHA'

    $Root = New-Fixture
    $Result = Invoke-Writer $Root @('-Status', 'USER_DECISION_REQUIRED', '-Reason', 'decision needed')
    Assert-True ($Result.ExitCode -ne 0) 'decision_missing_commit_sha should fail'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $Root '.ai\status.json'))) 'missing SHA must not write status.json'
    Assert-True ($Result.Text -match 'USER_DECISION_REQUIRED requires -CommitSha') 'missing SHA error should name the contract'

    $Root = New-Fixture
    New-Item -ItemType Directory -Path (Join-Path $Root '.ai') -Force | Out-Null
    $ExistingPath = Join-Path $Root '.ai\status.json'
    $Existing = '{"existing":true}'
    [IO.File]::WriteAllText($ExistingPath, $Existing, [Text.Encoding]::UTF8)
    $Result = Invoke-Writer $Root @('-Status', 'USER_DECISION_REQUIRED', '-Reason', 'decision needed', '-CommitSha', '   ')
    Assert-True ($Result.ExitCode -ne 0) 'decision_empty_commit_sha should fail'
    Assert-True ([IO.File]::ReadAllText($ExistingPath, [Text.Encoding]::UTF8) -ceq $Existing) 'invalid decision status must leave an existing status untouched'

    foreach ($OptionalStatus in @('CONTINUE', 'SESSION_BOUNDARY', 'BLOCKED')) {
        $Root = New-Fixture
        $Result = Invoke-Writer $Root @('-Status', $OptionalStatus, '-Reason', 'optional SHA check')
        Assert-True ($Result.ExitCode -eq 0) "$OptionalStatus without CommitSha should succeed"
        $Status = Get-Content -LiteralPath (Join-Path $Root '.ai\status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-True ($null -eq $Status.commit_sha) "$OptionalStatus should write commit_sha as null"
    }

    Write-Output 'All Hermes write-status tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
