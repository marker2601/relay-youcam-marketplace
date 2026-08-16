param(
  [string]$AssetDirectory = (Join-Path $PSScriptRoot '..\docs\submission\assets')
)

$ErrorActionPreference = 'Stop'

$assetRoot = (Resolve-Path -LiteralPath $AssetDirectory).Path
$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCommand) {
  throw 'ffmpeg was not found on PATH'
}
$ffmpeg = $ffmpegCommand.Source
$ffprobe = Join-Path (Split-Path -Parent $ffmpeg) 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $ffprobe)) {
  throw "ffprobe was not found at $ffprobe"
}

$narrationText = Get-Content -Raw -LiteralPath (Join-Path $assetRoot 'demo-narration.txt')
$narrationPath = Join-Path $assetRoot 'relay-rescue-demo-narration.wav'
$outputPath = Join-Path $assetRoot 'relay-rescue-demo.mp4'

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = -2
$synth.Volume = 100
$synth.SetOutputToWaveFile($narrationPath)
$synth.Speak($narrationText)
$synth.Dispose()

$inputs = @(
  (Join-Path $assetRoot '01-relay-rescue-hero-v2.png'),
  (Join-Path $assetRoot '02-real-youcam-primary-backup.png'),
  (Join-Path $assetRoot '03-primary-declined-backup-available.png'),
  (Join-Path $assetRoot '04-backup-accepted-event-ready.png'),
  (Join-Path $assetRoot 'relay-rescue-thumbnail.png')
)

foreach ($inputPath in $inputs) {
  if (-not (Test-Path -LiteralPath $inputPath)) {
    throw "Missing demo asset: $inputPath"
  }
}

$filterComplex = @(
  '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#f4f0e8,setsar=1[v0];'
  '[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#f4f0e8,setsar=1[v1];'
  '[2:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#f4f0e8,setsar=1[v2];'
  '[3:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#f4f0e8,setsar=1[v3];'
  '[4:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#f4f0e8,setsar=1[v4];'
  '[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0,format=yuv420p[v]'
) -join ''

$arguments = @(
  '-y',
  '-loop', '1', '-t', '20', '-i', $inputs[0],
  '-loop', '1', '-t', '40', '-i', $inputs[1],
  '-loop', '1', '-t', '30', '-i', $inputs[2],
  '-loop', '1', '-t', '30', '-i', $inputs[3],
  '-loop', '1', '-t', '30', '-i', $inputs[4],
  '-i', $narrationPath,
  '-filter_complex', $filterComplex,
  '-map', '[v]', '-map', '5:a',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-c:a', 'aac', '-b:a', '160k',
  '-movflags', '+faststart',
  '-shortest',
  $outputPath
)

& $ffmpeg @arguments
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg exited with code $LASTEXITCODE"
}

& $ffprobe -v error -show_entries 'format=duration,size' -show_entries 'stream=codec_type,codec_name,width,height,sample_rate' -of json $outputPath
Write-Output $outputPath
