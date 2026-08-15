"use client";

import { useRef, useState, type FormEvent } from "react";

import { ImageGuidance } from "@/components/brief/image-guidance";

export type SubmitBrief = (payload: FormData) => Promise<{ briefId: string }>;
export type ReplaceBriefPhoto = (briefId: string, payload: FormData) => Promise<void>;
export type DeleteBrief = (
  briefId: string,
) => Promise<{ status: "deleted" | "deleting"; message: string }>;

export class BriefSubmissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BriefSubmissionError";
    this.code = code;
  }
}

async function defaultSubmitBrief(payload: FormData): Promise<{ briefId: string }> {
  const response = await fetch("/api/briefs", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: payload,
  });
  const body = (await response.json()) as {
    briefId?: string;
    code?: string;
    guidance?: string;
  };
  if (!response.ok || !body.briefId) {
    throw new BriefSubmissionError(
      body.code ?? "brief_creation_failed",
      body.guidance ?? "Relay could not create this brief. Please try again.",
    );
  }
  return { briefId: body.briefId };
}

async function defaultReplaceBriefPhoto(briefId: string, payload: FormData): Promise<void> {
  const response = await fetch(`/api/briefs/${briefId}`, {
    method: "PUT",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: payload,
  });
  if (!response.ok) {
    const body = (await response.json()) as { guidance?: string };
    throw new Error(body.guidance ?? "Relay could not replace this photo. Please try again.");
  }
}

async function defaultDeleteBrief(briefId: string): ReturnType<DeleteBrief> {
  const response = await fetch(`/api/briefs/${briefId}`, { method: "DELETE" });
  const body = (await response.json()) as {
    status?: "deleted" | "deleting";
    message?: string;
  };
  if (!response.ok || !body.status || !body.message) {
    throw new Error("Relay could not finish deleting these images. Please retry.");
  }
  return { status: body.status, message: body.message };
}

export function BriefDeletionControl({
  briefId,
  deleteBrief = defaultDeleteBrief,
}: {
  briefId: string;
  deleteBrief?: DeleteBrief;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function removeImages() {
    setPending(true);
    setError(null);
    try {
      const result = await deleteBrief(briefId);
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relay could not delete these images.");
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="privacy-control">
      <summary>Privacy and image deletion</summary>
      {message ? (
        <p role="status">{message}</p>
      ) : (
        <div className="privacy-control__body">
          <p>
            This removes your uploaded photo and every generated preview from Relay. Garment and reservation audit details remain without your images.
          </p>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            Delete my uploaded photo and generated previews.
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button
            className="destructive-action"
            type="button"
            disabled={!confirmed || pending}
            onClick={removeImages}
          >
            {pending ? "Deleting Relay images…" : "Delete my Relay images"}
          </button>
        </div>
      )}
    </details>
  );
}

export function BriefPhotoReplacement({
  briefId,
  replacePhoto = defaultReplaceBriefPhoto,
  onReplaced,
}: {
  briefId: string;
  replacePhoto?: ReplaceBriefPhoto | undefined;
  onReplaced: () => void | Promise<void>;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !consent) {
      setError("Choose a replacement photo and confirm consent.");
      return;
    }
    const payload = new FormData();
    payload.set("photo", photo);
    payload.set("photoConsent", "true");
    setPending(true);
    setError(null);
    try {
      await replacePhoto(briefId, payload);
      await onReplaced();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relay could not replace this photo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="photo-replacement" aria-labelledby="photo-replacement-title">
      <div>
        <p className="eyebrow">Your event details are saved</p>
        <h2 id="photo-replacement-title">Replace your photo</h2>
        <p>
          YouCam could not use the original pose or composition. Add a clear, forward-facing full-body photo; Relay will keep the rest of your brief.
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          Replacement full-body photo
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <label className="consent-row">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.currentTarget.checked)}
          />
          I consent to processing this replacement photo for virtual try-on previews.
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-action" type="submit" disabled={pending}>
          Replace photo and retry
        </button>
        {pending && <span className="sr-only" role="status">Replacing photo</span>}
      </form>
    </section>
  );
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(form: FormData, name: string): number {
  return Number(text(form, name));
}

function tags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase().replaceAll(/\s+/g, "_"))
    .filter(Boolean);
}

