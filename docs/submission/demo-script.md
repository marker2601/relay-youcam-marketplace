# Relay professional demo script (published master: 2:41.600 / YouTube display: 2:42)

Capture the verified production flow at 1080p using the existing synthetic, consent-safe shopper image and project-owned garment assets. Show real YouCam Clothes v3 results. Keep credentials, task IDs, object keys, signed URLs, developer tools, copyrighted music, and unrelated marks out of frame.

## Chapter 1 — The problem and promise

**Visual:** Open the production homepage, hold on the exact promise, and move deliberately toward **Shop as a guest**.

**Voiceover:** “Relay is the reliability layer for time-sensitive fashion. Discovery apps show possibilities. Relay makes sure you have something to wear, even when the first plan fails.”

## Chapter 2 — One urgent brief

**Visual:** Create a brief with **Event time (Chicago)**, budget, measurements, preferences, photo consent, and the project-owned source image.

**Voiceover:** “A shopper starts with one urgent brief: event time, budget, measurements, style, location, and explicit photo consent. Relay keeps that source image private. Providers never receive the shopper's photo or measurement profile.”

## Chapter 3 — Primary and independent backup

**Visual:** Show the resolved primary and backup together. Point to different provider names, real YouCam results, readiness totals, role labels, and fit disclaimer.

**Voiceover:** “Relay hard-filters local inventory and ranks no more than three explainable matches. The best becomes Primary. The strongest eligible look from a different provider becomes Backup. These are real YouCam Clothes version three previews, not catalog mockups. Availability, measurement evidence, proximity, style, and provider confirmation form an Event Readiness Score. It explains the plan; it does not promise fit.”

## Chapter 4 — The first plan fails

**Visual:** Request the primary, show its response deadline, switch to that provider, show the privacy boundary, type `DECLINE`, and decline.

**Voiceover:** “The shopper requests the primary. Relay preserves the backup and sets a response deadline from the event's urgency. The primary boutique can review the qualified request, but not the shopper's private media or measurements. Here, the boutique declines. A normal marketplace sends the shopper back to search. Relay does not.”

## Chapter 5 — One-action recovery

**Visual:** Return to the original timeline, show **Backup available**, and choose **Activate backup look**.

**Voiceover:** “The original timeline now says Backup available. The navy look is already rendered and belongs to an independent provider. One authorized, idempotent action activates it with no new search, upload, or YouCam generation.”

## Chapter 6 — Event ready

**Visual:** Switch to the backup provider, accept, return to the shopper timeline, and hold on **Event ready** plus the no-payment disclosure.

**Voiceover:** “The backup provider reviews the new request and accepts. The shopper's timeline advances to Event ready. In this prototype, that means provider-confirmed reservation intent. No payment has been collected, and delivery and physical fit are not guaranteed.”

## Chapter 7 — YouCam and reliability architecture

**Visual:** Keep the real shortlist visible while a restrained callout explains signed upload, task creation, bounded polling, private copying, isolated failures, and transactional recovery.

**Voiceover:** “Under the hood, Relay registers shopper and garment files, follows YouCam's signed upload instructions, creates each Clothes version three task, polls with bounded retries, and copies successful results into private storage. One preview can fail without blocking the rest. Server-side transactions, deadlines, and idempotency make the recovery path dependable.”

## Chapter 8 — Business close

**Visual:** End on **Event ready**, then Relay's exact promise and a single call to action: **Try the recovery journey**.

**Voiceover:** “Relay's business hypothesis is an eighteen percent commission on completed rentals. It starts with peer closets and boutiques, then can expand to stylist networks and underused local inventory. Visual confidence is useful. Visual confidence with a ready backup is a business. Relay: primary fails, backup is ready.”

## Recording checklist

- [ ] Use https://relay-youcam-marketplace.vercel.app.
- [ ] Show real cursor movement and the user action causing every critical state change.
- [ ] Use the project-owned shopper and garment assets.
- [ ] Show real YouCam Clothes v3 results and explain the integration.
- [ ] Show distinct providers, response deadline, decline, backup activation, acceptance, and **Event ready**.
- [ ] Keep source media out of the provider view and show the no-payment/non-fit boundaries.
- [ ] Keep product footage visible for at least 80% of runtime.
- [ ] Export H.264/AAC 1080p at 30 fps, under three minutes, with authored captions and no music.
- [ ] Verify the master mechanically, then upload publicly and read the URL back from Devpost.

## Published v2 record

- Public video: https://youtu.be/0hUbCwDbn4I
- Exact master: `docs/submission/assets/relay-professional-demo-v2.mp4` (161.600000 seconds; SHA-256 `BA1F60AE0C0B9CF13E5A228EDDB9E86560665773CAF5909E665E00064C857ABB`)
- The published flow adds the approved Human Handoff overlay while retaining real production-product footage and burned-in captions.
