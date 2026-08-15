import { notFound, redirect } from "next/navigation";

import { ReservationTimeline } from "@/components/reservation/reservation-timeline";
import { NotFoundError } from "@/lib/repositories/briefs";
import { ReservationRepository } from "@/lib/repositories/reservations";
import { currentPageActor, marketplaceRuntime } from "@/lib/server/marketplace-runtime";

export const dynamic = "force-dynamic";

async function loadReservation(actor: { userId: string; role: "shopper" }, reservationId: string) {
  try {
    return await new ReservationRepository(marketplaceRuntime().db).getDetail(actor, reservationId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function ReservationPage({ params }: { params: Promise<{ reservationId: string }> }) {
  const actor = await currentPageActor();
  if (!actor) redirect("/");
  if (actor.role !== "shopper") notFound();
  const detail = await loadReservation(
    { userId: actor.userId, role: "shopper" },
    (await params).reservationId,
  );
  return (
    <main className="reservation-shell">
      <header>
        <p className="eyebrow">Your selected Relay</p>
        <h1>{detail.garmentTitle}</h1>
        <p className="lede">From {detail.providerDisplayName} · {detail.providerType}</p>
      </header>
      <ReservationTimeline reservation={detail} />
      <section className="return-expectations">
        <h2>Pickup and return expectations</h2>
        <p>Coordinate the local handoff with the provider, inspect the garment together, and return it by the displayed date in the same condition.</p>
      </section>
    </main>
  );
}
