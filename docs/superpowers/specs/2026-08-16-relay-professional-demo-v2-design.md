# Relay professional demo v2 design

Date: August 16, 2026
Status: Approved visual and voice direction

## Objective

Replace the current Relay submission video with a polished 1–3 minute explainer that retains real production-product proof while making the two-sided marketplace and recovery mechanism emotionally clear. The revision must address two specific shortcomings in the current release: the narration voice is unpleasant to the user, and the visual treatment does not connect the shopper, primary provider, backup provider, and system flow strongly enough.

## Approved direction

The video uses the **Human Handoff** visual direction selected by the user. Friendly illustrated shopper, primary-provider, and backup-provider characters appear as transparent motion graphics over real Relay footage. They clarify the marketplace roles and transaction handoff; they never replace, obscure, or imply functionality beyond the recorded application.

Narration uses a friendly, upbeat female neural voice. Delivery should feel warm, conversational, and optimistic, with restrained energy rather than a commercial or synthetic cadence. The script remains truthful and keeps the existing disclosures about no payment and no guarantee of fit, delivery, availability, or transaction completion.

## Story and motion beats

1. **Promise:** the shopper character enters with one urgent event brief while the exact Relay promise remains readable.
2. **Visual confidence:** a compact technical overlay shows `Signed upload → Clothes v3 → Private result` while the real YouCam journey remains visible.
3. **Resilient plan:** the brief travels from the shopper to the primary and backup characters. Stable labels identify the independent providers.
4. **Primary failure:** the primary character reacts, a concise red `Primary declines` state appears, and the primary connection de-emphasizes.
5. **Recovery:** a green connection reroutes to the backup. The preserved-preview and no-new-search benefit is stated visually and in narration.
6. **Outcome:** backup acceptance resolves into `Event ready` with restrained celebratory motion and a final Relay call to action.

Animations play once in synchronization with the narration. The visual-companion loop demonstrated the language only; the final edit must not loop overlays.

## Composition architecture

The exact production capture remains the evidence layer. A separate transparent motion-graphics layer supplies vector characters, animated paths, state chips, architectural callouts, and the Event ready payoff. A dedicated caption layer remains independent so captions can be timed and positioned without colliding with graphics.

The compositor combines four inputs:

1. existing production capture and scene timing manifest;
2. approved narration script rendered with the selected female neural voice;
3. timed vector/motion overlays generated reproducibly from project-owned code and assets;
4. burned-in captions derived from the final narration timing.

The final master remains 1920×1080, 30 fps, H.264 `yuv420p`, AAC stereo at 48 kHz, with a fast-start MP4 atom order.

## Visual rules

- Product footage remains visible throughout substantive claims.
- Characters use a friendly flat-vector style with distinct colors: shopper gold, primary coral, backup green.
- Overlay panels use Relay's dark green and cream palette, high contrast, rounded geometry, and limited shadows.
- Important application controls, garment previews, provider decisions, and Event ready status must remain unobstructed.
- Motion is purposeful: 300–700 ms entrances, path draws, state transitions, and small reaction movements. No constant decorative movement.
- Celebration is brief and restrained; no confetti or animation may obscure the Event ready proof.
- Technical claims appear only while the corresponding real system flow is visible.

## Audio rules

- Use a friendly, upbeat female neural voice with natural sentence-level prosody.
- Target approximately 135–150 spoken words per minute.
- Avoid sharp sibilance, excessive brightness, aggressive compression, or sales-pitch emphasis.
- Target about -16 LUFS integrated loudness and a true peak no higher than -1.5 dBFS.
- Do not add music unless it remains clearly subordinate to speech and survives the intelligibility gate; silence behind narration is acceptable.
- Generate a short voice sample before the full render and audibly review it through the user-visible preview.

## Failure handling

- Keep the currently public video and current Devpost link unchanged until the replacement master passes all gates.
- If neural TTS generation fails or sounds unnatural, try a second friendly female neural voice before using any desktop fallback.
- If an overlay collides with product evidence, move or suppress that overlay for the affected shot rather than cropping the application.
- If timing changes after narration generation, regenerate caption and overlay timing from the final audio; do not stretch speech unnaturally.
- Never submit the Devpost entry while video replacement is in progress.

## Verification gates

- User-visible audio preview confirms the new voice direction is acceptable.
- Every story beat is visible in a frame/contact-sheet review, including shopper, primary, backup, decline, reroute, and Event ready.
- Captions remain readable and do not collide with overlays or application evidence.
- Exact-master verification checks duration, dimensions, codecs, pixel format, frame rate, audio channels/sample rate, atom order, full-frame decode, and SHA-256.
- Audio analysis checks integrated loudness, true peak, and long silence intervals.
- Local ASR preserves all binding claims and disclosures.
- Five random-seek frames match sequential decoding; black-frame detection reports no unintended gaps.
- The repository still passes typecheck, lint, unit/contract tests, and production build.
- Publish the replacement publicly, verify the public URL independently, update Devpost, and read back the exact URL while `submitted_at` remains null.

## Publication boundary

The previous public video remains available until the new public page and Devpost readback are both confirmed. The GitHub update must include the reproducible narration, motion-graphics, composition, and evidence artifacts required to recreate or audit the release. Final Devpost submission remains a separate irreversible action and requires the user's exact confirmation after the replacement video is attached.
