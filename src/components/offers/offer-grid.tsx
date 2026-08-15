"use client";

import { useState, type FormEvent } from "react";

import { OfferCard } from "@/components/offers/offer-card";
import type { OfferSnapshot } from "@/lib/repositories/offer-read";

export interface BriefRefinement {
  radiusMiles: number;
  budgetMaxCents: number;
  garmentCategory: "upper_body" | "lower_body" | "full_body";
  preferredColors: string[];
}

export type RefineBriefCommand = BriefRefinement;

function announcement(snapshot: OfferSnapshot): string {
  if (snapshot.briefStatus === "no_matches" || snapshot.offers.length === 0) {
    return "No strong matches yet. Adjust your search to try again.";
  }
  const ready = snapshot.offers.filter((offer) => offer.status === "ready").length;
  const failed = snapshot.offers.filter((offer) => offer.status === "failed").length;
  const generating = snapshot.offers.filter((offer) => offer.status === "generating").length;
  const matched = snapshot.offers.filter((offer) => offer.status === "matched").length;
  const total = snapshot.offers.length;
  if (ready === total) return `All ${total} previews are ready.`;
  if (failed === total) {
    return `All ${total} previews are unavailable. You can still review the garments.`;
  }
  if (ready > 0 && failed > 0 && ready + failed === total) {
    return `${ready} previews ready. ${failed} unavailable.`;
  }
  if (ready > 0) return `${ready} of ${total} previews ready.`;
  if (generating === total) return `Preparing ${total} previews.`;
  if (matched === total) return `${total} matches found. Preview generation starts now.`;
  return `Preparing ${total} matched garments.`;
}

interface OfferGridProps {
  snapshot: OfferSnapshot;
  refinement?: BriefRefinement;
  onRefine?: (command: RefineBriefCommand) => Promise<void>;
  onImageExpired: () => void;
}

export function OfferGrid({ snapshot, refinement, onRefine, onImageExpired }: OfferGridProps) {
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const noMatches = snapshot.briefStatus === "no_matches" || snapshot.offers.length === 0;

  async function submitRefinement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!refinement || !onRefine) return;
    const form = new FormData(event.currentTarget);
    const colors = String(form.get("preferredColors") ?? "")
      .split(",")
      .map((color) => color.trim().toLowerCase().replaceAll(/\s+/g, "_"))
      .filter(Boolean);
    setRefining(true);
    setRefineError(null);
    try {
      await onRefine({
        radiusMiles: Number(form.get("radiusMiles")),
        budgetMaxCents: Math.round(Number(form.get("budgetMax")) * 100),
        garmentCategory: String(form.get("garmentCategory")) as BriefRefinement["garmentCategory"],
        preferredColors: colors,
      });
    } catch (error) {
      setRefineError(error instanceof Error ? error.message : "Relay could not update this search.");
    } finally {
      setRefining(false);
    }
  }

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement(snapshot)}
      </p>
      {noMatches ? (
        <section className="no-match-panel" aria-labelledby="no-match-title">
          <p className="eyebrow">Keep the photo, tune the search</p>
          <h2 id="no-match-title">No strong matches yet</h2>
          <p>
            Widen the distance or budget, switch garment category, or try broader colors. Your event details and photo stay in place.
          </p>
          {refinement && onRefine && (
            <form className="refinement-form" onSubmit={submitRefinement}>
              <label>
                Search radius (miles)
                <input name="radiusMiles" type="number" min="1" max="100" defaultValue={refinement.radiusMiles} />
              </label>
              <label>
                Maximum budget (USD)
                <input name="budgetMax" type="number" min="1" defaultValue={refinement.budgetMaxCents / 100} />
              </label>
              <label>
                Garment category
                <select name="garmentCategory" defaultValue={refinement.garmentCategory}>
                  <option value="full_body">Full body</option>
                  <option value="upper_body">Upper body</option>
                  <option value="lower_body">Lower body</option>
                </select>
              </label>
              <label>
                Preferred colors
                <input name="preferredColors" defaultValue={refinement.preferredColors.join(", ")} />
              </label>
              {refineError && <p role="alert" className="form-error">{refineError}</p>}
              <button className="primary-action" type="submit" disabled={refining}>
                Search again
              </button>
              {refining && <span className="sr-only" role="status">Searching for new matches</span>}
            </form>
          )}
        </section>
      ) : (
        <div className="offer-grid">
          {snapshot.offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} onImageExpired={onImageExpired} />
          ))}
        </div>
      )}
    </>
  );
}
