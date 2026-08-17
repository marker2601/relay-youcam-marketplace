# Relay professional demo v2 evidence

Local release verification completed on August 16, 2026.

- Exact master: `docs/submission/assets/relay-professional-demo-v2.mp4`
- Duration: 160.933333 seconds (2:40.933)
- File size: 12,425,820 bytes
- SHA-256: `EC2449532A49FFEF490402A344F20559D43DD532315BD64C0430E593D36651C4`
- Format: 1920x1080, 30 fps, H.264 `yuv420p`, AAC stereo at 48 kHz, with `ftyp` -> `moov` -> `mdat` atom order
- Decode: 4,828 of 4,828 frames decoded with no decoder error
- Audio: -16.0 LUFS integrated; -2.0 dBFS true peak; no silence interval longer than 1.2 seconds at -45 dB
- Visual continuity: `blackdetect=d=0.2:pix_th=0.10` reported no black interval; five independently-seeked raw-RGB frames matched sequential decode at 12%, 35%, 60%, 84%, and 98%
- Captions: 39 burned-in UTF-8 caption cues are sequential and non-overlapping; the approved opening caption preserves `Hey—do you know what makes Relay different?`
- Visual/privacy QA: the Human Handoff palette is shopper gold, primary coral, and backup green. Replacement visual review remains pending before publication.
- Speech QA: full local `ggml-base.en` ASR preserved the Relay reliability layer; discovery-versus-outcome promise; YouCam Clothes v3; signed upload and private storage result; primary decline; backup activation and acceptance; Event ready; `This prototype collects $0`; `It does not process payments`; delivery/physical-fit and availability/transaction-completion limitations; and the 18% commission hypothesis
- Repository QA: typecheck passed; lint had zero errors and three known fixture warnings; unit 203/203, integration 77/77, and monolithic 280/280 tests passed; production build and `git diff --check` passed

The video uses real production-product footage throughout. It demonstrates the primary-decline, independent-backup activation, backup acceptance, and Event ready journey. The binding limitations remain visible and narrated: this prototype collects $0, does not process payments, and does not guarantee delivery, physical fit, availability, or transaction completion.

## Publication and Devpost readback

- Replacement pending: this exact locally verified master has **not** been uploaded, published, or attached to Devpost by this fix.
- The prior public video and Devpost URL remain unchanged until final review confirms this replacement candidate.
