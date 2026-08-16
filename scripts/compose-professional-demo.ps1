param(
  [string]$AssetDirectory = (Join-Path $PSScriptRoot '..\docs\submission\assets')
)

$ErrorActionPreference = 'Stop'
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$assetRoot = (Resolve-Path -LiteralPath $AssetDirectory).Path
$rawRoot = Join-Path $assetRoot 'professional-raw'
$rawVideo = Join-Path $rawRoot 'relay-production-journey.webm'
$captureManifestPath = Join-Path $rawRoot 'relay-production-journey.json'
$narrationTextPath = Join-Path $assetRoot 'demo-narration.txt'
$narrationPath = Join-Path $assetRoot 'relay-professional-narration.wav'
$overlayPath = Join-Path $assetRoot 'relay-professional-overlay.ass'
$timingPath = Join-Path $assetRoot 'relay-professional-timings.json'
$outputPath = Join-Path $assetRoot 'relay-professional-demo.mp4'

foreach ($required in @($rawVideo, $captureManifestPath, $narrationTextPath)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Missing professional-demo input: $required"
  }
}

$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobeCommand = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpegCommand -or -not $ffprobeCommand) {
  throw 'ffmpeg and ffprobe must be available on PATH'
}
$ffmpeg = $ffmpegCommand.Source
$ffprobe = $ffprobeCommand.Source

$narration = (Get-Content -Raw -LiteralPath $narrationTextPath).Trim()
$paragraphMatches = [regex]::Matches($narration, '(?ms)(?:^|\r?\n\r?\n)(.+?)(?=\r?\n\r?\n|$)')
if ($paragraphMatches.Count -ne 8) {
  throw "Expected eight narration chapters, found $($paragraphMatches.Count)"
}

