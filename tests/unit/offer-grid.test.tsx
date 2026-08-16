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
  assuranceRoles: Array<OfferSnapshot["offers"][number]["assuranceRole"]> = [
    "primary",
    "backup",
    "alternative",
  ],
): OfferSnapshot {
  return {
    briefId: "51000000-0000-4000-8000-000000000001",
    matchingRevision: 1,
    briefStatus,
    eventStartsAt: "2026-08-17T01:00:00.000Z",
    urgency: "tonight",
    assuranceCoverage: assuranceRoles.includes("backup")
      ? "primary_and_backup"
      : "primary_only",
    offers: offerStatuses.map((status, index) => ({
      id: `offer-${index}`,
      listingId: `listing-${index}`,
      status,
      assuranceRole: assuranceRoles[index] ?? "alternative",
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
      readiness: {
        availability: 35,
        measurements: 23 - index,
        proximity: 18 - index,
        style: 9 - index,
        confirmation: 0,
        total: 85 - index * 3,
      },
      originalImageUrl: `https://relay.test/original-${index}`,
      resultImageUrl: status === "ready" ? `https://relay.test/result-${index}` : null,
      failureGuidance: status === "failed" ? "listing_image" : null,
      expiresAt: "2026-08-16T12:00:00.000Z",
    })),
    sourcePhotoNeedsReplacement: false,
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
  it("orders and explains the primary and backup assurance plan", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
    const plan = snapshot(
      ["ready", "ready", "ready"],
      "active",
      ["alternative", "backup", "primary"],
    );
    plan.offers[0]!.provider.id = "provider-alternative";
    plan.offers[1]!.provider.id = "provider-backup";
    plan.offers[2]!.provider.id = "provider-primary";

    render(<OfferGrid snapshot={plan} onImageExpired={vi.fn()} />);

    const cards = screen.getAllByRole("article");
    expect(within(cards[0]!).getByText("Primary look")).toBeVisible();
    expect(cards[0]).toHaveAttribute("data-assurance-role", "primary");
    expect(cards[0]).toHaveAttribute("data-provider-id", "provider-primary");
    expect(within(cards[1]!).getByText("Backup look")).toBeVisible();
    expect(cards[1]).toHaveAttribute("data-assurance-role", "backup");
    expect(within(cards[2]!).getByText("Another option")).toBeVisible();
    expect(screen.getAllByText(/Event readiness/)).toHaveLength(2);
    expect(screen.getAllByRole("meter", { name: /Event readiness score/ })).toHaveLength(2);
    for (const component of [
      "Availability",
      "Measurements",
      "Proximity",
      "Style",
      "Confirmation",
    ]) {
      expect(screen.getAllByText(component)).toHaveLength(2);
    }
    expect(screen.getAllByText("Tonight")).toHaveLength(2);
    expect(screen.getAllByText(/Event starts in/)).toHaveLength(2);
    expect(
      screen.getByText(
        "Independent providers reduce the chance that one cancellation leaves you without a plan",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Request / })).toHaveLength(1);
    expect(within(cards[0]!).getByRole("button", { name: /^Request / })).toBeVisible();
    expect(within(cards[1]!).queryByRole("button", { name: /^Request / })).not.toBeInTheDocument();
  });

  it("truthfully identifies a plan without backup protection", () => {
    const primaryOnly = snapshot(["ready"], "active", ["primary"]);

    render(<OfferGrid snapshot={primaryOnly} onImageExpired={vi.fn()} />);

    expect(
      screen.getByText("Primary only—widen budget, radius, or category to add protection"),
    ).toBeVisible();
    expect(screen.queryByText("Backup look")).not.toBeInTheDocument();
  });

  it("does not claim provider independence when both looks share an owner", () => {
    const sharedProvider = snapshot(["ready", "ready"], "active", ["primary", "backup"]);
    sharedProvider.offers[1]!.provider.id = sharedProvider.offers[0]!.provider.id;

    render(<OfferGrid snapshot={sharedProvider} onImageExpired={vi.fn()} />);

    expect(
      screen.queryByText(
        "Independent providers reduce the chance that one cancellation leaves you without a plan",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Primary only.*widen budget, radius, or category to add protection/),
    ).toBeVisible();
    expect(screen.queryByText("Backup look")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Request / })).toHaveLength(1);
  });

  it("keeps the primary closed until its independent backup preview is ready", () => {
    const buildingBackup = snapshot(["ready", "generating", "ready"]);

    render(<OfferGrid snapshot={buildingBackup} onImageExpired={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^Request / })).not.toBeInTheDocument();
    expect(screen.getByText(/finishing your independent backup/i)).toBeVisible();
  });

  it("turns migrated alternative defaults into one coherent requestable plan", () => {
    const migrated = snapshot(
      ["ready", "ready", "ready"],
      "active",
      ["alternative", "alternative", "alternative"],
    );

    render(<OfferGrid snapshot={migrated} onImageExpired={vi.fn()} />);

    expect(screen.getByText("Primary look")).toBeVisible();
    expect(screen.getByText("Backup look")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Request / })).toHaveLength(1);
  });

  it("demotes stale failed roles after survivor rebalance without mutating the snapshot", () => {
    const rebalanced = snapshot(
      ["failed", "ready", "ready"],
      "active",
      ["primary", "primary", "backup"],
    );
    rebalanced.offers[0]!.provider.id = "provider-new-backup";
    rebalanced.offers[1]!.provider.id = "provider-new-primary";
    rebalanced.offers[2]!.provider.id = "provider-new-backup";

    render(<OfferGrid snapshot={rebalanced} onImageExpired={vi.fn()} />);

    const cards = screen.getAllByRole("article");
    expect(screen.getAllByText("Primary look")).toHaveLength(1);
    expect(screen.getAllByText("Backup look")).toHaveLength(1);
    expect(screen.getAllByText("Another option")).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-assurance-role", "primary");
    expect(cards[0]).toHaveAttribute("data-provider-id", "provider-new-primary");
    expect(cards[1]).toHaveAttribute("data-assurance-role", "backup");
    expect(cards[1]).toHaveAttribute("data-provider-id", "provider-new-backup");
    expect(cards[2]).toHaveAttribute("data-assurance-role", "alternative");
    expect(within(cards[2]!).getByText("Preview unavailable—garment can still be reviewed")).toBeVisible();
    expect(
      screen.getByText(
        "Independent providers reduce the chance that one cancellation leaves you without a plan",
      ),
    ).toBeVisible();
    expect(rebalanced.offers.map((offer) => offer.assuranceRole)).toEqual([
      "primary",
      "primary",
      "backup",
    ]);
  });

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

  it("keeps partial failures in score order without opening before fallback is ready", () => {
    render(<OfferGrid snapshot={snapshot(["ready", "failed", "generating"])} onImageExpired={vi.fn()} />);
    const cards = [
      document.querySelector<HTMLElement>('article[data-assurance-role="primary"]'),
      document.querySelector<HTMLElement>('article[data-offer-status="failed"]'),
      document.querySelector<HTMLElement>('article[data-offer-status="generating"]'),
    ];
    expect(cards.every(Boolean)).toBe(true);

    expect(screen.queryByRole("button", { name: /^Request / })).not.toBeInTheDocument();
    expect(within(cards[1]!).getByText("Preview unavailable—garment can still be reviewed")).toBeVisible();
    expect(within(cards[1]!).getByText(/provider needs to replace this listing image/i)).toBeVisible();
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

  it("offers photo replacement without asking for event details again", () => {
    const invalidSource = {
      ...snapshot(["failed", "failed", "failed"]),
      sourcePhotoNeedsReplacement: true,
    };
    render(
      <OfferProgress
        initialSnapshot={invalidSource}
        initialRefinement={brief}
        processOffers={vi.fn()}
        refreshOffers={vi.fn()}
        refineBrief={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: /replace your photo/i })).toBeVisible();
    expect(screen.getByLabelText("Replacement full-body photo")).toBeVisible();
    expect(screen.queryByLabelText("Event date")).not.toBeInTheDocument();
  });
});
