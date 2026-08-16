import { notFound, redirect } from "next/navigation";

import { ProviderDecisionPanel } from "@/components/provider/provider-decision-panel";
import { ReservationTimeline } from "@/components/reservation/reservation-timeline";
import { ReservationRepository } from "@/lib/repositories/reservations";
import { currentPageActor, marketplaceRuntime } from "@/lib/server/marketplace-runtime";

export const dynamic = "force-dynamic";

export default async function ProviderRequestPage({ params }: { params: Promise<{ offerId: string }> }) {
  const actor = await currentPageActor();
  if (!actor) redirect("/");
  if (actor.role !== "provider") notFound();
  const { offerId } = await params;
  const repository = new ReservationRepository(marketplaceRuntime().db);
  const request = (await repository.listProviderRequests(actor)).find((item) => item.id === offerId);
  if (!request) notFound();
  const detail = await repository.getDetail(actor, request.reservationId);

  return (
    <main className="reservation-shell">
      <header>
        <p className="eyebrow">Qualified request</p>
        <h1>{detail.garmentTitle}</h1>
        <p className="lede">{request.eventType.replaceAll("_", " ")} · {request.eventDate} · size {request.sizeLabel}</p>
      </header>
      <ReservationTimeline reservation={detail} />
      <ProviderDecisionPanel
        reservationId={detail.id}
        terminal={detail.status !== "requested" || detail.offerStatus !== "reservation_requested"}
        responseDueAt={detail.responseDueAt}
        urgency={detail.urgency}
        eventStartsAt={detail.eventStartsAt}
        hasBackup={request.hasBackup}
      />
    </main>
  );
}