Add-Type -AssemblyName System.Speech
$wordEvents = [System.Collections.Generic.List[object]]::new()
$handler = [System.EventHandler[System.Speech.Synthesis.SpeakProgressEventArgs]] {
  param($sender, $eventArgs)
  $wordEvents.Add([pscustomobject]@{
    text = $eventArgs.Text
    characterPosition = $eventArgs.CharacterPosition
    characterCount = $eventArgs.CharacterCount
    milliseconds = [math]::Round($eventArgs.AudioPosition.TotalMilliseconds)
  })
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft David Desktop')
$synth.Rate = 1
$synth.Volume = 100
$synth.add_SpeakProgress($handler)
$synth.SetOutputToWaveFile($narrationPath)
$synth.Speak($narration)
$synth.remove_SpeakProgress($handler)
$synth.Dispose()

if ($wordEvents.Count -eq 0) {
  throw 'Narration synthesis returned no word timings'
}

$audioDurationText = (& $ffprobe -v error -show_entries format=duration -of 'default=noprint_wrappers=1:nokey=1' $narrationPath).Trim()
$audioDuration = [double]::Parse($audioDurationText, $culture)
$reportedDurationMs = ($wordEvents | Measure-Object milliseconds -Maximum).Maximum
if (-not $reportedDurationMs -or $reportedDurationMs -le 0) {
  throw 'Narration synthesis returned invalid progress timing'
}
$progressScale = ($audioDuration * 1000) / $reportedDurationMs
foreach ($event in $wordEvents) {
  $event.milliseconds = [math]::Round($event.milliseconds * $progressScale)
}

function Format-AssTime([double]$seconds) {
  if ($seconds -lt 0) { $seconds = 0 }
  $hours = [math]::Floor($seconds / 3600)
  $minutes = [math]::Floor(($seconds % 3600) / 60)
  $wholeSeconds = [math]::Floor($seconds % 60)
  $centiseconds = [math]::Floor(($seconds - [math]::Floor($seconds)) * 100)
  return ('{0}:{1:00}:{2:00}.{3:00}' -f $hours, $minutes, $wholeSeconds, $centiseconds)
}

function Wrap-Caption([string]$text) {
  $words = $text.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
  if ($text.Length -le 44) { return $text }
  $best = $null
  $bestDifference = [int]::MaxValue
  for ($split = 1; $split -lt $words.Count; $split++) {
    $first = ($words[0..($split - 1)] -join ' ')
    $second = ($words[$split..($words.Count - 1)] -join ' ')
    if ($first.Length -gt 44 -or $second.Length -gt 44) { continue }
    $difference = [math]::Abs($first.Length - $second.Length)
    if ($difference -lt $bestDifference) {
      $best = "$first\N$second"
      $bestDifference = $difference
    }
  }
  if (-not $best) {
    throw "Caption exceeded two lines: $text"
  }
  return $best
}

$tokens = [System.Collections.Generic.List[object]]::new()
for ($index = 0; $index -lt $wordEvents.Count; $index++) {
  $event = $wordEvents[$index]
  $nextPosition = if ($index + 1 -lt $wordEvents.Count) {
    $wordEvents[$index + 1].characterPosition
  } else {
    $narration.Length
  }
  $length = [math]::Max(0, $nextPosition - $event.characterPosition)
  $token = $narration.Substring($event.characterPosition, $length).Trim()
  $token = ($token -replace '\s+', ' ')
  if (-not $token) { $token = $event.text }
  $tokens.Add([pscustomobject]@{
    text = $token
    milliseconds = $event.milliseconds
    characterPosition = $event.characterPosition
  })
}

$cueGroups = [System.Collections.Generic.List[object]]::new()
$current = [System.Collections.Generic.List[object]]::new()
foreach ($token in $tokens) {
  $candidate = ((@($current | ForEach-Object { $_.text }) + $token.text) -join ' ').Trim()
  $duration = if ($current.Count) { $token.milliseconds - $current[0].milliseconds } else { 0 }
  $sentenceBreak = $current.Count -gt 0 -and $current[$current.Count - 1].text -match '[.!?][”"]?$'
  if ($current.Count -gt 0 -and ($candidate.Length -gt 80 -or $duration -gt 4200 -or ($sentenceBreak -and $candidate.Length -gt 45))) {
    $cueGroups.Add(@($current))
    $current = [System.Collections.Generic.List[object]]::new()
  }
  $current.Add($token)
}
if ($current.Count) { $cueGroups.Add(@($current)) }

$chapterStarts = [System.Collections.Generic.List[double]]::new()
for ($index = 0; $index -lt $paragraphMatches.Count; $index++) {
  if ($index -eq 0) {
    $chapterStarts.Add(0)
    continue
  }
  $paragraphStart = $paragraphMatches[$index].Groups[1].Index
  $firstWord = $wordEvents | Where-Object { $_.characterPosition -ge $paragraphStart } | Select-Object -First 1
  if (-not $firstWord) { throw "Could not locate narration chapter $($index + 1)" }
  $chapterStarts.Add($firstWord.milliseconds / 1000)
}

$chapterLabels = @(
  'THE PROBLEM',
  'ONE URGENT BRIEF',
  'PRIMARY + INDEPENDENT BACKUP',
  'THE FIRST PLAN FAILS',
  'ONE-ACTION RECOVERY',
  'EVENT READY',
  'YOUCAM + RELIABILITY',
  'THE BUSINESS'
)

$ass = [System.Collections.Generic.List[string]]::new()
$ass.Add('[Script Info]')
$ass.Add('ScriptType: v4.00+')
$ass.Add('PlayResX: 1920')
$ass.Add('PlayResY: 1080')
$ass.Add('WrapStyle: 2')
$ass.Add('ScaledBorderAndShadow: yes')
$ass.Add('')
$ass.Add('[V4+ Styles]')
$ass.Add('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding')
$ass.Add('Style: Caption,Segoe UI Semibold,42,&H00FFFFFF,&H000000FF,&H00142F25,&H00142F25,-1,0,0,0,100,100,0,0,3,0,0,2,160,160,20,1')
$ass.Add('Style: Chapter,Segoe UI Semibold,32,&H00FFFFFF,&H000000FF,&H00142F25,&H20142F25,-1,0,0,0,100,100,1.4,0,3,0,0,7,84,60,56,1')
$ass.Add('Style: Architecture,Segoe UI Semibold,35,&H00FFFFFF,&H000000FF,&H00142F25,&H00142F25,-1,0,0,0,100,100,0,0,3,6,0,8,110,110,112,1')
$ass.Add('Style: CTA,Segoe UI Semibold,32,&H00142F25,&H000000FF,&H00F4F0E8,&H00F4F0E8,-1,0,0,0,100,100,0.8,0,3,0,0,9,84,84,56,1')
$ass.Add('')
$ass.Add('[Events]')
$ass.Add('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')

for ($index = 0; $index -lt $chapterStarts.Count; $index++) {
  $start = $chapterStarts[$index]
  $end = if ($index + 1 -lt $chapterStarts.Count) { $chapterStarts[$index + 1] } else { $audioDuration }
  $ass.Add("Dialogue: 1,$(Format-AssTime $start),$(Format-AssTime ([math]::Min($end, $start + 4.5))),Chapter,,0,0,0,,$($chapterLabels[$index])")
}

$architectureStart = $chapterStarts[6]
$architectureEnd = [math]::Min($chapterStarts[7], $architectureStart + 10)
$ass.Add("Dialogue: 1,$(Format-AssTime ($architectureStart + 3)),$(Format-AssTime $architectureEnd),Architecture,,0,0,0,,Signed upload  >  Clothes v3 task  >  bounded polling  >  private copy")
$ass.Add("Dialogue: 1,$(Format-AssTime ($chapterStarts[7] + 7)),$(Format-AssTime $audioDuration),CTA,,0,0,0,,TRY THE RECOVERY JOURNEY")

for ($index = 0; $index -lt $cueGroups.Count; $index++) {
  $group = $cueGroups[$index]
  $startMs = [math]::Max(0, $group[0].milliseconds - 80)
  $endMs = if ($index + 1 -lt $cueGroups.Count) {
    [math]::Max($startMs + 900, $cueGroups[$index + 1][0].milliseconds - 120)
  } else {
    $audioDuration * 1000
  }
  $caption = (($group | ForEach-Object { $_.text }) -join ' ').Trim()
  $caption = $caption.Replace('{', '\{').Replace('}', '\}')
  $ass.Add("Dialogue: 2,$(Format-AssTime ($startMs / 1000)),$(Format-AssTime ($endMs / 1000)),Caption,,0,0,0,,$(Wrap-Caption $caption)")
}

Set-Content -LiteralPath $overlayPath -Value ($ass -join "`r`n") -Encoding utf8

$capture = Get-Content -Raw -LiteralPath $captureManifestPath | ConvertFrom-Json
$sceneByName = @{}
foreach ($scene in $capture.scenes) { $sceneByName[$scene.name] = $scene }
$rawDurationText = (& $ffprobe -v error -show_entries format=duration -of 'default=noprint_wrappers=1:nokey=1' $rawVideo).Trim()
$rawDuration = [double]::Parse($rawDurationText, $culture)

$sourceRanges = @(
  @($sceneByName['hero'].start, $sceneByName['hero'].end),
  @($sceneByName['brief'].start, $sceneByName['brief'].end),
  @($sceneByName['shortlist'].start, $sceneByName['shortlist'].end),
  @($sceneByName['primary-request'].start, $sceneByName['primary-decline'].end),
  @($sceneByName['backup-activate'].start, $sceneByName['backup-activate'].end),
  @($sceneByName['backup-accept'].start, $sceneByName['event-ready'].end),
  @($sceneByName['shortlist'].start, $sceneByName['shortlist'].end),
  @($sceneByName['hero'].start, ($sceneByName['hero'].end - 0.6))
)

$filterParts = [System.Collections.Generic.List[string]]::new()
$editChapters = [System.Collections.Generic.List[object]]::new()
for ($index = 0; $index -lt 8; $index++) {
  $targetStart = $chapterStarts[$index]
  $targetEnd = if ($index + 1 -lt $chapterStarts.Count) { $chapterStarts[$index + 1] } else { $audioDuration }
  $targetDuration = $targetEnd - $targetStart
  $sourceStart = [double]$sourceRanges[$index][0]
  $sourceEnd = [double]$sourceRanges[$index][1]
  $sourceEnd = [math]::Min($sourceEnd, $rawDuration - 0.04)
  $sourceDuration = $sourceEnd - $sourceStart
  if ($sourceDuration -le 0 -or $targetDuration -le 0) {
    throw "Invalid chapter timing for chapter $($index + 1)"
  }
  $speedFactor = $targetDuration / $sourceDuration
  $s = $sourceStart.ToString('0.######', $culture)
  $e = $sourceEnd.ToString('0.######', $culture)
  $f = $speedFactor.ToString('0.######', $culture)
  $motion = if ($index -eq 7) {
    ",zoompan=z='min(zoom+0.00006,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30"
  } else { '' }
  $filterParts.Add("[0:v]trim=start=${s}:end=${e},setpts=(PTS-STARTPTS)*$f,scale=1706:960:flags=lanczos,pad=1920:1080:107:0:color=#142f25,fps=30$motion,setsar=1,format=yuv420p[v$index]")
  $editChapters.Add([pscustomobject]@{
    label = $chapterLabels[$index]
    targetStart = $targetStart
    targetEnd = $targetEnd
    sourceStart = $sourceStart
    sourceEnd = $sourceEnd
    speedFactor = $speedFactor
  })
}
$concatInputs = (0..7 | ForEach-Object { "[v$_]" }) -join ''
$filterParts.Add("${concatInputs}concat=n=8:v=1:a=0[base]")
$durationFilter = $audioDuration.ToString('0.######', $culture)
$filterParts.Add("[base]tpad=stop_mode=clone:stop_duration=0.2,trim=duration=$durationFilter[filled]")
$subtitlePath = ($overlayPath.Substring((Get-Location).Path.Length + 1) -replace '\\', '/')
$filterParts.Add("[filled]subtitles='$subtitlePath'[video]")
$filterComplex = $filterParts -join ';'

$arguments = @(
  '-y',
  '-i', $rawVideo,
  '-i', $narrationPath,
  '-filter_complex', $filterComplex,
  '-map', '[video]',
  '-map', '1:a',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-ar', '48000',
  '-ac', '2',
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,volume=2.2dB',
  '-movflags', '+faststart',
  '-t', $audioDuration.ToString('0.######', $culture),
  $outputPath
)

& $ffmpeg @arguments
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg exited with code $LASTEXITCODE"
}

$timingEvidence = [pscustomobject]@{
  audioDurationSeconds = $audioDuration
  narrationWordCount = ($narration -split '\s+' | Where-Object { $_ }).Count
  wordsPerMinute = [math]::Round((($narration -split '\s+' | Where-Object { $_ }).Count / $audioDuration) * 60, 1)
  captionCount = $cueGroups.Count
  chapters = $editChapters
}
Set-Content -LiteralPath $timingPath -Value ($timingEvidence | ConvertTo-Json -Depth 5) -Encoding utf8

& $ffprobe -v error -show_entries 'format=duration,size' -show_entries 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels' -of json $outputPath
Write-Output $outputPath
