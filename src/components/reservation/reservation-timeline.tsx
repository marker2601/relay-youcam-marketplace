"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DeadlineCountdown } from "@/components/assurance/deadline-countdown";
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

const baseStatusLabels: Record<ReservationDetail["status"], string> = {
  requested: "Awaiting owner confirmation",
  confirmed: "Event ready",
  ready_for_pickup: "Ready for pickup",
  in_use: "With you",
  returned: "Returned",
  cancelled: "Plan interrupted",
};

type ActivateBackup = (reservationId: string) => Promise<{ id: string }>;

interface ReservationTimelineProps {
  reservation: ReservationDetail;
  activateBackup?: ActivateBackup;
}

async function postBackup(reservationId: string): Promise<{ id: string }> {
  const response = await fetch(`/api/reservations/${reservationId}/backup`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  const body = await response.json() as { id?: string };
  if (!response.ok || !body.id) throw new Error("The backup look could not be activated.");
  return { id: body.id };
}

export function ReservationTimeline({
  reservation,
  activateBackup = postBackup,
}: ReservationTimelineProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const backupAvailable = reservation.status === "cancelled" && reservation.canActivateBackup;
  const currentLabel = backupAvailable ? "Backup available" : baseStatusLabels[reservation.status];
  const isBackupRequest = reservation.supersedesReservationId !== null;
  const steps: Array<{ status: ReservationDetail["status"]; label: string }> =
    reservation.status === "cancelled"
      ? [
          { status: "requested", label: "Awaiting owner confirmation" },
          { status: "cancelled", label: currentLabel },
        ]
      : [
          { status: "requested", label: "Awaiting owner confirmation" },
          { status: "confirmed", label: "Event ready" },
          { status: "ready_for_pickup", label: "Ready for pickup" },
          { status: "in_use", label: "With you" },
          { status: "returned", label: "Returned" },
        ];
  const currentIndex = steps.findIndex((step) => step.status === reservation.status);

  async function activate() {
    if (!backupAvailable || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const activated = await activateBackup(reservation.id);
      router.push(`/reservations/${activated.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The backup look could not be activated.");
      setPending(false);
      pendingRef.current = false;
    }
  }

  return (
    <section className="reservation-timeline" aria-labelledby="reservation-status-title">
      <div className="reservation-status-heading">
        <p className="eyebrow">{isBackupRequest ? "Backup request" : "Reservation status"}</p>
        <h2 id="reservation-status-title">{currentLabel}</h2>
        <p className="sr-only" role="status" aria-live="polite">
          Current reservation state: {currentLabel}
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
        <div><dt>Plan role</dt><dd>{isBackupRequest ? "Backup" : "Primary"}</dd></div>
        <div><dt>Pickup</dt><dd>{date(reservation.pickupDate)}</dd></div>
        <div><dt>Return</dt><dd>{date(reservation.returnDate)}</dd></div>
        <div><dt>Rental</dt><dd>{money(reservation.rentalPriceCents)} rental</dd></div>
        <div><dt>Deposit</dt><dd>{money(reservation.depositDisplayCents)} displayed deposit</dd></div>
        {reservation.status === "requested" ? (
          <div>
            <dt>Owner response</dt>
            <dd>
              <DeadlineCountdown
                target={reservation.responseDueAt}
                completeLabel="Response window ended"
                prefix="Respond in"
              />
            </dd>
          </div>
        ) : null}
      </dl>

      {backupAvailable && reservation.backup ? (
        <div className="return-expectations">
          <h3>{reservation.backup.title}</h3>
          <p>Request this backup look from {reservation.backup.providerDisplayName} without rebuilding your plan.</p>
          <button
            className="primary-action"
            type="button"
            onClick={activate}
            disabled={pending}
            aria-busy={pending}
          >
            Activate backup look
          </button>
          {pending ? <span className="sr-only" role="status">Activating backup look</span> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      ) : null}

      {reservation.status === "cancelled" && !backupAvailable ? (
        <p className="empty-note">
          Widen your plan by considering more styles, colors, or pickup options.
        </p>
      ) : null}

      <p className="simulation-disclosure">
        Reservation simulation—no payment has been collected
      </p>
    </section>
  );
}
