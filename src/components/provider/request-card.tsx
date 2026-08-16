import { DeadlineCountdown } from "@/components/assurance/deadline-countdown";
import type { EventUrgency } from "@/lib/domain/contracts";
import type { ProviderReservationRequest } from "@/lib/repositories/reservations";

const urgencyLabels: Record<EventUrgency, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  this_week: "This week",
  planned: "Planned",
};

const responseWindowLabels: Record<EventUrgency, string> = {
  tonight: "Respond within 15 minutes",
  tomorrow: "Respond within 60 minutes",
  this_week: "Respond within 4 hours",
  planned: "Respond within 4 hours",
};

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

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(value));
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
        <div><dt>Event starts</dt><dd>{dateTime(request.eventStartsAt)}</dd></div>
        <div><dt>Urgency</dt><dd>{urgencyLabels[request.urgency]}</dd></div>
        <div><dt>Dress code</dt><dd>{label(request.dressCode)}</dd></div>
        <div><dt>Requested size</dt><dd>{request.sizeLabel}</dd></div>
        <div><dt>Rental</dt><dd>{money(request.rentalPriceCents)}</dd></div>
        <div><dt>Response window</dt><dd>{responseWindowLabels[request.urgency]}</dd></div>
        <div><dt>Deadline</dt><dd>{dateTime(request.responseDueAt)}</dd></div>
      </dl>
      <p>
        <DeadlineCountdown
          target={request.responseDueAt}
          completeLabel="Response window ended"
          prefix="Respond in"
        />
      </p>
      {request.hasBackup ? <p>The shopper has a backup option</p> : null}
      <a className="secondary-action card-link" href={`/provider/requests/${request.id}`}>
        Review request
      </a>
    </article>
  );
}
