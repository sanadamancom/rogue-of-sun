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

    # Regression: recovering a legacy pending decision (e.g. one written before
    # -CommitSha was required) must not succeed by copying a stale SHA that no
    # longer corresponds to the reviewed HEAD. A commit_sha that is well-formed
    # but not an ancestor of HEAD (simulating a stale/foreign SHA) must still
    # fail closed, the same as a missing one.
    $StaleRoot = New-Fixture
    & git -C $StaleRoot config user.email 'test@example.com'
    & git -C $StaleRoot config user.name 'Test'
    & git -C $StaleRoot checkout --quiet -b dev-branch
    'seed' | Out-File -FilePath (Join-Path $StaleRoot 'seed.txt') -Encoding utf8
    & git -C $StaleRoot add seed.txt
    & git -C $StaleRoot commit --quiet -m 'seed commit'
    if ($LASTEXITCODE -ne 0) { throw 'failed to create seed commit in stale fixture repository' }
    $ForeignSha = ('f' * 40)
    $StalePendingPath = Join-Path $StaleRoot '.ai\control\pending-decision.json'
    $StalePendingBytes = [Text.Encoding]::UTF8.GetBytes("{`n  `"decisionId`": `"decision-test`",`n  `"status`": `"USER_DECISION_REQUIRED`",`n  `"commit_sha`": `"$ForeignSha`"`n}`n")
    [IO.File]::WriteAllBytes($StalePendingPath, $StalePendingBytes)
    & git -C $StaleRoot add -A
    & git -C $StaleRoot commit --quiet -m 'add pending decision fixture'
    if ($LASTEXITCODE -ne 0) { throw 'failed to commit stale fixture pending decision' }

    $StaleResult = Invoke-Publisher $StaleRoot
    Assert-True ($StaleResult.ExitCode -ne 0) 'publish_rejects_stale_commit_sha_not_ancestor_of_head should fail for a well-formed but non-ancestor SHA'
    Assert-True ($StaleResult.Text -match 'commit does not exist locally|commit is not an ancestor of HEAD') 'publisher should reject a stale/foreign commit_sha instead of silently accepting it'
    $StaleAfterBytes = [IO.File]::ReadAllBytes($StalePendingPath)
    Assert-True ([Convert]::ToBase64String($StaleAfterBytes) -ceq [Convert]::ToBase64String($StalePendingBytes)) 'publisher failure on stale commit_sha must leave pending-decision.json byte-for-byte unchanged'

    Write-Output 'All Hermes publish-decision-base tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
