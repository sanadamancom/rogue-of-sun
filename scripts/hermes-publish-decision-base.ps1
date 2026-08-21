param(
    [string]$RepoDir = "C:\dev\rogue-of-sun",
    [string]$DecisionId,
    [string]$RemoteName = "origin",
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Fail-Publish([string]$Message) { Write-Error "Hermes decision-base publish: $Message"; exit 1 }
function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail-Publish "pending decision file is missing: $Path" }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { Fail-Publish "invalid pending decision file '$Path': $($_.Exception.Message)" }
}
function Invoke-Git([string[]]$Arguments) {
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $Output = @(& git -C $script:ResolvedRepoDir @Arguments 2>&1)
        $ExitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $PreviousErrorActionPreference }
    [pscustomobject]@{ ExitCode = $ExitCode; Output = $Output; Text = (($Output | ForEach-Object { [string]$_ }) -join "`n").Trim() }
}

try { $script:ResolvedRepoDir = (Resolve-Path -LiteralPath $RepoDir -ErrorAction Stop).Path }
catch { Fail-Publish "repository directory does not exist: $RepoDir" }
$GitCheck = Invoke-Git @('rev-parse', '--git-dir')
if ($GitCheck.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($GitCheck.Text)) { Fail-Publish "not a git repository: $script:ResolvedRepoDir" }

$Pending = Read-JsonFile (Join-Path $script:ResolvedRepoDir '.ai\control\pending-decision.json')
if ([string]$Pending.status -cne 'USER_DECISION_REQUIRED') { Fail-Publish 'pending decision status is not USER_DECISION_REQUIRED' }
if ([string]::IsNullOrWhiteSpace([string]$Pending.commit_sha)) { Fail-Publish 'pending decision commit_sha is missing' }
if ($PSBoundParameters.ContainsKey('DecisionId') -and $DecisionId -cne [string]$Pending.decisionId) { Fail-Publish 'stale/mismatched decision id' }
$DecisionId = [string]$Pending.decisionId
$CommitSha = [string]$Pending.commit_sha
if ($CommitSha -cnotmatch '^[0-9a-f]{40}$') { Fail-Publish "commit_sha must be a full lowercase 40-character SHA: $CommitSha" }

$Status = Invoke-Git @('status', '--porcelain')
if ($Status.ExitCode -ne 0) { Fail-Publish "git status failed: $($Status.Text)" }
if (-not [string]::IsNullOrEmpty($Status.Text)) { Fail-Publish 'working tree is dirty' }
$Branch = Invoke-Git @('symbolic-ref', '-q', '--short', 'HEAD')
if ($Branch.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($Branch.Text)) { Fail-Publish 'detached HEAD is not allowed' }
$DevelopmentBranch = $Branch.Text
if ($DevelopmentBranch -in @('main', 'master')) { Fail-Publish "publishing from protected development branch '$DevelopmentBranch' is not allowed" }
$CommitCheck = Invoke-Git @('cat-file', '-e', "$CommitSha`^{commit}")
if ($CommitCheck.ExitCode -ne 0) { Fail-Publish "commit does not exist locally: $CommitSha" }
$AncestorCheck = Invoke-Git @('merge-base', '--is-ancestor', $CommitSha, 'HEAD')
if ($AncestorCheck.ExitCode -ne 0) { Fail-Publish "commit is not an ancestor of HEAD: $CommitSha" }

$Remote = Invoke-Git @('remote', 'get-url', $RemoteName)
if ($Remote.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($Remote.Text)) { Fail-Publish "remote '$RemoteName' is not configured" }
$Reachable = Invoke-Git @('ls-remote', '--exit-code', $RemoteName)
if ($Reachable.ExitCode -ne 0) { Fail-Publish "remote '$RemoteName' is not reachable: $($Reachable.Text)" }
$RemotePath = ($Remote.Text.TrimEnd('/') -replace '\.git$', '') -replace '\\', '/'
if ($RemotePath -match '^[^/]+@[^:]+:(.+)$') { $RemotePath = $Matches[1] }
$RemoteParts = @($RemotePath -split '/' | Where-Object { $_ })
if ($RemoteParts.Count -lt 2) { Fail-Publish "cannot derive repository slug from remote URL: $($Remote.Text)" }
$RepositorySlug = "$($RemoteParts[-2])/$($RemoteParts[-1])"

$DecisionBranch = "decision-base/$DecisionId"
$DecisionRef = "refs/heads/$DecisionBranch"
$Existing = Invoke-Git @('ls-remote', $RemoteName, $DecisionRef)
if ($Existing.ExitCode -ne 0) { Fail-Publish "failed to inspect remote decision ref: $($Existing.Text)" }
$ExistingLines = @($Existing.Output | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^[0-9a-f]{40}\s+' })
$AlreadyPublished = $false
if ($ExistingLines.Count -gt 0) {
    $ExistingSha = ($ExistingLines[0] -split '\s+')[0]
    if ($ExistingSha -cne $CommitSha) { Fail-Publish "decision ref already exists at different SHA (existing: $ExistingSha; requested: $CommitSha)" }
    $AlreadyPublished = $true
}
else {
    $Push = Invoke-Git @('push', $RemoteName, "${CommitSha}:$DecisionRef")
    if ($Push.ExitCode -ne 0) { Fail-Publish "push failed: $($Push.Text)" }
}

$Verification = Invoke-Git @('ls-remote', $RemoteName, $DecisionRef)
$VerifiedSha = $null
if ($Verification.ExitCode -eq 0) {
    $VerifiedLine = @($Verification.Output | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^[0-9a-f]{40}\s+' } | Select-Object -First 1)
    if ($VerifiedLine.Count -gt 0) { $VerifiedSha = ($VerifiedLine[0] -split '\s+')[0] }
}
if ($VerifiedSha -cne $CommitSha) { Fail-Publish "publish verification failed (expected: $CommitSha; actual: $(if ($VerifiedSha) { $VerifiedSha } else { '<missing>' }))" }

$Result = [ordered]@{
    decisionId = $DecisionId; phase = $Pending.phase; task = $Pending.task; commitSha = $CommitSha
    remoteName = $RemoteName; repositorySlug = $RepositorySlug; developmentBranch = $DevelopmentBranch
    decisionBranch = $DecisionBranch; alreadyPublished = $AlreadyPublished; verified = $true
}
if ($Json) { $Result | ConvertTo-Json -Depth 5 }
else {
    'Decision Base published and verified.'
    "Repository: $RepositorySlug"; "Branch: $DecisionBranch"; "Commit: $CommitSha"
    "Development branch: $DevelopmentBranch"; "Already published: $AlreadyPublished"
}
exit 0
