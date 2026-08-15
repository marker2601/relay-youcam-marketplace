# Relay demo script (2:40 target)

Use a consented, non-sensitive test photo and a completed real YouCam result for the recorded path. Keep the video public, free of copyrighted music and third-party marks, and below three minutes.

## 0:00–0:15 — Problem and market

**Visual:** Relay home page; briefly show the two marketplace sides.

**Voiceover:** “Special-event clothes often sit unused while another shopper buys a new outfit under deadline pressure. Relay reverses that search: the shopper posts the need, circular inventory competes to fulfill it, and YouCam becomes the confidence layer before a reservation.”

## 0:15–0:40 — Shopper brief

**Visual:** Choose **Shop as a guest**. Fill the event date, dress code, budget, size and garment measurements, radius, colors, and styles. Upload the consented full-body photo and point to the consent copy.

**Voiceover:** “One structured brief captures the occasion, constraints, and preferences. Relay validates the photo locally, stores it privately, and never shows the source image to providers.”

## 0:40–1:15 — Explainable matches and real VTO

**Visual:** Submit. Show the three independent generation states resolving. Open the comparison on the top result and linger on price, measurements, provider type, score explanation, source garment, generated result, and fit disclaimer.

**Voiceover:** “Hard filters remove incompatible or unavailable inventory. A deterministic weighted rank returns at most three explainable matches. For each candidate, Relay registers both files, uploads through YouCam's signed instructions, creates a Clothes v3 task, polls with bounded retries, and copies the time-limited result into Relay's private storage. Appearance is previewed; physical fit is never promised.”

## 1:15–1:35 — Reservation request

**Visual:** Request the strongest offer. Show the `Request sent` timeline and the persistent **Reservation simulation** disclosure.

**Voiceover:** “The shopper requests one offer. The idempotent command creates a single reservation even if a button or network retries. No payment is collected.”

## 1:35–1:55 — Provider acceptance

**Visual:** Switch to **Supply your closet**, open the matching request, type `ACCEPT`, and accept it. Point out that the provider sees event/garment context but not the source photo.

**Voiceover:** “Only the listing owner can review and decide. The provider receives the qualified request without unnecessary shopper data and accepts it once.”

## 1:55–2:10 — Confirmed handoff

**Visual:** Return to the shopper timeline and refresh to show **Confirmed**, pickup, event, and return dates.

**Voiceover:** “Both sides converge on the same confirmed state and handoff window.”

## 2:10–2:30 — Business model and impact hypothesis

**Visual:** Return to a shortlist or closing slide with the two-sided loop.

**Voiceover:** “Relay's launch hypothesis is an 18% commission on completed rentals. The initial wedge is one dense metro and occasionwear: urgent, high-intent demand matched against underused peer closets and local boutiques. The measurable opportunity is better inventory utilization and new provider income—not an unverified promise of lower returns or environmental impact.”

## 2:30–2:40 — Trust, limits, close

**Visual:** Open **Privacy and image deletion**, then end on the Relay mark.

**Voiceover:** “Images stay private behind short-lived Relay URLs and can be deleted from Relay at any time. Payments, logistics, identity, and damage protection are intentionally deferred. Relay turns virtual try-on into marketplace infrastructure, not a one-call wrapper.”

## Recording checklist

- [ ] Use the production URL in an incognito browser.
- [ ] Show one real Clothes v3 result, not the fake adapter.
- [ ] Keep the YouCam key, task ID, object key, signed URLs, and developer tools out of frame.
- [ ] Show shopper, provider, confirmed timeline, privacy control, and visible disclaimer.
- [ ] Export at 1080p with readable text and no copyrighted audio.
- [ ] Upload publicly to YouTube (preferred), Vimeo, or Youku and add the URL to the release checklist.
