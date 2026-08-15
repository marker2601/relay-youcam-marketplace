import type { ProviderReservationRequest } from "@/lib/repositories/reservations";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function RequestCard({ request }: { request: ProviderReservationRequest }) {
  return (
    <article className="provider-request-card">
      <div>
        <p className="eyebrow">{label(request.status)}</p>
        <h3>{request.listingTitle}</h3>
      </div>
      <dl>
        <div><dt>Event</dt><dd>{label(request.eventType)}</dd></div>
        <div><dt>Date</dt><dd>{request.eventDate}</dd></div>
        <div><dt>Dress code</dt><dd>{label(request.dressCode)}</dd></div>
        <div><dt>Requested size</dt><dd>{request.sizeLabel}</dd></div>
        <div><dt>Rental</dt><dd>{money(request.rentalPriceCents)}</dd></div>
      </dl>
      <a className="secondary-action card-link" href={`/provider/requests/${request.id}`}>
        Review request
      </a>
    </article>
  );
}
