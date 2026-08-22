$ErrorActionPreference = 'Stop'

$PublisherScript = (Resolve-Path (Join-Path $PSScriptRoot '..\hermes-publish-decision-base.ps1')).Path
$Fixtures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-Fixture {
    $Root = Join-Path ([IO.Path]::GetTempPath()) ('hermes-publish-test-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $Root '.ai\control') -Force | Out-Null
    & git -C $Root init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'failed to initialize publisher fixture repository' }
    $Fixtures.Add($Root)
    return $Root
}

function Invoke-Publisher([string]$Root) {
    $Previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PublisherScript -RepoDir $Root 2>&1)
    $Code = $LASTEXITCODE
    $ErrorActionPreference = $Previous
    [pscustomobject]@{ ExitCode = $Code; Text = ($Output -join "`n") }
}

try {
    $Root = New-Fixture
    $PendingPath = Join-Path $Root '.ai\control\pending-decision.json'
    $PendingBytes = [Text.Encoding]::UTF8.GetBytes("{`n  `"decisionId`": `"decision-test`",`n  `"status`": `"USER_DECISION_REQUIRED`",`n  `"commit_sha`": null`n}`n")
    [IO.File]::WriteAllBytes($PendingPath, $PendingBytes)

    $Result = Invoke-Publisher $Root
    Assert-True ($Result.ExitCode -ne 0) 'publish_failure_preserves_pending should fail for a null commit SHA'
    Assert-True ($Result.Text -match 'pending decision commit_sha is missing') 'publisher should report the missing commit SHA'
    $AfterBytes = [IO.File]::ReadAllBytes($PendingPath)
    Assert-True ([Convert]::ToBase64String($AfterBytes) -ceq [Convert]::ToBase64String($PendingBytes)) 'publisher failure must leave pending-decision.json byte-for-byte unchanged'

    Write-Output 'All Hermes publish-decision-base tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
