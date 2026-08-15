import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfferGrid } from "@/components/offers/offer-grid";
import { OfferProgress } from "@/components/offers/offer-progress";
import type { OfferSnapshot } from "@/lib/repositories/offer-read";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const statuses = ["matched", "generating", "ready"] as const;

function snapshot(
  offerStatuses: Array<OfferSnapshot["offers"][number]["status"]> = [...statuses],
  briefStatus: OfferSnapshot["briefStatus"] = "active",
): OfferSnapshot {
  return {
    briefId: "51000000-0000-4000-8000-000000000001",
    matchingRevision: 1,
    briefStatus,
    offers: offerStatuses.map((status, index) => ({
      id: `offer-${index}`,
      listingId: `listing-${index}`,
      status,
      title: ["Emerald Satin Midi", "Midnight Tailored Jumpsuit", "Burgundy Maxi"][index]!,
      garmentCategory: "full_body",
      sizeLabel: "M",
      measurements: {
        bustTenthsCm: 960,
        waistTenthsCm: 780,
        hipsTenthsCm: 1040,
        lengthTenthsCm: 1180,
      },
      condition: "excellent",
      rentalPriceCents: 7_800 + index * 500,
      depositDisplayCents: 4_000,
      provider: {
        id: `provider-${index}`,
        displayName: index === 0 ? "West Loop Wardrobe" : "Jordan Lee",
        providerType: index === 0 ? "boutique" : "peer",
      },
      distanceBand: "west Chicago",
      pickupMethod: "Local pickup",
      scoreBasisPoints: 9_500 - index * 500,
      explanations: ["Measurements align", "Within budget", "Preferred color"],
      originalImageUrl: `https://relay.test/original-${index}`,
      resultImageUrl: status === "ready" ? `https://relay.test/result-${index}` : null,
      expiresAt: "2026-08-16T12:00:00.000Z",
    })),
  } as OfferSnapshot;
}

const brief = {
  radiusMiles: 15,
  budgetMaxCents: 12_000,
  garmentCategory: "full_body" as const,
  preferredColors: ["emerald", "navy"],
};

afterEach(() => vi.useRealTimers());

describe("OfferGrid", () => {
  it.each([
    [["matched", "matched", "matched"], "3 matches found. Preview generation starts now."],
    [["generating", "generating", "generating"], "Preparing 3 previews."],
    [["ready", "generating", "generating"], "1 of 3 previews ready."],
    [["ready", "ready", "failed"], "2 previews ready. 1 unavailable."],
    [["ready", "ready", "ready"], "All 3 previews are ready."],
    [["failed", "failed", "failed"], "All 3 previews are unavailable. You can still review the garments."],
  ] as const)("announces and renders the %s state", (offerStatuses, announcement) => {
    render(<OfferGrid snapshot={snapshot([...offerStatuses])} onImageExpired={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(announcement);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByText(/not guaranteed physical fit/i)).toHaveLength(3);
  });

  it("keeps partial failures in score order and leaves ready offers actionable", () => {
    render(<OfferGrid snapshot={snapshot(["ready", "failed", "generating"])} onImageExpired={vi.fn()} />);
    const cards = screen.getAllByRole("article");

    expect(within(cards[0]!).getByRole("button", { name: /request emerald satin midi/i })).toBeVisible();
    expect(within(cards[1]!).getByText("Preview unavailable—garment can still be reviewed")).toBeVisible();
    expect(within(cards[2]!).getByText("Preparing your preview")) .toBeVisible();
  });

  it("refreshes all offer URLs when a signed result image expires", () => {
    const onImageExpired = vi.fn();
    render(<OfferGrid snapshot={snapshot(["ready"])} onImageExpired={onImageExpired} />);

    fireEvent.error(screen.getByRole("img", { name: /virtual try-on preview/i }));
    expect(onImageExpired).toHaveBeenCalledOnce();
  });

  it("renders prefilled no-match controls and submits a widened brief", async () => {
    const user = userEvent.setup();
    const onRefine = vi.fn().mockResolvedValue(undefined);
    render(
      <OfferGrid
        snapshot={snapshot([], "no_matches")}
        refinement={brief}
        onRefine={onRefine}
        onImageExpired={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "No strong matches yet" })).toBeVisible();
    expect(screen.getByLabelText("Search radius (miles)")).toHaveValue(15);
    await user.clear(screen.getByLabelText("Search radius (miles)"));
    await user.type(screen.getByLabelText("Search radius (miles)"), "30");
    await user.click(screen.getByRole("button", { name: "Search again" }));

    expect(onRefine).toHaveBeenCalledWith(expect.objectContaining({ radiusMiles: 30 }));
  });
});

describe("OfferProgress", () => {
  it("updates its live region in place as polling returns ready offers", async () => {
    vi.useFakeTimers();
    const processOffers = vi.fn().mockResolvedValue(snapshot(["ready", "ready", "ready"]));
    const { container } = render(
      <OfferProgress
        initialSnapshot={snapshot(["matched", "matched", "matched"])}
        initialRefinement={brief}
        processOffers={processOffers}
        refreshOffers={vi.fn()}
        refineBrief={vi.fn()}
        minimumPollDelayMs={2_000}
      />,
    );
    const shell = container.querySelector("[data-offer-progress]");
    expect(screen.getByRole("status")).toHaveTextContent("3 matches found");

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(processOffers).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("All 3 previews are ready.");
    expect(container.querySelector("[data-offer-progress]")).toBe(shell);
  });
});
