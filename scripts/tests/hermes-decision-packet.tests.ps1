$ErrorActionPreference = 'Stop'

$PacketScript = (Resolve-Path (Join-Path $PSScriptRoot '..\hermes-build-decision-packet.ps1')).Path
$Fixtures = [System.Collections.Generic.List[string]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-Fixture([object]$Pending) {
    $Root = Join-Path ([IO.Path]::GetTempPath()) ('hermes-packet-test-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $Root '.ai\control') -Force | Out-Null
    $Pending | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Root '.ai\control\pending-decision.json') -Encoding UTF8
    $Fixtures.Add($Root)
    return $Root
}

function Invoke-Packet([string]$Root, [string[]]$ExtraArgs) {
    $Previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PacketScript -RepoDir $Root @ExtraArgs 2>&1)
    $Code = $LASTEXITCODE
    $ErrorActionPreference = $Previous
    [pscustomobject]@{ ExitCode = $Code; Text = ($Output -join "`n") }
}

try {
    $Sha = '0123456789abcdef0123456789abcdef01234567'
    $Pending = [ordered]@{
        decisionId = 'decision-test'; status = 'USER_DECISION_REQUIRED'; reason = '判断理由です。'
        phase = 'phase-test'; task = 'task-test'; commit_sha = $Sha; published = $true
        decisionBranch = 'decision-base/decision-test'
    }
    $Root = New-Fixture $Pending
    $PacketPath = Join-Path $Root 'packet.txt'
    $Result = Invoke-Packet $Root @('-DecisionId', 'decision-test', '-OutFile', $PacketPath)
    Assert-True ($Result.ExitCode -eq 0) 'published decision should generate a packet'
    $Packet = [IO.File]::ReadAllText($PacketPath, [Text.Encoding]::UTF8)
    foreach ($Required in @('# ChatGPT Decision Request', 'decision-base/decision-test', $Sha, 'phase-test', 'task-test',
            'Working Tree at Decision Base:', 'Published Remote:', 'Roles:', "--- CLAUDE'S DECISION REASON (verbatim, unmodified) ---",
            '判断理由です。', '--- HERMES ANSWER START ---', '--- HERMES ANSWER END ---')) {
        Assert-True ($Packet.Contains($Required)) "packet should contain '$Required'"
    }

    foreach ($PublishCase in @($false, $null)) {
        $Rejected = [ordered]@{} + $Pending
        if ($null -eq $PublishCase) { $Rejected.Remove('published') } else { $Rejected.published = $false }
        $Root = New-Fixture $Rejected
        $RejectedPath = Join-Path $Root 'rejected.txt'
        $Result = Invoke-Packet $Root @('-OutFile', $RejectedPath)
        Assert-True ($Result.ExitCode -ne 0) 'unverified publish must fail closed'
        Assert-True (-not (Test-Path -LiteralPath $RejectedPath)) 'failed generation must not emit a packet file'
        Assert-True ($Result.Text -notmatch 'HERMES ANSWER START') 'failed generation must not emit packet content'
    }

    $Url = 'https://github.com/example/repository/path?value=abcdefghijklmnopqrstuvwxyz'
    $LongLines = for ($Index = 0; $Index -lt 90; $Index++) { "段落 $Index 日本語テキスト $Sha $Url`n" }
    $LongPending = [ordered]@{} + $Pending
    $LongPending.reason = ($LongLines -join '')
    $Root = New-Fixture $LongPending
    $OriginalPath = Join-Path $Root 'original.txt'
    $ChunksPath = Join-Path $Root 'chunks.txt'
    Assert-True ((Invoke-Packet $Root @('-OutFile', $OriginalPath)).ExitCode -eq 0) 'long original packet should generate'
    Assert-True ((Invoke-Packet $Root @('-Chunks', '-OutFile', $ChunksPath)).ExitCode -eq 0) 'long packet chunks should generate'
    $OriginalBytes = [IO.File]::ReadAllBytes($OriginalPath)
    $ChunkText = [IO.File]::ReadAllText($ChunksPath, [Text.Encoding]::UTF8)
    $Matches = [regex]::Matches($ChunkText, '(?m)^\[Decision Packet (\d+)/(\d+)\]\n')
    Assert-True ($Matches.Count -gt 1) 'long packet should produce multiple marked chunks'
    $Reassembled = [Text.StringBuilder]::new()
    for ($Index = 0; $Index -lt $Matches.Count; $Index++) {
        Assert-True ([int]$Matches[$Index].Groups[1].Value -eq ($Index + 1)) 'chunk sequence number should be ordered'
        Assert-True ([int]$Matches[$Index].Groups[2].Value -eq $Matches.Count) 'chunk total should be correct'
        $Start = $Matches[$Index].Index
        $End = if ($Index + 1 -lt $Matches.Count) { $Matches[$Index + 1].Index } else { $ChunkText.Length }
        $Fragment = $ChunkText.Substring($Start, $End - $Start)
        Assert-True ($Fragment.Length -le 1900) 'each marked fragment must fit the Discord budget'
        $Body = $Fragment.Substring($Matches[$Index].Length)
        $Reassembled.Append($Body) | Out-Null
    }
    $ReassembledBytes = [Text.Encoding]::UTF8.GetBytes($Reassembled.ToString())
    Assert-True ([Convert]::ToBase64String($ReassembledBytes) -ceq [Convert]::ToBase64String($OriginalBytes)) 'chunk reassembly must reproduce original UTF-8 bytes'
    Assert-True (([regex]::Matches($Reassembled.ToString(), [regex]::Escape($Sha))).Count -eq 91) 'SHA tokens must remain intact'
    Assert-True (([regex]::Matches($Reassembled.ToString(), [regex]::Escape($Url))).Count -eq 90) 'URL tokens must remain intact'

    Write-Output 'All Hermes decision-packet tests passed.'
}
finally {
    foreach ($Root in $Fixtures) {
        if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    }
}
