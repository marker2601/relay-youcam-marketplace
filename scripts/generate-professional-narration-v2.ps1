[CmdletBinding()]
param(
  [switch]$VoiceSampleOnly,
  [double]$InspectPreparedDurationSeconds = [double]::NaN,
  [string]$InspectCaptionPath,
  [switch]$NormalizeCaptionCues
)

$ErrorActionPreference = 'Stop'

function Get-SpokenDurationSeconds([double]$PreparedDurationSeconds, [double]$ChapterPauseSeconds) {
  return [Math]::Max([double]0, $PreparedDurationSeconds - $ChapterPauseSeconds)
}

function Assert-CaptionLayout([object[]]$Captions) {
  for ($captionIndex = 0; $captionIndex -lt $Captions.Count; $captionIndex++) {
    $caption = $Captions[$captionIndex]
    $lines = @([string]$caption.text -split "`r?`n")
    if ($lines.Count -gt 2) { throw "Caption $($captionIndex + 1) has more than two lines" }
    for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex++) {
      if ($lines[$lineIndex].Length -gt 43) { throw "Caption $($captionIndex + 1) line $($lineIndex + 1) exceeds 43 characters" }
    }
    if ([double]::IsNaN([double]$caption.startSeconds) -or [double]::IsInfinity([double]$caption.startSeconds) -or [double]::IsNaN([double]$caption.endSeconds) -or [double]::IsInfinity([double]$caption.endSeconds) -or [double]$caption.endSeconds -le [double]$caption.startSeconds) {
      throw "Caption $($captionIndex + 1) has invalid timing"
    }
    if ($captionIndex -gt 0 -and [double]$caption.startSeconds -ne [double]$Captions[$captionIndex - 1].endSeconds -and [double]$caption.startSeconds -lt [double]$Captions[$captionIndex - 1].endSeconds) {
      throw "Caption $($captionIndex + 1) overlaps the previous caption"
    }
  }
}

function Split-CaptionCue([object]$Caption) {
  $words = @(([string]$Caption.text -replace '\s+', ' ').Trim() -split '\s+' | Where-Object { $_ })
  if ($words.Count -eq 0) { throw 'Caption text cannot be empty.' }
  $lines = [System.Collections.Generic.List[string]]::new()
  $line = ''
  foreach ($word in $words) {
    if ($word.Length -gt 43) { throw "Caption word '$word' exceeds 43 characters" }
    $candidate = if ($line) { "$line $word" } else { $word }
    if ($candidate.Length -gt 43) {
      $lines.Add($line)
      $line = $word
    } else {
      $line = $candidate
    }
  }
  if ($line) { $lines.Add($line) }

  $chunkTexts = [System.Collections.Generic.List[string]]::new()
  for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex += 2) {
    $chunkLines = @($lines[$lineIndex])
    if ($lineIndex + 1 -lt $lines.Count) { $chunkLines += $lines[$lineIndex + 1] }
    $chunkTexts.Add(($chunkLines -join "`n"))
  }

  [double]$totalWeight = @($chunkTexts | ForEach-Object { ($_ -replace '\s+', '').Length } | Measure-Object -Sum).Sum
  [double]$start = [double]$Caption.startSeconds
  [double]$end = [double]$Caption.endSeconds
  [double]$duration = $end - $start
  if ($duration -le 0) { throw 'Caption duration must be positive.' }
  $result = @()
  for ($chunkIndex = 0; $chunkIndex -lt $chunkTexts.Count; $chunkIndex++) {
    $chunkText = $chunkTexts[$chunkIndex]
    $chunkWeight = ($chunkText -replace '\s+', '').Length
    $chunkEnd = if ($chunkIndex -eq $chunkTexts.Count - 1) { $end } else { [Math]::Round($start + ($duration * $chunkWeight / $totalWeight), 3) }
    if ($chunkEnd -le $start) { throw 'Caption chunk duration must remain positive.' }
    $result += [ordered]@{ startSeconds = $start; endSeconds = $chunkEnd; text = $chunkText }
    $start = $chunkEnd
    $totalWeight -= $chunkWeight
    $duration = $end - $start
  }
  return $result
}

