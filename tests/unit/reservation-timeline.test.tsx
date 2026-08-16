import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReservationTimeline } from "@/components/reservation/reservation-timeline";
import type { ReservationDetail } from "@/lib/repositories/reservations";

function reservation(status: ReservationDetail["status"]): ReservationDetail {
  return {
    id: "53000000-0000-4000-8000-000000000001",
    offerId: "53000000-0000-4000-8000-000000000002",
    status,
    garmentTitle: "Emerald Satin Midi",
    providerDisplayName: "West Loop Wardrobe",
    providerType: "boutique",
    eventDate: "2026-09-20",
    pickupDate: "2026-09-19T17:00:00.000Z",
    returnDate: "2026-09-21T17:00:00.000Z",
    rentalPriceCents: 7_800,
    depositDisplayCents: 4_000,
    responseDueAt: "2026-08-15T16:00:00.000Z",
    backupOfferId: "53000000-0000-4000-8000-000000000003",
    supersedesReservationId: null,
    simulation: true,
  };
}

describe("ReservationTimeline", () => {
  it.each([
    ["requested", "Request sent"],
    ["confirmed", "Confirmed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders one announced current state for %s", (status, label) => {
    render(<ReservationTimeline reservation={reservation(status)} />);

    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("shows dates, prices, deposit, and the no-payment simulation disclosure", () => {
    render(<ReservationTimeline reservation={reservation("confirmed")} />);

    expect(screen.getByText("Sep 19, 2026")).toBeVisible();
    expect(screen.getByText("Sep 21, 2026")).toBeVisible();
    expect(screen.getByText("$78 rental")).toBeVisible();
    expect(screen.getByText("$40 displayed deposit")).toBeVisible();
    expect(screen.getByText("Reservation simulation—no payment has been collected")).toBeVisible();
  });
});
