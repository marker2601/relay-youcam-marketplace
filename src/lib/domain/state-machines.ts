import type { OfferStatus, ReservationStatus } from "@/lib/domain/contracts";

type TransitionDomain = "offer" | "reservation";

export class InvalidTransitionError extends Error {
  readonly domain: TransitionDomain;
  readonly current: OfferStatus | ReservationStatus;
  readonly next: OfferStatus | ReservationStatus;

  constructor(
    domain: TransitionDomain,
    current: OfferStatus | ReservationStatus,
    next: OfferStatus | ReservationStatus,
  ) {
    super(`Invalid ${domain} transition: ${current} -> ${next}`);
    this.name = "InvalidTransitionError";
    this.domain = domain;
    this.current = current;
    this.next = next;
  }
}

const offerTransitions: Record<OfferStatus, readonly OfferStatus[]> = {
  matched: ["generating", "expired"],
  generating: ["ready", "failed", "expired"],
  ready: ["reservation_requested", "expired"],
  reservation_requested: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
  failed: [],
};

const reservationTransitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["in_use", "cancelled"],
  in_use: ["returned"],
  returned: [],
  cancelled: [],
};

export function transitionOffer(current: OfferStatus, next: OfferStatus): OfferStatus {
  if (!offerTransitions[current].includes(next)) {
    throw new InvalidTransitionError("offer", current, next);
  }

  return next;
}

export function transitionReservation(
  current: ReservationStatus,
  next: ReservationStatus,
): ReservationStatus {
  if (!reservationTransitions[current].includes(next)) {
    throw new InvalidTransitionError("reservation", current, next);
  }

  return next;
}
