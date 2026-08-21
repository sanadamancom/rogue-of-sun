function Split-HermesMessage {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Message,
        [ValidateRange(1, [int]::MaxValue)][int]$MaxLength = 1900,
        [string]$MarkerFormat = '[{0}/{1}]'
    )

    if ($Message.Length -le $MaxLength) { return ,$Message }

    $Parts = [regex]::Matches($Message, '.*?(?:\r\n|\n|\r|$)', [Text.RegularExpressions.RegexOptions]::Singleline) |
        ForEach-Object { $_.Value } | Where-Object { $_.Length -gt 0 }
    $DigitCount = [Math]::Max(1, ([string]$Parts.Count).Length)
    $ReservedMarker = $MarkerFormat.Replace('{0}', ('9' * $DigitCount)).Replace('{1}', ('9' * $DigitCount)) + "`n"
    $ContentBudget = $MaxLength - $ReservedMarker.Length
    if ($ContentBudget -lt 1) { throw 'message fragment budget is too small for sequence markers' }

    $Bodies = [System.Collections.Generic.List[string]]::new()
    $Builder = [Text.StringBuilder]::new()
    foreach ($Part in $Parts) {
        if ($Part.Length -gt $ContentBudget) {
            throw "message contains a line longer than the safe fragment budget ($ContentBudget characters)"
        }
        if ($Builder.Length -gt 0 -and ($Builder.Length + $Part.Length) -gt $ContentBudget) {
            $Bodies.Add($Builder.ToString())
            $Builder.Clear() | Out-Null
        }
        $Builder.Append($Part) | Out-Null
    }
    if ($Builder.Length -gt 0) { $Bodies.Add($Builder.ToString()) }

    $Result = for ($Index = 0; $Index -lt $Bodies.Count; $Index++) {
        (($MarkerFormat -f ($Index + 1), $Bodies.Count) + "`n" + $Bodies[$Index])
    }
    foreach ($Fragment in $Result) {
        if ($Fragment.Length -gt $MaxLength) { throw 'message fragment exceeded the configured limit' }
    }
    return ,$Result
}
