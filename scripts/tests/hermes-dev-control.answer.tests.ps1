$ErrorActionPreference = 'Stop'

$ControllerSource = (Resolve-Path (Join-Path $PSScriptRoot '..\hermes-dev-control.ps1')).Path
$Fixtures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-Fixture {
    $Root = Join-Path ([System.IO.Path]::GetTempPath()) ("hermes-answer-test-" + [guid]::NewGuid().ToString('N'))
    $Scripts = Join-Path $Root 'scripts'
    $Control = Join-Path $Root '.ai\control'
    New-Item -ItemType Directory -Path $Scripts, $Control -Force | Out-Null
    $FixtureController = Join-Path $Scripts 'hermes-dev-control.ps1'
    Copy-Item -LiteralPath $ControllerSource -Destination $FixtureController
    # Process startup on loaded Windows CI hosts can itself exceed 800 ms. The
    # fixture widens only its copied controller's probe so the immediate-exit
    # stub is observed deterministically; production remains exactly 800 ms.
    $ControllerText = Get-Content -LiteralPath $FixtureController -Raw
    $ControllerText.Replace('Start-Sleep -Milliseconds 800', 'Start-Sleep -Milliseconds 3500') |
        Set-Content -LiteralPath $FixtureController -Encoding UTF8
    $Fixtures.Add($Root)

    $Stub = @'
param(
    [string]$RepoDir,
    [int]$MaxSessions,
    [int]$SessionTimeoutSeconds,
    [switch]$Notify,
    [string]$NotifyTarget,
    [string]$PromptBase64
)
$Control = Join-Path $RepoDir '.ai\control'
$Prompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PromptBase64))
Set-Content -LiteralPath (Join-Path $Control 'received-prompt.txt') -Value $Prompt -Encoding UTF8 -NoNewline
if (Test-Path -LiteralPath (Join-Path $Control 'exit-immediately.flag')) { [Environment]::Exit(0) }
Start-Sleep -Seconds 4
'@
    Set-Content -LiteralPath (Join-Path $Scripts 'hermes-orchestrate.ps1') -Value $Stub -Encoding UTF8
    return $Root
}

function Set-Pending([string]$Root, [string]$Id = 'decision-test') {
    [ordered]@{ decisionId = $Id; reason = 'どちらの方針を採用しますか？' } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root '.ai\control\pending-decision.json') -Encoding UTF8
}

function Invoke-Answer([string]$Root, [string[]]$ExtraArgs) {
    $Controller = Join-Path $Root 'scripts\hermes-dev-control.ps1'
    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Controller -Command answer -RepoDir $Root @ExtraArgs 2>&1)
    $ExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorAction
    return [pscustomobject]@{ ExitCode = $ExitCode; Text = ($Output -join "`n") }
}

function Wait-Stub([string]$Root) {
    $LockPath = Join-Path $Root '.ai\control\lock.json'
    if (Test-Path -LiteralPath $LockPath) {
        $PidValue = [int]((Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json).pid)
        Wait-Process -Id $PidValue -ErrorAction SilentlyContinue
    }
}