interface BriefFormProps {
  submitBrief?: SubmitBrief;
  onCreated?: (briefId: string) => void;
}

export function BriefForm({
  submitBrief = defaultSubmitBrief,
  onCreated,
}: BriefFormProps) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  function removePhoto() {
    setPhoto(null);
    if (photoInput.current) photoInput.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextErrors: Record<string, string> = {};
    if (!text(form, "eventDate")) nextErrors.eventDate = "Choose your event date.";
    if (!text(form, "budgetMin") || !text(form, "budgetMax")) {
      nextErrors.budget = "Add your minimum and maximum budget.";
    }
    if (!text(form, "sizeLabel")) nextErrors.sizeLabel = "Add the garment size you usually wear.";
    if (!["bust", "waist", "hips"].every((name) => numberValue(form, name) > 0)) {
      nextErrors.measurements = "Add bust, waist, and hip measurements.";
    }
    if (tags(text(form, "styleTags")).length === 0) {
      nextErrors.styleTags = "Add at least one style tag.";
    }
    if (!photo) nextErrors.photo = "Add a full-body photo.";
    if (form.get("photoConsent") !== "on") {
      nextErrors.photoConsent = "Consent is required before upload.";
    }
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0 || !photo) return;

    const command = {
      eventType: text(form, "eventType"),
      eventDate: text(form, "eventDate"),
      dressCode: text(form, "dressCode"),
      budgetMinCents: Math.round(numberValue(form, "budgetMin") * 100),
      budgetMaxCents: Math.round(numberValue(form, "budgetMax") * 100),
      garmentCategory: text(form, "garmentCategory"),
      sizeLabel: text(form, "sizeLabel"),
      measurementProfile: {
        bustTenthsCm: Math.round(numberValue(form, "bust") * 10),
        waistTenthsCm: Math.round(numberValue(form, "waist") * 10),
        hipsTenthsCm: Math.round(numberValue(form, "hips") * 10),
        desiredEaseMinTenthsCm: Math.round(numberValue(form, "easeMin") * 10),
        desiredEaseMaxTenthsCm: Math.round(numberValue(form, "easeMax") * 10),
      },
      locationBand: text(form, "locationBand"),
      radiusMiles: numberValue(form, "radiusMiles"),
      preferredColors: tags(text(form, "preferredColors")),
      styleTags: tags(text(form, "styleTags")),
      exclusions: tags(text(form, "exclusions")),
      photoConsent: true,
    };
    const payload = new FormData();
    payload.set("command", JSON.stringify(command));
    payload.set("photo", photo);

    setPending(true);
    try {
      const result = await submitBrief(payload);
      onCreated?.(result.briefId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Relay could not create this brief. Please try again.";
      setServerError(message);
      if (
        error instanceof BriefSubmissionError &&
        ["unsupported_type", "too_large", "too_small", "too_large_dimensions", "unreadable"].includes(
          error.code,
        )
      ) {
        removePhoto();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="brief-form" onSubmit={handleSubmit} noValidate>
      <section aria-labelledby="event-section-title">
        <h2 id="event-section-title">Your event</h2>
        <label>
          Event type
          <select name="eventType" defaultValue="wedding_guest">
            <option value="wedding_guest">Wedding guest</option>
            <option value="cocktail_party">Cocktail party</option>
            <option value="gala">Gala</option>
            <option value="holiday_party">Holiday party</option>
          </select>
        </label>
        <label>
          Event date
          <input name="eventDate" type="date" aria-describedby="event-date-error" />
        </label>
        {errors.eventDate && <p id="event-date-error" className="field-error">{errors.eventDate}</p>}
        <label>
          Dress code
          <select name="dressCode" defaultValue="formal">
            <option value="cocktail">Cocktail</option>
            <option value="formal">Formal</option>
            <option value="semi_formal">Semi-formal</option>
            <option value="festive">Festive</option>
          </select>
        </label>
        <div className="field-row">
          <label>
            Minimum budget (USD)
            <input name="budgetMin" type="number" min="0" step="1" />
          </label>
          <label>
            Maximum budget (USD)
            <input name="budgetMax" type="number" min="1" step="1" />
          </label>
        </div>
        {errors.budget && <p className="field-error">{errors.budget}</p>}
        <label>
          Garment category
          <select name="garmentCategory" defaultValue="full_body">
            <option value="full_body">Full body</option>
            <option value="upper_body">Upper body</option>
            <option value="lower_body">Lower body</option>
          </select>
        </label>
        <label>
          Size label
          <input name="sizeLabel" />
        </label>
        {errors.sizeLabel && <p className="field-error">{errors.sizeLabel}</p>}
        <label>
          Location
          <select name="locationBand" defaultValue="west">
            <option value="loop">Loop</option>
            <option value="west">West</option>
            <option value="north">North</option>
          </select>
        </label>
        <label>
          Search radius (miles)
          <input name="radiusMiles" type="number" min="1" max="100" defaultValue="15" />
        </label>
        <label>
          Preferred colors
          <input name="preferredColors" placeholder="emerald, navy" />
        </label>
        <label>
          Style tags
          <input name="styleTags" placeholder="minimal, polished" />
        </label>
        {errors.styleTags && <p className="field-error">{errors.styleTags}</p>}
        <label>
          Exclusions
          <input name="exclusions" placeholder="sequins, strapless" />
        </label>
      </section>

      <section aria-labelledby="measurement-section-title">
        <h2 id="measurement-section-title">Your measurements</h2>
        <div className="field-row">
          <label>
            Bust (cm)
            <input name="bust" type="number" min="1" step="0.1" />
          </label>
          <label>
            Waist (cm)
            <input name="waist" type="number" min="1" step="0.1" />
          </label>
          <label>
            Hips (cm)
            <input name="hips" type="number" min="1" step="0.1" />
          </label>
        </div>
        {errors.measurements && <p className="field-error">{errors.measurements}</p>}
        <div className="field-row">
          <label>
            Desired ease minimum (cm)
            <input name="easeMin" type="number" min="0.1" step="0.1" defaultValue="2" />
          </label>
          <label>
            Desired ease maximum (cm)
            <input name="easeMax" type="number" min="0.1" step="0.1" defaultValue="12" />
          </label>
        </div>
      </section>

      <section aria-labelledby="photo-section-title">
        <h2 id="photo-section-title">Your photo</h2>
        <ImageGuidance />
        <label>
          Full-body photo
          <input
            ref={photoInput}
            name="photo"
            type="file"
            accept="image/jpeg,image/png"
            onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)}
          />
        </label>
        {photo && (
          <div className="photo-selection" aria-live="polite">
            <span>{photo.name} selected</span>
            <button type="button" onClick={removePhoto}>Remove photo</button>
          </div>
        )}
        {errors.photo && <p className="field-error">{errors.photo}</p>}
        <label className="consent-row">
          <input name="photoConsent" type="checkbox" />
          I consent to Relay processing this photo to create virtual try-on previews.
        </label>
        {errors.photoConsent && <p className="field-error">{errors.photoConsent}</p>}
      </section>

      {serverError && <p role="alert" className="form-error">{serverError}</p>}
      <button className="primary-action" type="submit" disabled={pending}>
        Find my matches
      </button>
      {pending && <span className="sr-only" role="status">Finding matches</span>}
      <p className="form-footnote">
        You can widen the distance, budget, category, or colors later without uploading this photo again.
      </p>
    </form>
  );
}
