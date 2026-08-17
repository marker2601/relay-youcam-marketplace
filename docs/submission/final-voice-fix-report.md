# Final voice and timing fix report

Date: August 16, 2026

## Corrected release contract

- One voice only: pinned `edge-tts==7.2.8`, `en-US-JennyNeural`.
- A shared UTF-8 delivery profile now supplies both the approved voice sample and all eight full-release chapters.
- The release opens with the approved three-beat contour and exact text: `Hey—do you know what makes Relay different?` at +8 Hz; `It does not just show you an outfit.` at -5 Hz; and `It keeps a ready backup in motion, so when the first plan falls through, your event does not.` at +5 Hz.
- The same profile specifies intentional varied rates/pitches through the remaining chapters, 220 ms internal segment pauses, and a final 120 ms chapter pause.

## Defects found and fixed

- Windows PowerShell 5.1 selected an integer overload for the old `[Math]::Max(0, ...)` call. The generator now uses `[Math]::Max([double]0, ...)`; the behavioral probe preserves `10.998 - 0.120 = 10.878` seconds.
- PowerShell's native command and default text-encoding boundaries could corrupt or stop the FFmpeg/edge-tts path. Narration profile, narration source, and SRT reads are explicit UTF-8; edge-tts consumes UTF-8 text files rather than a Windows command-line string.
- Edge subtitle cue handoffs could overlap by a few milliseconds. The generator trims the prior caption to the incoming cue start; compositor preflight independently rejects every caption overlap and every chapter whose declared duration reaches the following chapter.

## Exact replacement candidate

- Master: `docs/submission/assets/relay-professional-demo-v2.mp4`
- SHA-256: `EC2449532A49FFEF490402A344F20559D43DD532315BD64C0430E593D36651C4`
- Duration: 160.933333 seconds; 4,828 frames; 1920x1080, 30 fps; H.264 `yuv420p`; AAC stereo 48 kHz; `ftyp` → `moov` → `mdat`.
- Audio: -16.0 LUFS integrated and -2.0 dBFS true peak; strict `silencedetect` found no interval at -45 dB for 1.2 seconds, and `blackdetect` found no interval.
- Captions: 39 UTF-8 cues, sequential and non-overlapping; the first cue exactly preserves the approved hook.
- Focused checks: v2 unit 29/29, TypeScript typecheck, lint with 0 errors (3 pre-existing fixture warnings), PowerShell parse, exact-master full decode, and diff check all passed.
- Original master retained unchanged: `relay-professional-demo.mp4` SHA-256 `5A632C927641B0E7B0023212EA4F0F0AA00F0F6F8CA27008062758CC8A5B8E87`.

## Boundary

This report records a local replacement candidate only. No upload, public URL update, Devpost mutation, push, or submission action was performed by this fix.
