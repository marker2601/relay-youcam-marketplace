[CmdletBinding()]
param(
  [switch]$VoiceSampleOnly
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Get-AudioDuration([string]$Path) {
  $duration = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -i $Path
  if ($LASTEXITCODE -ne 0 -or -not $duration) { throw "ffprobe could not read '$Path'." }
  return [double]::Parse($duration, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-LoudnormMeasurement([string]$Path) {
  $analysis = & ffmpeg -hide_banner -i $Path -af 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json' -f null NUL 2>&1
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg loudness measurement failed for '$Path'." }
  $jsonMatch = [regex]::Match(($analysis -join "`n"), '(?s)\{\s*"input_i".*?\}')
  if (-not $jsonMatch.Success) { throw "FFmpeg did not emit loudness measurements for '$Path'." }
  return $jsonMatch.Value | ConvertFrom-Json
}

function Normalize-Narration([string]$SourcePath, [string]$TargetPath) {
  $input = Get-LoudnormMeasurement $SourcePath
  $filter = "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$($input.input_i):measured_LRA=$($input.input_lra):measured_TP=$($input.input_tp):measured_thresh=$($input.input_thresh):offset=$($input.target_offset):linear=true:print_format=json"
  $normalization = & ffmpeg -y -hide_banner -i $SourcePath -af $filter -ar 48000 -ac 2 -c:a pcm_s16le $TargetPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg loudness normalization failed for '$SourcePath'." }
  $jsonMatch = [regex]::Match(($normalization -join "`n"), '(?s)\{\s*"input_i".*?\}')
  if (-not $jsonMatch.Success) { throw "FFmpeg did not emit normalized loudness measurements for '$TargetPath'." }
  $output = $jsonMatch.Value | ConvertFrom-Json
  return [ordered]@{
    targetIntegratedLufs = -16
    targetTruePeakDbfs = -1.5
    filter = 'loudnorm=I=-16:TP=-1.5:LRA=11'
    input = $input
    output = $output
  }
}

function Convert-SrtTime([string]$Value) {
  $parts = $Value.Trim() -split '[:,]'
  return ([double]$parts[0] * 3600) + ([double]$parts[1] * 60) + [double]$parts[2] + ([double]$parts[3] / 1000)
}

function Get-SrtCues([string]$Path, [double]$Offset) {
  $content = Get-Content -LiteralPath $Path -Raw
  $blocks = $content -split '(?:\r?\n){2,}'
  $cues = @()
  foreach ($block in $blocks) {
    $lines = $block -split '\r?\n' | Where-Object { $_.Trim() }
    $timeLine = $lines | Where-Object { $_ -match '-->' } | Select-Object -First 1
    if (-not $timeLine) { continue }
    $times = $timeLine -split '\s+-->\s+'
    $timeLineIndex = [Array]::IndexOf([string[]]$lines, [string]$timeLine)
    $textLines = if ($timeLineIndex -ge 0) { $lines[($timeLineIndex + 1)..($lines.Count - 1)] } else { @() }
    $cues += [ordered]@{
      startSeconds = [Math]::Round((Convert-SrtTime $times[0]) + $Offset, 3)
      endSeconds = [Math]::Round((Convert-SrtTime $times[1]) + $Offset, 3)
      text = ($textLines -join ' ').Trim()
    }
  }
  return $cues
}

Require-Command 'uvx'
Require-Command 'ffmpeg'
Require-Command 'ffprobe'

$assetsDirectory = Join-Path $PSScriptRoot '..\docs\submission\assets'
$assetsDirectory = (Resolve-Path -LiteralPath $assetsDirectory).Path
$narrationPath = Join-Path $assetsDirectory 'demo-narration.txt'
$narrationPath = (Resolve-Path -LiteralPath $narrationPath).Path

if ($VoiceSampleOnly) {
  $samplePath = Join-Path $assetsDirectory 'relay-professional-v2-voice-sample.mp3'
  $sampleSegments = @(
    [ordered]@{ text = "Hey$([char]0x2014)do you know what makes Relay different?"; rate = '+0%'; pitch = '+8Hz' },
    [ordered]@{ text = 'It does not just show you an outfit.'; rate = '-5%'; pitch = '-5Hz' },
    [ordered]@{ text = 'It keeps a ready backup in motion, so when the first plan falls through, your event does not.'; rate = '+0%'; pitch = '+5Hz' }
  )
  $sampleWorkingDirectory = Join-Path ([IO.Path]::GetTempPath()) ("relay-professional-v2-sample-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $sampleWorkingDirectory | Out-Null
  try {
    $concatLines = @()
    for ($index = 0; $index -lt $sampleSegments.Count; $index++) {
      $segmentMp3 = Join-Path $sampleWorkingDirectory ("segment-{0:D2}.mp3" -f $index)
      $segmentWav = Join-Path $sampleWorkingDirectory ("segment-{0:D2}.wav" -f $index)
      $segment = $sampleSegments[$index]
      & uvx --from 'edge-tts==7.2.8' edge-tts --voice 'en-US-JennyNeural' --rate=$($segment.rate) --pitch=$($segment.pitch) --volume=-3% --text $segment.text --write-media $segmentMp3
      if ($LASTEXITCODE -ne 0) { throw "Voice sample synthesis failed for segment $index." }
      & ffmpeg -y -v error -i $segmentMp3 -ar 48000 -ac 2 -c:a pcm_s16le $segmentWav
      if ($LASTEXITCODE -ne 0) { throw "Could not prepare voice sample segment $index." }
      $concatLines += "file '$($segmentWav.Replace("'", "'\\''"))'"
      if ($index -lt ($sampleSegments.Count - 1)) {
        $pauseWav = Join-Path $sampleWorkingDirectory ("pause-{0:D2}.wav" -f $index)
        & ffmpeg -y -v error -f lavfi -t 0.22 -i 'anullsrc=channel_layout=stereo:sample_rate=48000' -c:a pcm_s16le $pauseWav
        if ($LASTEXITCODE -ne 0) { throw "Could not prepare voice sample pause $index." }
        $concatLines += "file '$($pauseWav.Replace("'", "'\\''"))'"
      }
    }
    $concatFile = Join-Path $sampleWorkingDirectory 'sample.ffconcat'
    [IO.File]::WriteAllLines($concatFile, $concatLines, [Text.UTF8Encoding]::new($false))
    & ffmpeg -y -v error -f concat -safe 0 -i $concatFile -ar 48000 -ac 2 -c:a libmp3lame -q:a 2 $samplePath
    if ($LASTEXITCODE -ne 0) { throw 'Could not assemble the revised voice sample.' }
  } finally {
    if (Test-Path -LiteralPath $sampleWorkingDirectory) { Remove-Item -LiteralPath $sampleWorkingDirectory -Recurse -Force }
  }
  $duration = Get-AudioDuration $samplePath
  if ($duration -le 0) { throw 'Voice sample has no audio duration.' }
  Write-Output "Voice sample created: $samplePath ($([Math]::Round($duration, 3)) seconds)"
  exit 0
}

$paragraphs = (Get-Content -LiteralPath $narrationPath -Raw).Trim() -split '(?:\r?\n){2,}' | ForEach-Object { ($_ -replace '\s+', ' ').Trim() }
if ($paragraphs.Count -ne 8 -or @($paragraphs | Where-Object { -not $_ }).Count -gt 0) {
  throw "Expected exactly eight non-empty narration chapters, found $($paragraphs.Count)."
}

$chapterIds = @('promise', 'brief', 'plan', 'failure', 'recovery', 'ready', 'youcam', 'business')
$workingDirectory = Join-Path ([IO.Path]::GetTempPath()) ("relay-professional-v2-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $workingDirectory | Out-Null
try {
  $captions = @()
  $timings = @()
  $concatLines = @()
  [double]$offset = 0
  for ($index = 0; $index -lt $paragraphs.Count; $index++) {
    $chapterMp3 = Join-Path $workingDirectory ("chapter-{0:D2}.mp3" -f $index)
    $chapterSrt = Join-Path $workingDirectory ("chapter-{0:D2}.srt" -f $index)
    $chapterWav = Join-Path $workingDirectory ("chapter-{0:D2}.wav" -f $index)
    & uvx --from 'edge-tts==7.2.8' edge-tts --voice 'en-US-JennyNeural' --rate=-3% --pitch=-2Hz --volume=-3% --text $paragraphs[$index] --write-media $chapterMp3 --write-subtitles $chapterSrt
    if ($LASTEXITCODE -ne 0) { throw "Narration synthesis failed for chapter $($chapterIds[$index])." }
    $duration = Get-AudioDuration $chapterMp3
    $captions += Get-SrtCues -Path $chapterSrt -Offset $offset
    $timings += [ordered]@{ id = $chapterIds[$index]; startSeconds = [Math]::Round($offset, 3); durationSeconds = [Math]::Round($duration, 3); wordCount = @($paragraphs[$index] -split '\s+').Count }
    & ffmpeg -y -v error -i $chapterMp3 -f lavfi -t 0.18 -i 'anullsrc=channel_layout=stereo:sample_rate=48000' -filter_complex '[0:a]aresample=48000,aformat=channel_layouts=stereo[a];[a][1:a]concat=n=2:v=0:a=1' -ar 48000 -ac 2 -c:a pcm_s16le $chapterWav
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare chapter $($chapterIds[$index]) for concatenation." }
    $concatLines += "file '$($chapterWav.Replace("'", "'\\''"))'"
    $offset += $duration + 0.18
  }
  $concatFile = Join-Path $workingDirectory 'chapters.ffconcat'
  [IO.File]::WriteAllLines($concatFile, $concatLines, [Text.UTF8Encoding]::new($false))
  $rawMasterPath = Join-Path $workingDirectory 'relay-professional-narration-v2-raw.wav'
  & ffmpeg -y -v error -f concat -safe 0 -i $concatFile -ar 48000 -ac 2 -c:a pcm_s16le $rawMasterPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not create unnormalized narration WAV.' }
  $masterPath = Join-Path $assetsDirectory 'relay-professional-narration-v2.wav'
  $loudness = Normalize-Narration -SourcePath $rawMasterPath -TargetPath $masterPath
  $captions | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $assetsDirectory 'relay-professional-captions-v2.json') -Encoding utf8
  $timings | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $assetsDirectory 'relay-professional-timings-v2.json') -Encoding utf8
  $loudness | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $assetsDirectory 'relay-professional-narration-v2-loudness.json') -Encoding utf8
} finally {
  if (Test-Path -LiteralPath $workingDirectory) { Remove-Item -LiteralPath $workingDirectory -Recurse -Force }
}
