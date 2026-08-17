[CmdletBinding()]
param(
  [string]$AssetDirectory,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
if (-not $AssetDirectory) {
  $AssetDirectory = Join-Path $PSScriptRoot '..\docs\submission\assets'
}
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$assetRoot = (Resolve-Path -LiteralPath $AssetDirectory).Path
$rawRoot = Join-Path $assetRoot 'professional-raw'
$rawVideo = Join-Path $rawRoot 'relay-production-journey.webm'
$captureManifestPath = Join-Path $rawRoot 'relay-production-journey.json'
$narrationPath = Join-Path $assetRoot 'relay-professional-narration-v2.wav'
$timingPath = Join-Path $assetRoot 'relay-professional-timings-v2.json'
$captionPath = Join-Path $assetRoot 'relay-professional-captions-v2.json'
$overlayPath = Join-Path $assetRoot 'relay-professional-overlay-v2.ass'
$outputPath = Join-Path $assetRoot 'relay-professional-demo-v2.mp4'
$finalNormalizationFilter = 'loudnorm=I=-16:TP=-2.0:LRA=11'
$finalOutputTruePeakLimitDbfs = -1.5

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

function Test-Utf8WithoutBom([string]$Path, [string]$Label) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "$Label must be UTF-8 without a BOM"
  }
}

function Get-CanonicalTimingManifest([string]$Path) {
  Test-Utf8WithoutBom -Path $Path -Label 'Timing JSON'
  $timingValue = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ($timingValue -is [System.Array]) { throw 'Timing JSON must be a canonical JSON object; legacy arrays are not supported' }
  if ($timingValue -isnot [pscustomobject]) { throw 'Timing JSON must be a canonical JSON object' }
  if (-not $timingValue.PSObject.Properties['audioDurationSeconds']) { throw 'Timing JSON must include audioDurationSeconds' }
  if (-not $timingValue.PSObject.Properties['chapterStarts']) { throw 'Timing JSON must include chapterStarts' }
  if (-not $timingValue.PSObject.Properties['chapters']) { throw 'Timing JSON must include chapters' }
  $declaredDuration = [double]$timingValue.audioDurationSeconds
  if (-not (Test-FiniteDouble $declaredDuration) -or $declaredDuration -le 0) { throw 'Timing JSON audioDurationSeconds must be positive and finite' }

  $chapterIds = @('promise', 'brief', 'plan', 'failure', 'recovery', 'ready', 'youcam', 'business')
  if ($timingValue.chapterStarts -isnot [pscustomobject]) { throw 'Timing JSON chapterStarts must be an object' }
  $startNames = @($timingValue.chapterStarts.PSObject.Properties.Name)
  if (($startNames -join ',') -cne ($chapterIds -join ',')) { throw 'Timing JSON chapterStarts must contain the eight canonical chapter ids in order' }
  $chapters = @($timingValue.chapters)
  if ($chapters.Count -ne $chapterIds.Count) { throw "Timing JSON must contain eight chapters, found $($chapters.Count)" }

  $starts = [System.Collections.Generic.List[double]]::new()
  for ($index = 0; $index -lt $chapterIds.Count; $index++) {
    $id = $chapterIds[$index]
    $chapter = $chapters[$index]
    if ($chapter -isnot [pscustomobject] -or $chapter.id -cne $id) { throw "Timing JSON chapter $($index + 1) must be '$id'" }
    if (-not $chapter.PSObject.Properties['startSeconds'] -or -not $chapter.PSObject.Properties['durationSeconds']) { throw "Timing JSON chapter '$id' is missing timing fields" }
    $start = [double]$chapter.startSeconds
    $declaredStart = [double]$timingValue.chapterStarts.$id
    $chapterDuration = [double]$chapter.durationSeconds
    if (-not (Test-FiniteDouble $start) -or -not (Test-FiniteDouble $declaredStart) -or $start -lt 0 -or $declaredStart -lt 0) { throw "Timing JSON chapter '$id' contains an invalid start" }
    if (-not (Test-FiniteDouble $chapterDuration) -or $chapterDuration -le 0) { throw "Timing JSON chapter '$id' contains an invalid duration" }
    if ([math]::Abs($start - $declaredStart) -gt 0.001) { throw "Timing JSON chapter '$id' disagrees with chapterStarts" }
    if (($start + $chapterDuration) -gt ($declaredDuration + 0.001)) { throw "Timing JSON chapter '$id' exceeds audioDurationSeconds" }
    $starts.Add($start)
  }
  if ($starts[0] -ne 0) { throw 'The first narration chapter must start at zero' }
  for ($index = 1; $index -lt $starts.Count; $index++) {
    if ($starts[$index] -le $starts[$index - 1]) { throw 'Narration chapter starts must be strictly increasing' }
  }
  if ($starts[$starts.Count - 1] -ge $declaredDuration) { throw 'The final narration chapter must start before audioDurationSeconds' }
  return [pscustomobject]@{ audioDurationSeconds = $declaredDuration; chapterStarts = $starts }
}

