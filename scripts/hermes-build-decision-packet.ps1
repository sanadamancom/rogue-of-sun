param(
    [string]$RepoDir = (Split-Path $PSScriptRoot -Parent),
    [string]$DecisionId,
    [string]$OutFile,
    [switch]$Chunks
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'hermes-message-fragments.ps1')

function Fail-Packet([string]$Message) { Write-Error "Hermes decision packet: $Message"; exit 1 }

try { $ResolvedRepoDir = (Resolve-Path -LiteralPath $RepoDir -ErrorAction Stop).Path }
catch { Fail-Packet "repository directory does not exist: $RepoDir" }
$PendingPath = Join-Path $ResolvedRepoDir '.ai\control\pending-decision.json'
if (-not (Test-Path -LiteralPath $PendingPath -PathType Leaf)) { Fail-Packet 'exactly one current pending decision is required' }
try { $Pending = Get-Content -LiteralPath $PendingPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
catch { Fail-Packet "invalid pending decision file: $($_.Exception.Message)" }

$CurrentId = [string]$Pending.decisionId
if ([string]::IsNullOrWhiteSpace($CurrentId)) { Fail-Packet 'pending decision decisionId is missing' }
if ($PSBoundParameters.ContainsKey('DecisionId') -and $DecisionId -cne $CurrentId) { Fail-Packet 'stale/mismatched decision id' }
if ($Pending.published -ne $true) { Fail-Packet 'Decision Base publish has not been verified; refusing to build a packet' }
if ([string]::IsNullOrWhiteSpace([string]$Pending.decisionBranch)) { Fail-Packet 'published decisionBranch is missing' }
if ([string]$Pending.decisionBranch -cne "decision-base/$CurrentId") { Fail-Packet 'decisionBranch does not match the pending decision id' }
$CommitSha = [string]$Pending.commit_sha
if ($CommitSha -cnotmatch '^[0-9a-fA-F]{40}$') { Fail-Packet 'commit_sha must be a full 40-character SHA' }
$Phase = if ([string]::IsNullOrWhiteSpace([string]$Pending.phase)) { 'unspecified' } else { [string]$Pending.phase }
$Task = if ([string]::IsNullOrWhiteSpace([string]$Pending.task)) { 'unspecified' } else { [string]$Pending.task }
$Reason = [string]$Pending.reason

$Packet = @"
# ChatGPT Decision Request

Repository:
https://github.com/sanadamancom/rogue-of-sun

Decision Branch:
$([string]$Pending.decisionBranch)

Decision Base Commit:
$CommitSha

Decision ID:
$CurrentId

Phase:
$Phase

Task:
$Task

Working Tree at Decision Base:
clean

Published Remote:
origin

Roles:
- ChatGPT: design / specification / decision authority
- Claude Code: implementation management / verification
- Codex: bounded implementation
- Hermes: orchestration / Discord control

Instructions for ChatGPT:
- Actually inspect the Decision Branch / Decision Base Commit on GitHub.
- Read CLAUDE.md in the repository.
- Read relevant canonical planning/spec docs referenced from CLAUDE.md's Source of
  truth list.
- Read relevant implementation and tests for the area under decision.
- Consult git history if useful.
- Do not rely solely on Claude's stated decision reason below.
- You are not limited to any options Claude may have framed (e.g. "A" or "B") — propose
  a different option if it is better supported.
- If there is a source-of-truth conflict, weigh recency/history/actual implementation/
  prior human decisions, not just the documented priority order alone.
- If information is insufficient, ask for more instead of guessing.

--- CLAUDE'S DECISION REASON (verbatim, unmodified) ---
$Reason
--- END CLAUDE'S DECISION REASON ---

Required output format — respond with a concrete, unambiguous, implementation-ready
answer (not just "A" or "B"), wrapped exactly as:

--- HERMES ANSWER START ---
<the answer>
--- HERMES ANSWER END ---
"@

$Output = if ($Chunks) { @(Split-HermesMessage -Message $Packet -MaxLength 1900 -MarkerFormat '[Decision Packet {0}/{1}]') } else { @($Packet) }
if ($PSBoundParameters.ContainsKey('OutFile')) {
    [IO.File]::WriteAllText($OutFile, ($Output -join ''), [Text.UTF8Encoding]::new($false))
}
else {
    if ($Chunks) { foreach ($Fragment in $Output) { Write-Output $Fragment } }
    else { Write-Output $Packet }
}
