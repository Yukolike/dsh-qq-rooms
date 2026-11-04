param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = ''
)

# Built-in Windows speech (System.Speech). ASCII only: PowerShell 5.1 reads
# UTF-8 without BOM as ANSI, so keep every literal in this file ASCII.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) { throw 'text is empty' }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) {
    $synth.SelectVoice($Voice)
  } else {
    $zh = $synth.GetInstalledVoices() |
      Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*' } |
      Select-Object -First 1
    if ($zh) { $synth.SelectVoice($zh.VoiceInfo.Name) }
  }
  $synth.SetOutputToWaveFile($Out)
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}

if (-not (Test-Path $Out)) { throw 'no output file' }
