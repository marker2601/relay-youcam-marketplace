import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProviderDecisionPanel } from "@/components/provider/provider-decision-panel";
import { RequestCard } from "@/components/provider/request-card";
import type { ProviderReservationRequest } from "@/lib/repositories/reservations";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const request: ProviderReservationRequest = {
  id: "54000000-0000-4000-8000-000000000001",
  reservationId: "54000000-0000-4000-8000-000000000002",
  status: "reservation_requested",
  offerStatus: "reservation_requested",
  assuranceRole: "primary",
  eventType: "wedding_guest",
  eventDate: "2099-06-12",
  eventStartsAt: "2099-06-13T00:00:00.000Z",
  urgency: "tomorrow",
  responseDueAt: "2099-06-12T20:00:00.000Z",
  hasBackup: true,
  dressCode: "formal",
  sizeLabel: "M",
  listingId: "54000000-0000-4000-8000-000000000003",
  listingTitle: "Emerald Satin Midi",
  rentalPriceCents: 7_800,
  pickupDate: "2099-06-11T17:00:00.000Z",
  returnDate: "2099-06-13T17:00:00.000Z",
};

describe("ProviderDecisionPanel", () => {
  it("shows the response window and live deadline without shopper private data", () => {
    render(
      <ProviderDecisionPanel
        reservationId="reservation"
        terminal={false}
        responseDueAt="2099-06-12T20:00:00.000Z"
        urgency="tomorrow"
        eventStartsAt="2099-06-13T00:00:00.000Z"
      />,
    );

    expect(screen.getByText("Jun 12, 2099, 7:00 PM")).toBeVisible();
    expect(screen.getByText("Jun 12, 2099, 3:00 PM")).toBeVisible();
    expect(screen.getByText(/Respond within 60 minutes/)).toBeVisible();
    expect(screen.getByText(/Respond in/)).toBeVisible();
    expect(screen.queryByText(/bust|waist|hips|photo|image/i)).not.toBeInTheDocument();
  });

  it("uses only the server-projected terminal state to disable decisions", () => {
    render(
      <ProviderDecisionPanel
        reservationId="reservation"
        terminal
        responseDueAt="2099-06-12T20:00:00.000Z"
        urgency="tomorrow"
      />,
    );

    expect(screen.getByText("This request has a final decision.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Accept request" })).not.toBeInTheDocument();
  });
});

describe("RequestCard", () => {
  it("shows event urgency, timing, response deadline, and only backup availability", () => {
    render(<RequestCard request={request} />);

    expect(screen.getByText("Tomorrow")).toBeVisible();
    expect(screen.getByText("Jun 12, 2099, 7:00 PM")).toBeVisible();
    expect(screen.getByText("Jun 12, 2099, 3:00 PM")).toBeVisible();
    expect(screen.getByText(/Respond within 60 minutes/)).toBeVisible();
    expect(screen.getByText(/Respond in/)).toBeVisible();
    expect(screen.getByText("The shopper has a backup option")).toBeVisible();
    expect(screen.queryByText(/Priya|backup provider/i)).not.toBeInTheDocument();
  });
});
