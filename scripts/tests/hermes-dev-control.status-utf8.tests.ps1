$ErrorActionPreference = 'Stop'

$ControllerSource = (Resolve-Path (Join-Path $PSScriptRoot '..\hermes-dev-control.ps1')).Path
$LockIdentitySource = (Resolve-Path (Join-Path $PSScriptRoot '..\hermes-lock-identity.ps1')).Path
$Fixtures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-Fixture {
    $Root = Join-Path ([System.IO.Path]::GetTempPath()) ("hermes-status-utf8-test-" + [guid]::NewGuid().ToString('N'))
    $Scripts = Join-Path $Root 'scripts'
    $Control = Join-Path $Root '.ai\control'
    New-Item -ItemType Directory -Path $Scripts, $Control -Force | Out-Null
    Copy-Item -LiteralPath $ControllerSource -Destination (Join-Path $Scripts 'hermes-dev-control.ps1')
    Copy-Item -LiteralPath $LockIdentitySource -Destination (Join-Path $Scripts 'hermes-lock-identity.ps1')
    $Fixtures.Add($Root)

    Set-Content -LiteralPath (Join-Path $Root '.gitignore') -Value ".ai/`n" -Encoding UTF8
    & git -C $Root init --quiet
    & git -C $Root config user.email 'test@example.invalid'
    & git -C $Root config user.name 'test'
    & git -C $Root add -A
    & git -C $Root commit --quiet -m 'init'
    return $Root
}

function Write-JsonUtf8([string]$Path, [object]$Value, [bool]$WithBom) {
    $Json = $Value | ConvertTo-Json -Depth 8
    $Encoding = [System.Text.UTF8Encoding]::new($WithBom)
    [System.IO.File]::WriteAllText($Path, $Json, $Encoding)
}

function Invoke-Status([string]$Root) {
    $Controller = Join-Path $Root 'scripts\hermes-dev-control.ps1'
    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Controller -Command status -RepoDir $Root -Json 2>&1)
    $ExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorAction
    $Text = $Output -join "`n"
    $Report = if ($ExitCode -eq 0) { $Text | ConvertFrom-Json } else { $null }
    return [pscustomobject]@{ ExitCode = $ExitCode; Text = $Text; Report = $Report }
}

try {
    $Root = New-Fixture
    Write-JsonUtf8 (Join-Path $Root '.ai\control\state.json') ([ordered]@{ status = 'idle'; reason = 'plain ASCII' }) $false
    $Result = Invoke-Status $Root
    Assert-True ($Result.ExitCode -eq 0) "ASCII JSON without BOM should parse. Output: $($Result.Text)"
    Assert-True ($Result.Report.state.reason -ceq 'plain ASCII') 'ASCII value should round-trip'

    $Root = New-Fixture
    Write-JsonUtf8 (Join-Path $Root '.ai\control\state.json') ([ordered]@{ status = 'idle'; reason = 'UTF-8 with BOM' }) $true
    $Result = Invoke-Status $Root
    Assert-True ($Result.ExitCode -eq 0) "UTF-8 JSON with BOM should parse. Output: $($Result.Text)"
    Assert-True ($Result.Report.state.reason -ceq 'UTF-8 with BOM') 'BOM value should round-trip'

    $Root = New-Fixture
    $Japanese = -join [char[]]@(0x3069, 0x3061, 0x3089, 0x306e, 0x65b9, 0x91dd, 0x3092, 0x63a1, 0x7528, 0x3057, 0x307e, 0x3059, 0x304b, 0xff1f)
    Write-JsonUtf8 (Join-Path $Root '.ai\control\pending-decision.json') ([ordered]@{ decisionId = 'japanese'; reason = $Japanese }) $false
    $Result = Invoke-Status $Root
    Assert-True ($Result.ExitCode -eq 0) "Japanese UTF-8 JSON should parse. Output: $($Result.Text)"
    Assert-True ($Result.Report.decision.reason -ceq $Japanese) 'Japanese value should round-trip character-for-character'

    $Root = New-Fixture
    $Emoji = 'ready ' + [char]0x2600 + [char]0xfe0f + ' ' + [char]0xd83d + [char]0xde80
    Write-JsonUtf8 (Join-Path $Root '.ai\control\pending-decision.json') ([ordered]@{ decisionId = 'emoji'; reason = $Emoji }) $false
    $Result = Invoke-Status $Root
    Assert-True ($Result.ExitCode -eq 0) "emoji UTF-8 JSON should parse. Output: $($Result.Text)"
    Assert-True ($Result.Report.decision.reason -ceq $Emoji) 'emoji value should round-trip character-for-character'

    $Root = New-Fixture
    $Multiline = "first line`nsecond line`nthird line"
    Write-JsonUtf8 (Join-Path $Root '.ai\control\pending-decision.json') ([ordered]@{ decisionId = 'multiline'; reason = $Multiline }) $false
    $Result = Invoke-Status $Root
    Assert-True ($Result.ExitCode -eq 0) "multiline UTF-8 JSON should parse. Output: $($Result.Text)"
    Assert-True ($Result.Report.decision.reason -ceq $Multiline) 'multiline value should round-trip character-for-character'

    Write-Output 'All Hermes status UTF-8 tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
