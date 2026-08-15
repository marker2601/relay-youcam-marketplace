"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { CreateListingInput } from "@/lib/repositories/listings";

export interface EditableListing extends Omit<CreateListingInput, "garmentMediaId"> {
  id: string;
  version: number;
}

function tags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase().replaceAll(/\s+/g, "_"))
    .filter(Boolean);
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function number(form: FormData, name: string): number {
  return Number(value(form, name));
}

export function ListingForm({ initial }: { initial?: EditableListing }) {
  const router = useRouter();
  const [photo, setPhoto] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const unavailableStart = value(form, "unavailableStart");
    const unavailableEnd = value(form, "unavailableEnd");
    const command = {
      title: value(form, "title"),
      garmentCategory: value(form, "garmentCategory"),
      sizeLabel: value(form, "sizeLabel"),
      measurements: {
        bustTenthsCm: Math.round(number(form, "bust") * 10),
        waistTenthsCm: Math.round(number(form, "waist") * 10),
        hipsTenthsCm: Math.round(number(form, "hips") * 10),
        lengthTenthsCm: Math.round(number(form, "length") * 10),
      },
      condition: value(form, "condition"),
      colorTags: tags(form.get("colorTags")),
      styleTags: tags(form.get("styleTags")),
      rentalPriceCents: Math.round(number(form, "rentalPrice") * 100),
      depositDisplayCents: Math.round(number(form, "deposit") * 100),
      serviceRadiusMiles: number(form, "serviceRadiusMiles"),
      locationBand: value(form, "locationBand"),
      unavailableRanges: unavailableStart && unavailableEnd
        ? [{ startDate: unavailableStart, endDate: unavailableEnd }]
        : [],
    };

    if (!initial && !photo) {
      setError("Add a garment photo.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (!initial) {
        const payload = new FormData();
        payload.set("command", JSON.stringify(command));
        payload.set("photo", photo!);
        const response = await fetch("/api/listings", { method: "POST", body: payload });
        if (!response.ok) throw new Error("Relay could not create this listing.");
      } else {
        const metadataResponse = await fetch(`/api/listings/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...command, expectedVersion: initial.version }),
        });
        if (!metadataResponse.ok) throw new Error("Relay could not update this listing.");
        const metadata = await metadataResponse.json() as { version: number };
        if (photo) {
          const payload = new FormData();
          payload.set("command", JSON.stringify({ expectedVersion: metadata.version }));
          payload.set("photo", photo);
          const imageResponse = await fetch(`/api/listings/${initial.id}`, { method: "PUT", body: payload });
          if (!imageResponse.ok) throw new Error("The details saved, but the replacement image did not.");
        }
      }
      router.push("/provider");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relay could not save this listing.");
      setPending(false);
    }
  }

  const measurements = initial?.measurements;
  const range = initial?.unavailableRanges[0];
  return (
    <form className="listing-form" onSubmit={submit}>
      <label>Title<input name="title" defaultValue={initial?.title} required minLength={3} /></label>
      <div className="field-row">
        <label>Garment category
          <select name="garmentCategory" defaultValue={initial?.garmentCategory ?? "full_body"}>
            <option value="full_body">Full body</option>
            <option value="upper_body">Upper body</option>
            <option value="lower_body">Lower body</option>
          </select>
        </label>
        <label>Size label<input name="sizeLabel" defaultValue={initial?.sizeLabel} required /></label>
        <label>Condition
          <select name="condition" defaultValue={initial?.condition ?? "excellent"}>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Garment measurements</legend>
        <div className="field-row">
          <label>Bust (cm)<input name="bust" type="number" step="0.1" min="1" defaultValue={measurements ? measurements.bustTenthsCm / 10 : undefined} required /></label>
          <label>Waist (cm)<input name="waist" type="number" step="0.1" min="1" defaultValue={measurements ? measurements.waistTenthsCm / 10 : undefined} required /></label>
          <label>Hips (cm)<input name="hips" type="number" step="0.1" min="1" defaultValue={measurements ? measurements.hipsTenthsCm / 10 : undefined} required /></label>
          <label>Length (cm)<input name="length" type="number" step="0.1" min="1" defaultValue={measurements ? measurements.lengthTenthsCm / 10 : undefined} required /></label>
        </div>
      </fieldset>
      <div className="field-row">
        <label>Color tags<input name="colorTags" defaultValue={initial?.colorTags.join(", ")} placeholder="emerald, jewel tone" required /></label>
        <label>Style tags<input name="styleTags" defaultValue={initial?.styleTags.join(", ")} placeholder="formal, minimal" required /></label>
      </div>
      <div className="field-row">
        <label>Rental price (USD)<input name="rentalPrice" type="number" min="1" defaultValue={initial ? initial.rentalPriceCents / 100 : undefined} required /></label>
        <label>Displayed deposit (USD)<input name="deposit" type="number" min="0" defaultValue={initial ? initial.depositDisplayCents / 100 : undefined} required /></label>
        <label>Service radius (miles)<input name="serviceRadiusMiles" type="number" min="1" max="100" defaultValue={initial?.serviceRadiusMiles ?? 20} required /></label>
        <label>Location
          <select name="locationBand" defaultValue={initial?.locationBand ?? "west"}>
            <option value="loop">Loop</option><option value="west">West</option><option value="north">North</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Optional unavailable range</legend>
        <div className="field-row">
          <label>Unavailable from<input name="unavailableStart" type="date" defaultValue={range?.startDate} /></label>
          <label>Unavailable through<input name="unavailableEnd" type="date" defaultValue={range?.endDate} /></label>
        </div>
      </fieldset>
      <label>Garment photo {initial && <span>(leave empty to keep current image)</span>}
        <input type="file" accept="image/jpeg,image/png" onChange={(event) => setPhoto(event.currentTarget.files?.[0] ?? null)} />
      </label>
      <p className="form-footnote">JPEG or PNG, under 10 MB, at least 512×384. Photograph one garment clearly with no person in frame.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-action" type="submit" disabled={pending}>
        {initial ? "Save listing" : "Publish listing"}
      </button>
      {pending && <span className="sr-only" role="status">Saving listing</span>}
    </form>
  );
}
