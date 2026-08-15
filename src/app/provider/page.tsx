import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { RequestCard } from "@/components/provider/request-card";
import { users } from "@/lib/db/schema";
import { ListingRepository } from "@/lib/repositories/listings";
import { ReservationRepository } from "@/lib/repositories/reservations";
import { currentPageActor, marketplaceRuntime } from "@/lib/server/marketplace-runtime";

export const dynamic = "force-dynamic";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default async function ProviderPage() {
  const actor = await currentPageActor();
  if (!actor) redirect("/");
  if (actor.role !== "provider") notFound();
  const { db } = marketplaceRuntime();
  const [profile] = await db.select({ displayName: users.displayName, providerType: users.providerType }).from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!profile?.providerType) notFound();
  const [ownedListings, requests] = await Promise.all([
    new ListingRepository(db).listOwned(actor),
    new ReservationRepository(db).listProviderRequests(actor),
  ]);

  return (
    <main className="provider-shell">
      <header className="provider-hero">
        <div>
          <p className="eyebrow">{profile.providerType} provider workspace</p>
          <h1>{profile.displayName}</h1>
        </div>
        <a className="primary-action provider-primary-link" href="/provider/listings/new">Add a garment</a>
      </header>

      <section className="provider-section" aria-labelledby="requests-heading">
        <div className="section-heading">
          <h2 id="requests-heading">Qualified requests</h2>
          <span>{requests.length}</span>
        </div>
        <p className="privacy-note">Relay shares event needs and logistics—not shopper photos, body measurements, or exact addresses.</p>
        {requests.length > 0 ? (
          <div className="provider-request-grid">{requests.map((request) => <RequestCard key={request.id} request={request} />)}</div>
        ) : <p className="empty-note">No requests need a response right now.</p>}
      </section>

      <section className="provider-section" aria-labelledby="inventory-heading">
        <div className="section-heading">
          <h2 id="inventory-heading">Active inventory</h2>
          <span>{ownedListings.length}</span>
        </div>
        <div className="inventory-list">
          {ownedListings.map((listing) => (
            <article key={listing.id} className="inventory-row">
              <div><h3>{listing.title}</h3><p>{listing.sizeLabel} · {listing.condition} · version {listing.version}</p></div>
              <strong>{money(listing.rentalPriceCents)}</strong>
              <a href={`/provider/listings/new?listingId=${listing.id}`}>Edit listing</a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
