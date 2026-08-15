import type { ReservationDetail } from "@/lib/repositories/reservations";

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  }).format(new Date(value));
}

const statusLabels: Record<ReservationDetail["status"], string> = {
  requested: "Request sent",
  confirmed: "Confirmed",
  ready_for_pickup: "Ready for pickup",
  in_use: "With you",
  returned: "Returned",
  cancelled: "Cancelled",
};

interface ReservationTimelineProps {
  reservation: ReservationDetail;
}

export function ReservationTimeline({ reservation }: ReservationTimelineProps) {
  const steps: Array<{ status: ReservationDetail["status"]; label: string }> =
    reservation.status === "cancelled"
      ? [
          { status: "requested", label: "Request sent" },
          { status: "cancelled", label: "Cancelled" },
        ]
      : [
          { status: "requested", label: "Request sent" },
          { status: "confirmed", label: "Confirmed" },
          { status: "ready_for_pickup", label: "Ready for pickup" },
          { status: "in_use", label: "With you" },
          { status: "returned", label: "Returned" },
        ];
  const currentIndex = steps.findIndex((step) => step.status === reservation.status);

  return (
    <section className="reservation-timeline" aria-labelledby="reservation-status-title">
      <div className="reservation-status-heading">
        <p className="eyebrow">Reservation status</p>
        <h2 id="reservation-status-title">{statusLabels[reservation.status]}</h2>
        <p className="sr-only" role="status" aria-live="polite">
          Current reservation state: {statusLabels[reservation.status]}
        </p>
      </div>

      <ol className="timeline-steps">
        {steps.map((step, index) => (
          <li
            key={step.status}
            className={index <= currentIndex ? "timeline-step timeline-step--reached" : "timeline-step"}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            <span aria-hidden="true">{index < currentIndex ? "✓" : index + 1}</span>
            {step.label}
          </li>
        ))}
      </ol>

      <dl className="reservation-facts">
        <div><dt>Pickup</dt><dd>{date(reservation.pickupDate)}</dd></div>
        <div><dt>Return</dt><dd>{date(reservation.returnDate)}</dd></div>
        <div><dt>Rental</dt><dd>{money(reservation.rentalPriceCents)} rental</dd></div>
        <div><dt>Deposit</dt><dd>{money(reservation.depositDisplayCents)} displayed deposit</dd></div>
      </dl>
      <p className="simulation-disclosure">
        Reservation simulation—no payment has been collected
      </p>
    </section>
  );
}