function Test-CaptionOverlayCorrelation([string]$CaptionPath, [string]$OverlayPath, [double]$AudioDuration) {
  Test-Utf8WithoutBom -Path $CaptionPath -Label 'Caption JSON'
  $captionSource = Get-Content -Raw -LiteralPath $CaptionPath
  if (-not $captionSource.TrimStart().StartsWith('[')) { throw 'Caption JSON must be an array' }
  $captions = @((ConvertFrom-Json -InputObject $captionSource) | ForEach-Object { $_ })
  for ($index = 0; $index -lt $captions.Count; $index++) {
    $caption = $captions[$index]
    if ($caption -isnot [pscustomobject] -or -not $caption.PSObject.Properties['startSeconds'] -or -not $caption.PSObject.Properties['endSeconds'] -or -not $caption.PSObject.Properties['text']) { throw "Caption $($index + 1) is malformed" }
    $start = [double]$caption.startSeconds
    $end = [double]$caption.endSeconds
    if (-not (Test-FiniteDouble $start) -or -not (Test-FiniteDouble $end) -or $start -lt 0 -or $end -le $start -or $end -gt $AudioDuration -or [string]::IsNullOrWhiteSpace([string]$caption.text)) { throw "Caption $($index + 1) is malformed" }
  }
  $overlay = Get-Content -Raw -LiteralPath $OverlayPath
  $countMatch = [regex]::Match($overlay, '(?m)^; relay-caption-count=([0-9]+)\r?$')
  $hashMatch = [regex]::Match($overlay, '(?m)^; relay-caption-sha256=([a-fA-F0-9]{64})\r?$')
  if (-not $countMatch.Success -or -not $hashMatch.Success) { throw 'ASS overlay is missing its caption correlation marker' }
  if ([int]$countMatch.Groups[1].Value -ne $captions.Count) { throw 'ASS caption marker count does not match caption JSON' }
  $captionHash = (Get-FileHash -LiteralPath $CaptionPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hashMatch.Groups[1].Value.ToLowerInvariant() -ne $captionHash) { throw 'ASS caption marker hash does not match caption JSON' }
  $dialogueCount = [regex]::Matches($overlay, '(?m)^Dialogue:\s*10,[^,\r\n]+,[^,\r\n]+,Caption,caption-[0-9]+,').Count
  if ($dialogueCount -ne $captions.Count) { throw 'ASS caption dialogue count does not match caption JSON' }
}

function Get-RepositoryRelativeSubtitlePath([string]$Path) {
  $absolutePath = (Resolve-Path -LiteralPath $Path).Path
  $repositoryPrefix = $repositoryRoot.TrimEnd('\') + '\'
  if (-not $absolutePath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'ASS overlay must stay inside the repository root' }
  $relativePath = $absolutePath.Substring($repositoryPrefix.Length) -replace '\\', '/'
  if (-not $relativePath -or $relativePath.StartsWith('../')) { throw 'ASS overlay path must be repository-relative' }
  return $relativePath
}

$timingManifest = Get-CanonicalTimingManifest -Path $timingPath
Test-CaptionOverlayCorrelation -CaptionPath $captionPath -OverlayPath $overlayPath -AudioDuration $timingManifest.audioDurationSeconds
$subtitlePath = Get-RepositoryRelativeSubtitlePath -Path $overlayPath
if ($ValidateOnly) {
  Write-Output "V2 compositor preflight passed: $subtitlePath"
  return
}

$audioDuration = Get-ProbeDuration $narrationPath
if ([math]::Abs($audioDuration - $timingManifest.audioDurationSeconds) -gt 0.1) { throw 'Narration WAV duration does not match timing JSON audioDurationSeconds' }
$chapterStarts = $timingManifest.chapterStarts
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
  '-af', $finalNormalizationFilter,
  '-movflags', '+faststart',
  '-t', $durationFilter,
  $outputPath
)

Push-Location -LiteralPath $repositoryRoot
try {
  & $ffmpeg @arguments
  $ffmpegExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($ffmpegExitCode -ne 0) { throw "ffmpeg exited with code $ffmpegExitCode" }

$savedErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $ebur128Output = & $ffmpeg -hide_banner -i $outputPath -filter:a 'ebur128=peak=true' -f null NUL 2>&1
  $ebur128ExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $savedErrorActionPreference
}
if ($ebur128ExitCode -ne 0) { throw "ffmpeg could not measure final audio true peak for '$outputPath'" }
$truePeakMatch = [regex]::Match(($ebur128Output -join "`n"), 'True peak:\s*\r?\n\s*Peak:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*dBFS')
if (-not $truePeakMatch -or -not $truePeakMatch.Success) { throw "ffmpeg ebur128=peak=true did not report a final audio true peak for '$outputPath'" }
$finalOutputTruePeakDbfs = [double]::Parse($truePeakMatch.Groups[1].Value, $culture)
if (-not (Test-FiniteDouble $finalOutputTruePeakDbfs) -or $finalOutputTruePeakDbfs -gt $finalOutputTruePeakLimitDbfs) {
  throw "Final audio true peak $finalOutputTruePeakDbfs dBFS exceeds the binding $finalOutputTruePeakLimitDbfs dBFS limit"
}
Write-Output "Final audio true peak passed: $finalOutputTruePeakDbfs dBFS"

& $ffprobe -v error -show_entries 'format=duration,size' -show_entries 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels' -of json $outputPath
if ($LASTEXITCODE -ne 0) { throw "ffprobe could not read '$outputPath'" }
Write-Output $outputPath
