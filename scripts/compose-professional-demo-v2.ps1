[CmdletBinding()]
param(
  [string]$AssetDirectory
)

$ErrorActionPreference = 'Stop'
if (-not $AssetDirectory) {
  $AssetDirectory = Join-Path $PSScriptRoot '..\docs\submission\assets'
}
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$assetRoot = (Resolve-Path -LiteralPath $AssetDirectory).Path
$rawRoot = Join-Path $assetRoot 'professional-raw'
$rawVideo = Join-Path $rawRoot 'relay-production-journey.webm'
$captureManifestPath = Join-Path $rawRoot 'relay-production-journey.json'
$narrationPath = Join-Path $assetRoot 'relay-professional-narration-v2.wav'
$timingPath = Join-Path $assetRoot 'relay-professional-timings-v2.json'
$captionPath = Join-Path $assetRoot 'relay-professional-captions-v2.json'
$overlayPath = Join-Path $assetRoot 'relay-professional-overlay-v2.ass'
$outputPath = Join-Path $assetRoot 'relay-professional-demo-v2.mp4'

foreach ($required in @($rawVideo, $captureManifestPath, $narrationPath, $timingPath, $captionPath, $overlayPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Missing professional-demo v2 input: $required"
  }
}

$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobeCommand = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpegCommand -or -not $ffprobeCommand) {
  throw 'ffmpeg and ffprobe must be available on PATH'
}
$ffmpeg = $ffmpegCommand.Source
$ffprobe = $ffprobeCommand.Source

function Get-ProbeDuration([string]$Path) {
  $durationText = (& $ffprobe -v error -show_entries format=duration -of 'default=noprint_wrappers=1:nokey=1' $Path).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $durationText) { throw "ffprobe could not read '$Path'" }
  $duration = [double]::Parse($durationText, $culture)
  if (-not (Test-FiniteDouble $duration) -or $duration -le 0) { throw "Invalid duration for '$Path'" }
  return $duration
}

function Test-FiniteDouble([double]$Value) {
  return -not ([double]::IsNaN($Value) -or [double]::IsInfinity($Value))
}

function Get-ChapterStarts([string]$Path, [double]$AudioDuration) {
  $timingValue = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  $chapters = if ($timingValue -is [System.Array]) { @($timingValue) } elseif ($timingValue.chapters) { @($timingValue.chapters) } else { @() }
  if ($chapters.Count -ne 8) { throw "Expected eight timing chapters, found $($chapters.Count)" }
  $starts = [System.Collections.Generic.List[double]]::new()
  foreach ($chapter in $chapters) {
    $start = [double]$chapter.startSeconds
    if (-not (Test-FiniteDouble $start) -or $start -lt 0) { throw 'Timing JSON contains an invalid chapter start' }
    $starts.Add($start)
  }
  if ($starts[0] -ne 0) { throw 'The first narration chapter must start at zero' }
  for ($index = 1; $index -lt $starts.Count; $index++) {
    if ($starts[$index] -le $starts[$index - 1]) { throw 'Narration chapter starts must be strictly increasing' }
  }
  if ($starts[$starts.Count - 1] -ge $AudioDuration) { throw 'The final narration chapter must start before narration ends' }
  return $starts
}

$audioDuration = Get-ProbeDuration $narrationPath
$chapterStarts = Get-ChapterStarts -Path $timingPath -AudioDuration $audioDuration
$capture = Get-Content -Raw -LiteralPath $captureManifestPath | ConvertFrom-Json
$sceneByName = @{}
foreach ($scene in $capture.scenes) { $sceneByName[$scene.name] = $scene }
$rawDuration = Get-ProbeDuration $rawVideo

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
for ($index = 0; $index -lt 8; $index++) {
  $targetStart = $chapterStarts[$index]
  $targetEnd = if ($index + 1 -lt $chapterStarts.Count) { $chapterStarts[$index + 1] } else { $audioDuration }
  $targetDuration = $targetEnd - $targetStart
  $sourceStart = [double]$sourceRanges[$index][0]
  $sourceEnd = [math]::Min([double]$sourceRanges[$index][1], $rawDuration - 0.04)
  $sourceDuration = $sourceEnd - $sourceStart
  if ($sourceDuration -le 0 -or $targetDuration -le 0) { throw "Invalid chapter timing for chapter $($index + 1)" }
  $sourceStartText = $sourceStart.ToString('0.######', $culture)
  $sourceEndText = $sourceEnd.ToString('0.######', $culture)
  $speedFactor = ($targetDuration / $sourceDuration).ToString('0.######', $culture)
  $motion = if ($index -eq 7) {
    ",zoompan=z='min(zoom+0.00006,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30"
  } else { '' }
  $filterParts.Add("[0:v]trim=start=${sourceStartText}:end=${sourceEndText},setpts=(PTS-STARTPTS)*$speedFactor,scale=1706:960:flags=lanczos,pad=1920:1080:107:0:color=#142f25,fps=30$motion,setsar=1,format=yuv420p[v$index]")
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
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
  '-movflags', '+faststart',
  '-t', $durationFilter,
  $outputPath
)

& $ffmpeg @arguments
if ($LASTEXITCODE -ne 0) { throw "ffmpeg exited with code $LASTEXITCODE" }

& $ffprobe -v error -show_entries 'format=duration,size' -show_entries 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels' -of json $outputPath
if ($LASTEXITCODE -ne 0) { throw "ffprobe could not read '$outputPath'" }
Write-Output $outputPath