try {
    $Root = New-Fixture
    Set-Pending $Root
    $Result = Invoke-Answer $Root @('-Answer', '採用します')
    Assert-True ($Result.ExitCode -eq 0) 'short -Answer should succeed'
    Assert-True (-not (Test-Path (Join-Path $Root '.ai\control\pending-decision.json'))) 'pending decision should be removed'
    Assert-True (Test-Path (Join-Path $Root '.ai\control\lock.json')) 'lock should be written'
    Wait-Stub $Root

    $Root = New-Fixture
    Set-Pending $Root
    $Answer = "## 回答`r`n`r`n`"引用`"と ``backtick`` と 'single quote'`r`n次の行"
    $AnswerPath = Join-Path $Root 'answer.txt'
    Set-Content -LiteralPath $AnswerPath -Value $Answer -Encoding UTF8 -NoNewline
    $Result = Invoke-Answer $Root @('-AnswerFile', $AnswerPath, '-DecisionId', 'decision-test')
    Assert-True ($Result.ExitCode -eq 0) 'multiline -AnswerFile should succeed'
    $Prompt = Get-Content -LiteralPath (Join-Path $Root '.ai\control\received-prompt.txt') -Raw -Encoding UTF8
    $Prefix = "Human answer (verbatim):`r`n"
    if (-not $Prompt.Contains($Prefix)) { $Prefix = "Human answer (verbatim):`n" }
    $Start = $Prompt.IndexOf($Prefix) + $Prefix.Length
    $Suffix = if ($Prompt.IndexOf("`r`n`r`nRecord this human decision", $Start) -ge 0) { "`r`n`r`nRecord this human decision" } else { "`n`nRecord this human decision" }
    $End = $Prompt.IndexOf($Suffix, $Start)
    Assert-True ($Prompt.Substring($Start, $End - $Start) -ceq $Answer) 'answer content should be forwarded verbatim'
    Wait-Stub $Root

    $Root = New-Fixture
    $Result = Invoke-Answer $Root @('-Answer', 'text')
    Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'no pending decision') 'missing pending decision should fail'
    Assert-True (-not (Test-Path (Join-Path $Root '.ai\control\lock.json'))) 'missing pending must not write lock'

    foreach ($EmptyCase in @('answer', 'file')) {
        $Root = New-Fixture
        Set-Pending $Root
        if ($EmptyCase -eq 'answer') { $Result = Invoke-Answer $Root @('-Answer', '   ') }
        else {
            $EmptyPath = Join-Path $Root 'empty.txt'
            Set-Content -LiteralPath $EmptyPath -Value " `r`n " -Encoding UTF8 -NoNewline
            $Result = Invoke-Answer $Root @('-AnswerFile', $EmptyPath)
        }
        Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'Answer or -AnswerFile is required') "empty $EmptyCase should fail"
    }

    $Root = New-Fixture
    Set-Pending $Root
    $BothPath = Join-Path $Root 'answer.txt'
    Set-Content -LiteralPath $BothPath -Value 'file text' -Encoding UTF8 -NoNewline
    $Result = Invoke-Answer $Root @('-Answer', 'argument text', '-AnswerFile', $BothPath)
    Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'supply either') 'both answer sources should fail'

    $Root = New-Fixture
    Set-Pending $Root
    $Result = Invoke-Answer $Root @('-Answer', 'text', '-DecisionId', 'stale')
    Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'stale/mismatched') 'stale decision id should fail'
    Assert-True (Test-Path (Join-Path $Root '.ai\control\pending-decision.json')) 'stale id must preserve pending decision'

    $Root = New-Fixture
    Set-Pending $Root
    [ordered]@{ pid = $PID } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root '.ai\control\lock.json') -Encoding UTF8
    $Result = Invoke-Answer $Root @('-Answer', 'text')
    Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'orchestrator is still running') 'live orchestrator should fail'

    $Root = New-Fixture
    Set-Pending $Root
    New-Item -ItemType File -Path (Join-Path $Root '.ai\control\exit-immediately.flag') | Out-Null
    $Result = Invoke-Answer $Root @('-Answer', 'text')
    Assert-True ($Result.ExitCode -ne 0 -and $Result.Text -match 'exited immediately') 'immediate exit should fail'
    Assert-True (Test-Path (Join-Path $Root '.ai\control\pending-decision.json')) 'immediate exit must preserve pending decision'
    Assert-True (-not (Test-Path (Join-Path $Root '.ai\control\lock.json'))) 'immediate exit must not write lock'

    $Root = New-Fixture
    Set-Pending $Root
    $AnsweringLock = Join-Path $Root '.ai\control\answering.lock'
    New-Item -ItemType File -Path $AnsweringLock | Out-Null
    $Rejected = Invoke-Answer $Root @('-Answer', 'text')
    Assert-True ($Rejected.ExitCode -ne 0 -and $Rejected.Text -match 'another answer is already being processed') 'duplicate answer should be rejected'
    Remove-Item -LiteralPath $AnsweringLock -Force
    $Accepted = Invoke-Answer $Root @('-Answer', 'text')
    Assert-True ($Accepted.ExitCode -eq 0) 'one answer should succeed after exclusive marker is released'
    Wait-Stub $Root

    Write-Output 'All hermes answer control tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        Wait-Stub $Root
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
