param(
  [string]$TextFile,
  [string]$OutFile,
  [string]$Voice = "Microsoft Helena Desktop",
  [int]$Rate = 0,
  [int]$Volume = 100,
  [switch]$List
)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$ErrorActionPreference = "Stop"

try {
  if ($List) {
    foreach ($installed in $synth.GetInstalledVoices()) {
      if ($installed.Enabled) { Write-Output $installed.VoiceInfo.Name }
    }
    exit 0
  }

  if ($Voice) {
    try { $synth.SelectVoice($Voice) } catch { }
  }

  $synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))

  $text = Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8
  if (-not $text) { throw "No hay texto" }

  $synth.SetOutputToWaveFile($OutFile)
  $synth.Speak($text)
}
finally {
  $synth.Dispose()
}
