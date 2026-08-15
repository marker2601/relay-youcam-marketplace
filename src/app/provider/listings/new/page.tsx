import { notFound, redirect } from "next/navigation";

import { ListingForm, type EditableListing } from "@/components/provider/listing-form";
import { NotFoundError } from "@/lib/repositories/briefs";
import { ListingRepository } from "@/lib/repositories/listings";
import { currentPageActor, marketplaceRuntime } from "@/lib/server/marketplace-runtime";

export const dynamic = "force-dynamic";

export default async function ListingEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ listingId?: string }>;
}) {
  const actor = await currentPageActor();
  if (!actor) redirect("/");
  if (actor.role !== "provider") notFound();
  const { listingId } = await searchParams;
  let initial: EditableListing | undefined;
  if (listingId) {
    try {
      const listing = await new ListingRepository(marketplaceRuntime().db).getOwned(actor, listingId);
      initial = {
        id: listing.id,
        version: listing.version,
        title: listing.title,
        garmentCategory: listing.garmentCategory,
        sizeLabel: listing.sizeLabel,
        measurements: listing.measurements,
        condition: listing.condition,
        colorTags: listing.colorTags,
        styleTags: listing.styleTags,
        rentalPriceCents: listing.rentalPriceCents,
        depositDisplayCents: listing.depositDisplayCents,
        serviceRadiusMiles: listing.serviceRadiusMiles,
        locationBand: listing.locationBand,
        unavailableRanges: listing.unavailableRanges,
      };
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  }
  return (
    <main className="request-shell listing-editor-shell">
      <header>
        <p className="eyebrow">Provider inventory</p>
        <h1>{initial ? "Edit the garment facts" : "List a garment"}</h1>
        <p className="lede">Complete measurements make Relay’s matching explainable and useful.</p>
      </header>
      {initial ? <ListingForm initial={initial} /> : <ListingForm />}
    </main>
  );
}
