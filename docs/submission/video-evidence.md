# Relay professional demo v2 evidence

Local release verification completed on August 16, 2026.

- Exact master: `docs/submission/assets/relay-professional-demo-v2.mp4`
- Duration: 160.933333 seconds (2:40.933)
- File size: 12,617,548 bytes
- SHA-256: `60FE80A9308E48E5FF3835279DB7E9BD177332B39D27D44635D27BA2DE62213B`
- Format: 1920x1080, 30 fps, H.264 `yuv420p`, AAC stereo at 48 kHz, with `ftyp` -> `moov` -> `mdat` atom order
- Decode: 4,828 of 4,828 frames decoded with no decoder error
- Audio: -16.0 LUFS integrated; -1.9 dBFS true peak; no silence interval longer than 1.2 seconds at -45 dB
- Visual continuity: `blackdetect=d=0.2:pix_th=0.10` reported no black interval; five independently-seeked raw-RGB frames matched sequential decode at 12%, 35%, 60%, 84%, and 98%
- Captions: 49 burned-in UTF-8 caption cues are sequential and non-overlapping; every cue has at most two lines and every line is no longer than 43 characters. The approved opening caption preserves `Hey—do you know what makes Relay different?`
- Visual/privacy QA: all 49 caption midpoints were inspected at native 1920x1080 resolution, including the three replacement chunks spanning 118.422-131.248 seconds. First/middle/final frames for all eight chapters (24 frames) and all six overlay cues (18 frames) were also inspected. Product proof remained readable; captions were complete and clear of active controls; the Human Handoff palette was shopper gold, primary coral, and backup green; and no credential, task ID, signed URL, private key, local path, or unrelated browser content was visible.
- Speech QA: full local `ggml-base.en` ASR preserved the Relay reliability layer; discovery-versus-outcome promise; YouCam Clothes v3 (with phonetic model renderings); signed upload and private storage result; primary decline; backup activation and acceptance; Event ready; literal `This prototype collects zero dollars`; literal `It does not process payments`; delivery/physical-fit and availability/transaction-completion limitations; and the 18% commission hypothesis
- Repository QA: focused v2 tests 31/31, typecheck, unit 213/213, serial integration 77/77, monolithic 290/290, production build, and `git diff --check` passed; lint had zero errors and three known fixture warnings

The video uses real production-product footage throughout. It demonstrates the primary-decline, independent-backup activation, backup acceptance, and Event ready journey. The binding limitations remain visible and narrated: this prototype collects $0, does not process payments, and does not guarantee delivery, physical fit, availability, or transaction completion.

## Publication and Devpost readback

- Replacement pending: this exact locally verified master has **not** been uploaded, published, or attached to Devpost by this fix.
- The prior public video and Devpost URL remain unchanged until final review confirms this replacement candidate.
