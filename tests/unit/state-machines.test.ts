import { describe, expect, it } from "vitest";

import type { OfferStatus, ReservationStatus } from "@/lib/domain/contracts";
import {
  InvalidTransitionError,
  transitionOffer,
  transitionReservation,
} from "@/lib/domain/state-machines";

const offerStatuses: OfferStatus[] = [
  "matched",
  "generating",
  "ready",
  "failed",
  "reservation_requested",
  "accepted",
  "declined",
  "expired",
];

const allowedOfferTransitions = new Set([
  "matched->generating",
  "matched->expired",
  "generating->ready",
  "generating->failed",
  "generating->expired",
  "ready->reservation_requested",
  "ready->expired",
  "reservation_requested->accepted",
  "reservation_requested->declined",
  "reservation_requested->expired",
]);

const reservationStatuses: ReservationStatus[] = [
  "requested",
  "confirmed",
  "ready_for_pickup",
  "in_use",
  "returned",
  "cancelled",
];

const allowedReservationTransitions = new Set([
  "requested->confirmed",
  "requested->cancelled",
  "confirmed->ready_for_pickup",
  "confirmed->cancelled",
  "ready_for_pickup->in_use",
  "ready_for_pickup->cancelled",
  "in_use->returned",
]);

describe("transitionOffer", () => {
  it("accepts every defined offer transition and rejects every other pair", () => {
    for (const current of offerStatuses) {
      for (const next of offerStatuses) {
        const key = `${current}->${next}`;
        if (allowedOfferTransitions.has(key)) {
          expect(transitionOffer(current, next)).toBe(next);
        } else {
          expect(() => transitionOffer(current, next)).toThrow(InvalidTransitionError);
        }
      }
    }
  });

  it.each(["accepted", "declined", "expired", "failed"] satisfies OfferStatus[])(
    "keeps terminal offer state %s closed",
    (current) => {
      for (const next of offerStatuses) {
        expect(() => transitionOffer(current, next)).toThrow(InvalidTransitionError);
      }
    },
  );

  it("reports only domain and state names in a typed error", () => {
    let captured: unknown;
    try {
      transitionOffer("matched", "accepted");
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidTransitionError);
    expect(captured).toMatchObject({
      domain: "offer",
      current: "matched",
      next: "accepted",
    });
    expect(JSON.stringify(captured)).not.toContain("entity");
  });
});

describe("transitionReservation", () => {
  it("accepts the modeled handoff and pre-use cancellation transitions only", () => {
    for (const current of reservationStatuses) {
      for (const next of reservationStatuses) {
        const key = `${current}->${next}`;
        if (allowedReservationTransitions.has(key)) {
          expect(transitionReservation(current, next)).toBe(next);
        } else {
          expect(() => transitionReservation(current, next)).toThrow(InvalidTransitionError);
        }
      }
    }
  });

  it.each(["returned", "cancelled"] satisfies ReservationStatus[])(
    "keeps terminal reservation state %s closed",
    (current) => {
      for (const next of reservationStatuses) {
        expect(() => transitionReservation(current, next)).toThrow(InvalidTransitionError);
      }
    },
  );
});