function Normalize-CaptionCues([object[]]$Captions) {
  $normalized = @()
  foreach ($caption in $Captions) { $normalized += Split-CaptionCue $caption }
  Assert-CaptionLayout $normalized
  return $normalized
}

if (-not [double]::IsNaN($InspectPreparedDurationSeconds)) {
  [Console]::WriteLine((Get-SpokenDurationSeconds -PreparedDurationSeconds $InspectPreparedDurationSeconds -ChapterPauseSeconds ([double]0.12)).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture))
  exit 0
}

if ($InspectCaptionPath) {
  $inspectionSource = Get-Content -LiteralPath $InspectCaptionPath -Raw -Encoding UTF8
  $inspectionCaptions = @((ConvertFrom-Json -InputObject $inspectionSource) | ForEach-Object { $_ })
  if ($NormalizeCaptionCues) { $inspectionCaptions = @(Normalize-CaptionCues $inspectionCaptions) }
  Assert-CaptionLayout $inspectionCaptions
  [Console]::WriteLine(($inspectionCaptions | ConvertTo-Json -Depth 3 -Compress))
  exit 0
}

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
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $analysis = & ffmpeg -hide_banner -i $Path -af 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json' -f null NUL 2>&1
    $ffmpegExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  if ($ffmpegExitCode -ne 0) { throw "FFmpeg loudness measurement failed for '$Path'." }
  $jsonMatch = [regex]::Match(($analysis -join "`n"), '(?s)\{\s*"input_i".*?\}')
  if (-not $jsonMatch.Success) { throw "FFmpeg did not emit loudness measurements for '$Path'." }
  return $jsonMatch.Value | ConvertFrom-Json
}

