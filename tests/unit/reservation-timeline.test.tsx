import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationTimeline } from "@/components/reservation/reservation-timeline";
import type { ReservationDetail } from "@/lib/repositories/reservations";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function reservation(status: ReservationDetail["status"]): ReservationDetail {
  return {
    id: "53000000-0000-4000-8000-000000000001",
    offerId: "53000000-0000-4000-8000-000000000002",
    offerStatus:
      status === "requested"
        ? "reservation_requested"
        : status === "confirmed"
          ? "accepted"
          : "declined",
    assuranceRole: "primary",
    status,
    garmentTitle: "Emerald Satin Midi",
    providerDisplayName: "West Loop Wardrobe",
    providerType: "boutique",
    eventDate: "2026-09-20",
    eventStartsAt: "2026-09-21T00:00:00.000Z",
    urgency: "planned",
    pickupDate: "2026-09-19T17:00:00.000Z",
    returnDate: "2026-09-21T17:00:00.000Z",
    rentalPriceCents: 7_800,
    depositDisplayCents: 4_000,
    responseDueAt: "2026-08-15T16:00:00.000Z",
    backupOfferId: "53000000-0000-4000-8000-000000000003",
    backup: {
      offerId: "53000000-0000-4000-8000-000000000003",
      title: "Burgundy Wrap Dress",
      providerDisplayName: "Priya's Closet",
    },
    canActivateBackup: status === "cancelled",
    supersedesReservationId: null,
    simulation: true,
  };
}

describe("ReservationTimeline", () => {
  it.each([
    ["requested", "Awaiting owner confirmation"],
    ["confirmed", "Event ready"],
    ["cancelled", "Backup available"],
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

  it("offers one-tap recovery after a declined primary and blocks a double click", async () => {
    const activate = vi.fn().mockResolvedValue({ id: "backup-reservation" });
    const cancelledPrimaryWithBackup = reservation("cancelled");
    const user = userEvent.setup();

    render(
      <ReservationTimeline
        reservation={cancelledPrimaryWithBackup}
        activateBackup={activate}
      />,
    );
    await user.dblClick(screen.getByRole("button", { name: "Activate backup look" }));

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(cancelledPrimaryWithBackup.id);
    expect(push).toHaveBeenCalledWith("/reservations/backup-reservation");
  });

  it("posts the default backup command with a fresh idempotency key and follows its reservation", async () => {
    const response = new Response(JSON.stringify({ id: "default-backup-reservation" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("55000000-0000-4000-8000-000000000001");
    const user = userEvent.setup();
    const cancelledPrimaryWithBackup = reservation("cancelled");

    render(<ReservationTimeline reservation={cancelledPrimaryWithBackup} />);
    await user.click(screen.getByRole("button", { name: "Activate backup look" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/reservations/${cancelledPrimaryWithBackup.id}/backup`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "55000000-0000-4000-8000-000000000001" },
      },
    );
    expect(push).toHaveBeenCalledWith("/reservations/default-backup-reservation");
  });

  it("guides a cancelled request without an eligible backup toward a wider plan", () => {
    render(
      <ReservationTimeline
        reservation={{ ...reservation("cancelled"), backup: null, canActivateBackup: false }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Plan interrupted" })).toBeVisible();
    expect(screen.getByText(/widen/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Activate backup look" })).not.toBeInTheDocument();
  });

  it("labels a superseding reservation as a backup request", () => {
    render(
      <ReservationTimeline
        reservation={{
          ...reservation("requested"),
          assuranceRole: "backup",
          backup: null,
          canActivateBackup: false,
          supersedesReservationId: "53000000-0000-4000-8000-000000000009",
        }}
      />,
    );

    expect(screen.getByText("Backup request")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Awaiting owner confirmation" })).toBeVisible();
  });
});
