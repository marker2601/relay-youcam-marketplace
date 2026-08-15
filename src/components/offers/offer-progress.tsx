"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BriefDeletionControl,
  BriefPhotoReplacement,
  type ReplaceBriefPhoto,
} from "@/components/brief/brief-form";
import {
  OfferGrid,
  type BriefRefinement,
  type RefineBriefCommand,
} from "@/components/offers/offer-grid";
import type { OfferSnapshot } from "@/lib/repositories/offer-read";

type SnapshotCommand = (briefId: string) => Promise<OfferSnapshot>;
type RefineCommand = (briefId: string, command: RefineBriefCommand) => Promise<OfferSnapshot>;

async function parseSnapshot(response: Response): Promise<OfferSnapshot> {
  if (!response.ok) throw new Error("Relay could not refresh these offers.");
  return response.json() as Promise<OfferSnapshot>;
}

async function defaultRefreshOffers(briefId: string): Promise<OfferSnapshot> {
  return parseSnapshot(await fetch(`/api/briefs/${briefId}/offers`, { cache: "no-store" }));
}

async function defaultProcessOffers(briefId: string): Promise<OfferSnapshot> {
  const response = await fetch(`/api/briefs/${briefId}/process`, { method: "POST" });
  if (!response.ok && response.status !== 429) {
    throw new Error("Relay could not advance preview generation.");
  }
  return defaultRefreshOffers(briefId);
}

async function defaultRefineBrief(
  briefId: string,
  command: RefineBriefCommand,
): Promise<OfferSnapshot> {
  const response = await fetch(`/api/briefs/${briefId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error("Relay could not update this search.");
  return defaultRefreshOffers(briefId);
}

function isActionable(snapshot: OfferSnapshot): boolean {
  if (snapshot.briefStatus === "matching") return true;
  return snapshot.offers.some((offer) => offer.status === "matched" || offer.status === "generating");
}

interface OfferProgressProps {
  initialSnapshot: OfferSnapshot;
  initialRefinement: BriefRefinement;
  processOffers?: SnapshotCommand;
  refreshOffers?: SnapshotCommand;
  refineBrief?: RefineCommand;
  minimumPollDelayMs?: number;
  pollingDeadlineMs?: number;
  replacePhoto?: ReplaceBriefPhoto;
}

export function OfferProgress({
  initialSnapshot,
  initialRefinement,
  processOffers = defaultProcessOffers,
  refreshOffers = defaultRefreshOffers,
  refineBrief = defaultRefineBrief,
  minimumPollDelayMs = 2_000,
  pollingDeadlineMs = 6 * 60_000,
  replacePhoto,
}: OfferProgressProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refinement, setRefinement] = useState(initialRefinement);
  const [pollDelay, setPollDelay] = useState(minimumPollDelayMs);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!isActionable(snapshot) || deadlineReached) return;
    startedAt.current ??= Date.now();
    const timer = window.setTimeout(async () => {
      if (Date.now() - startedAt.current! >= pollingDeadlineMs) {
        setDeadlineReached(true);
        return;
      }
      try {
        const next = await processOffers(snapshot.briefId);
        setSnapshot(next);
        setGenerationError(null);
        setPollDelay((current) => Math.min(Math.max(minimumPollDelayMs, current * 2), 15_000));
      } catch {
        setGenerationError("Preview generation paused. Relay will retry safely.");
        setPollDelay((current) => Math.min(Math.max(minimumPollDelayMs, current * 2), 15_000));
      }
    }, Math.max(minimumPollDelayMs, pollDelay));
    return () => window.clearTimeout(timer);
  }, [deadlineReached, minimumPollDelayMs, pollDelay, pollingDeadlineMs, processOffers, snapshot]);

  const refreshSignedUrls = useCallback(async () => {
    try {
      setSnapshot(await refreshOffers(snapshot.briefId));
    } catch {
      setGenerationError("This image link expired. Refresh the offers to try again.");
    }
  }, [refreshOffers, snapshot.briefId]);

  async function handleRefine(command: RefineBriefCommand) {
    const next = await refineBrief(snapshot.briefId, command);
    setRefinement(command);
    setSnapshot(next);
    setPollDelay(minimumPollDelayMs);
    setDeadlineReached(false);
    startedAt.current = Date.now();
  }

  function retry() {
    setGenerationError(null);
    setDeadlineReached(false);
    setPollDelay(minimumPollDelayMs);
    startedAt.current = Date.now();
    void refreshSignedUrls();
  }

  async function handlePhotoReplaced() {
    setSnapshot(await refreshOffers(snapshot.briefId));
    setGenerationError(null);
    setDeadlineReached(false);
    setPollDelay(minimumPollDelayMs);
    startedAt.current = Date.now();
  }

  return (
    <section className="offer-progress" data-offer-progress>
      <div className="offer-progress__intro">
        <div>
          <p className="eyebrow">Ranked for your event</p>
          <h1>Your Relay shortlist</h1>
        </div>
        <p>
          Compare the garment facts with the generated styling preview. Ready offers remain usable even if another preview cannot be made.
        </p>
      </div>
      {(generationError || deadlineReached) && (
        <div className="generation-notice" role="alert">
          <p>
            {deadlineReached
              ? "Automatic preview updates stopped after six minutes. Your current offers are preserved."
              : generationError}
          </p>
          <button type="button" onClick={retry}>Retry updates</button>
        </div>
      )}
      {snapshot.sourcePhotoNeedsReplacement && (
        <BriefPhotoReplacement
          briefId={snapshot.briefId}
          replacePhoto={replacePhoto}
          onReplaced={handlePhotoReplaced}
        />
      )}
      <OfferGrid
        snapshot={snapshot}
        refinement={refinement}
        onRefine={handleRefine}
        onImageExpired={refreshSignedUrls}
      />
      <BriefDeletionControl briefId={snapshot.briefId} />
    </section>
  );
}