function Normalize-Narration([string]$SourcePath, [string]$TargetPath) {
  $input = Get-LoudnormMeasurement $SourcePath
  $filter = "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$($input.input_i):measured_LRA=$($input.input_lra):measured_TP=$($input.input_tp):measured_thresh=$($input.input_thresh):offset=$($input.target_offset):linear=true:print_format=json"
  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $normalization = & ffmpeg -y -hide_banner -i $SourcePath -af $filter -ar 48000 -ac 2 -c:a pcm_s16le $TargetPath 2>&1
    $ffmpegExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  if ($ffmpegExitCode -ne 0) { throw "FFmpeg loudness normalization failed for '$SourcePath'." }
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
  $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
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
$deliveryProfilePath = Join-Path $assetsDirectory 'relay-professional-v2-delivery-profile.json'
$deliveryProfilePath = (Resolve-Path -LiteralPath $deliveryProfilePath).Path
$deliveryProfile = Get-Content -LiteralPath $deliveryProfilePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($deliveryProfile.engine -cne 'edge-tts' -or $deliveryProfile.version -cne '7.2.8' -or $deliveryProfile.voice -cne 'en-US-JennyNeural' -or $deliveryProfile.volume -cne '-3%') {
  throw 'Delivery profile must use the approved pinned Jenny neural voice.'
}
if ([double]$deliveryProfile.internalPauseSeconds -ne [double]0.22 -or [double]$deliveryProfile.chapterPauseSeconds -ne [double]0.12) {
  throw 'Delivery profile must use 220 ms internal pauses and 120 ms chapter pauses.'
}

if ($VoiceSampleOnly) {
  $samplePath = Join-Path $assetsDirectory 'relay-professional-v2-voice-sample.mp3'
  $sampleChapter = @($deliveryProfile.chapters | Where-Object { $_.id -ceq $deliveryProfile.sample.chapterId })
  if ($sampleChapter.Count -ne 1) { throw 'Delivery profile sample chapter is missing or ambiguous.' }
  $sampleSegments = @($deliveryProfile.sample.segmentIndexes | ForEach-Object {
    $segment = $sampleChapter[0].segments[[int]$_]
    if ($null -eq $segment) { throw 'Delivery profile sample references a missing segment.' }
    $segment
  })
  $sampleWorkingDirectory = Join-Path ([IO.Path]::GetTempPath()) ("relay-professional-v2-sample-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $sampleWorkingDirectory | Out-Null
  try {
    $concatLines = @()
    for ($index = 0; $index -lt $sampleSegments.Count; $index++) {
      $segmentMp3 = Join-Path $sampleWorkingDirectory ("segment-{0:D2}.mp3" -f $index)
      $segmentWav = Join-Path $sampleWorkingDirectory ("segment-{0:D2}.wav" -f $index)
      $segmentTextPath = Join-Path $sampleWorkingDirectory ("segment-{0:D2}.txt" -f $index)
      $segment = $sampleSegments[$index]
      [IO.File]::WriteAllText($segmentTextPath, [string]$segment.text, [Text.UTF8Encoding]::new($false))
      & uvx --from 'edge-tts==7.2.8' edge-tts --voice $deliveryProfile.voice --rate=$($segment.rate) --pitch=$($segment.pitch) --volume=$($deliveryProfile.volume) --file $segmentTextPath --write-media $segmentMp3
      if ($LASTEXITCODE -ne 0) { throw "Voice sample synthesis failed for segment $index." }
      & ffmpeg -y -v error -i $segmentMp3 -ar 48000 -ac 2 -c:a pcm_s16le $segmentWav
      if ($LASTEXITCODE -ne 0) { throw "Could not prepare voice sample segment $index." }
      $concatLines += "file '$($segmentWav.Replace("'", "'\\''"))'"
      if ($index -lt ($sampleSegments.Count - 1)) {
        $pauseWav = Join-Path $sampleWorkingDirectory ("pause-{0:D2}.wav" -f $index)
        & ffmpeg -y -v error -f lavfi -t $deliveryProfile.internalPauseSeconds -i 'anullsrc=channel_layout=stereo:sample_rate=48000' -c:a pcm_s16le $pauseWav
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

$paragraphs = (Get-Content -LiteralPath $narrationPath -Raw -Encoding UTF8).Trim() -split '(?:\r?\n){2,}' | ForEach-Object { ($_ -replace '\s+', ' ').Trim() }
if ($paragraphs.Count -ne 8 -or @($paragraphs | Where-Object { -not $_ }).Count -gt 0) {
  throw "Expected exactly eight non-empty narration chapters, found $($paragraphs.Count)."
}

$chapterIds = @('promise', 'brief', 'plan', 'failure', 'recovery', 'ready', 'youcam', 'business')
$deliveryChapters = @($deliveryProfile.chapters)
if ($deliveryChapters.Count -ne $chapterIds.Count -or (@($deliveryChapters | ForEach-Object { $_.id }) -join ',') -cne ($chapterIds -join ',')) {
  throw 'Delivery profile must contain the eight canonical chapters in order.'
}
for ($profileIndex = 0; $profileIndex -lt $chapterIds.Count; $profileIndex++) {
  $profileText = (@($deliveryChapters[$profileIndex].segments | ForEach-Object { $_.text }) -join ' ')
  if ($profileText -cne $paragraphs[$profileIndex]) {
    throw "Delivery profile text must exactly match narration chapter '$($chapterIds[$profileIndex])'."
  }
}
[double]$chapterPauseSeconds = [double]$deliveryProfile.chapterPauseSeconds
[double]$internalPauseSeconds = [double]$deliveryProfile.internalPauseSeconds
$workingDirectory = Join-Path ([IO.Path]::GetTempPath()) ("relay-professional-v2-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $workingDirectory | Out-Null
try {
  $captions = @()
  $timings = @()
  $chapterStarts = [ordered]@{}
  $concatLines = @()
  [double]$offset = 0
  for ($index = 0; $index -lt $paragraphs.Count; $index++) {
    $chapterWav = Join-Path $workingDirectory ("chapter-{0:D2}.wav" -f $index)
    $chapterStart = [Math]::Round($offset, 3)
    $chapterStarts[$chapterIds[$index]] = $chapterStart
    $chapterCaptions = @()
    $chapterConcatLines = @()
    [double]$chapterSpokenDuration = 0
    $segments = @($deliveryChapters[$index].segments)
    for ($segmentIndex = 0; $segmentIndex -lt $segments.Count; $segmentIndex++) {
      $segment = $segments[$segmentIndex]
      $segmentMp3 = Join-Path $workingDirectory ("chapter-{0:D2}-segment-{1:D2}.mp3" -f $index, $segmentIndex)
      $segmentSrt = Join-Path $workingDirectory ("chapter-{0:D2}-segment-{1:D2}.srt" -f $index, $segmentIndex)
      $segmentWav = Join-Path $workingDirectory ("chapter-{0:D2}-segment-{1:D2}.wav" -f $index, $segmentIndex)
      $segmentTextPath = Join-Path $workingDirectory ("chapter-{0:D2}-segment-{1:D2}.txt" -f $index, $segmentIndex)
      [IO.File]::WriteAllText($segmentTextPath, [string]$segment.text, [Text.UTF8Encoding]::new($false))
      & uvx --from 'edge-tts==7.2.8' edge-tts --voice $deliveryProfile.voice --rate=$($segment.rate) --pitch=$($segment.pitch) --volume=$($deliveryProfile.volume) --file $segmentTextPath --write-media $segmentMp3 --write-subtitles $segmentSrt
      if ($LASTEXITCODE -ne 0) { throw "Narration synthesis failed for chapter $($chapterIds[$index]) segment $segmentIndex." }
      & ffmpeg -y -v error -i $segmentMp3 -af 'aresample=48000,aformat=channel_layouts=stereo,areverse,silenceremove=start_periods=1:start_duration=0.10:start_threshold=-45dB:start_silence=0,areverse' -ar 48000 -ac 2 -c:a pcm_s16le $segmentWav
      if ($LASTEXITCODE -ne 0) { throw "Could not trim chapter $($chapterIds[$index]) segment $segmentIndex." }
      $segmentDuration = Get-AudioDuration $segmentWav
      $segmentCaptions = Get-SrtCues -Path $segmentSrt -Offset ($chapterStart + $chapterSpokenDuration)
      $segmentEnd = $chapterStart + $chapterSpokenDuration + $segmentDuration
      foreach ($caption in $segmentCaptions) {
        if ($chapterCaptions.Count -gt 0) {
          $previousCaption = $chapterCaptions[$chapterCaptions.Count - 1]
          if ($caption.startSeconds -lt $previousCaption.endSeconds) {
            $previousCaption.endSeconds = [Math]::Round($caption.startSeconds, 3)
          }
          if ($previousCaption.endSeconds -le $previousCaption.startSeconds) { throw "Caption for chapter $($chapterIds[$index]) segment $segmentIndex has no visible duration after overlap trimming." }
        }
        $caption.endSeconds = [Math]::Round([Math]::Min($caption.endSeconds, $segmentEnd), 3)
        if ($caption.endSeconds -le $caption.startSeconds) { throw "Caption for chapter $($chapterIds[$index]) segment $segmentIndex was removed by tail trimming." }
        $chapterCaptions += $caption
      }
      $chapterConcatLines += "file '$($segmentWav.Replace("'", "'\\''"))'"
      $chapterSpokenDuration += $segmentDuration
      if ($segmentIndex -lt ($segments.Count - 1)) {
        $internalPauseWav = Join-Path $workingDirectory ("chapter-{0:D2}-internal-pause-{1:D2}.wav" -f $index, $segmentIndex)
        & ffmpeg -y -v error -f lavfi -t $internalPauseSeconds -i 'anullsrc=channel_layout=stereo:sample_rate=48000' -c:a pcm_s16le $internalPauseWav
        if ($LASTEXITCODE -ne 0) { throw "Could not prepare internal pause for chapter $($chapterIds[$index]) segment $segmentIndex." }
        $chapterConcatLines += "file '$($internalPauseWav.Replace("'", "'\\''"))'"
        $chapterSpokenDuration += $internalPauseSeconds
      }
    }
    $chapterPauseWav = Join-Path $workingDirectory ("chapter-{0:D2}-final-pause.wav" -f $index)
    & ffmpeg -y -v error -f lavfi -t $chapterPauseSeconds -i 'anullsrc=channel_layout=stereo:sample_rate=48000' -c:a pcm_s16le $chapterPauseWav
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare final pause for chapter $($chapterIds[$index])." }
    $chapterConcatLines += "file '$($chapterPauseWav.Replace("'", "'\\''"))'"
    $chapterConcatFile = Join-Path $workingDirectory ("chapter-{0:D2}.ffconcat" -f $index)
    [IO.File]::WriteAllLines($chapterConcatFile, $chapterConcatLines, [Text.UTF8Encoding]::new($false))
    & ffmpeg -y -v error -f concat -safe 0 -i $chapterConcatFile -ar 48000 -ac 2 -c:a pcm_s16le $chapterWav
    if ($LASTEXITCODE -ne 0) { throw "Could not prepare chapter $($chapterIds[$index]) for concatenation." }
    $preparedDuration = Get-AudioDuration $chapterWav
    $spokenDuration = Get-SpokenDurationSeconds -PreparedDurationSeconds $preparedDuration -ChapterPauseSeconds $chapterPauseSeconds
    $chapterEnd = $chapterStart + $spokenDuration
    foreach ($caption in $chapterCaptions) {
      $caption.endSeconds = [Math]::Round([Math]::Min($caption.endSeconds, $chapterEnd), 3)
      if ($caption.endSeconds -le $caption.startSeconds) { throw "Caption for chapter $($chapterIds[$index]) was removed by tail trimming." }
    }
    $captions += $chapterCaptions
    $timings += [ordered]@{ id = $chapterIds[$index]; startSeconds = $chapterStart; durationSeconds = [Math]::Round($spokenDuration, 3); wordCount = @($paragraphs[$index] -split '\s+').Count }
    $concatLines += "file '$($chapterWav.Replace("'", "'\\''"))'"
    $offset += $preparedDuration
  }
  $concatFile = Join-Path $workingDirectory 'chapters.ffconcat'
  [IO.File]::WriteAllLines($concatFile, $concatLines, [Text.UTF8Encoding]::new($false))
  $rawMasterPath = Join-Path $workingDirectory 'relay-professional-narration-v2-raw.wav'
  & ffmpeg -y -v error -f concat -safe 0 -i $concatFile -ar 48000 -ac 2 -c:a pcm_s16le $rawMasterPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not create unnormalized narration WAV.' }
  $masterPath = Join-Path $assetsDirectory 'relay-professional-narration-v2.wav'
  $loudness = Normalize-Narration -SourcePath $rawMasterPath -TargetPath $masterPath
  $captions = @(Normalize-CaptionCues $captions)
  $timingManifest = [ordered]@{
    audioDurationSeconds = [Math]::Round((Get-AudioDuration $masterPath), 3)
    chapterStarts = $chapterStarts
    chapters = $timings
  }
  $utf8NoBom = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText((Join-Path $assetsDirectory 'relay-professional-captions-v2.json'), ($captions | ConvertTo-Json -Depth 3), $utf8NoBom)
  [IO.File]::WriteAllText((Join-Path $assetsDirectory 'relay-professional-timings-v2.json'), ($timingManifest | ConvertTo-Json -Depth 4), $utf8NoBom)
  [IO.File]::WriteAllText((Join-Path $assetsDirectory 'relay-professional-narration-v2-loudness.json'), ($loudness | ConvertTo-Json -Depth 5), $utf8NoBom)
} finally {
  if (Test-Path -LiteralPath $workingDirectory) { Remove-Item -LiteralPath $workingDirectory -Recurse -Force }
}
