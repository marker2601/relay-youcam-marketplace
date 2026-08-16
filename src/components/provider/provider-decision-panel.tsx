"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DeadlineCountdown } from "@/components/assurance/deadline-countdown";
import type { EventUrgency } from "@/lib/domain/contracts";

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

function eventTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(value));
}

interface ProviderDecisionPanelProps {
  reservationId: string;
  terminal: boolean;
  responseDueAt: string;
  urgency: EventUrgency;
  eventStartsAt?: string;
  hasBackup?: boolean;
}

export function ProviderDecisionPanel({
  reservationId,
  terminal,
  responseDueAt,
  urgency,
  eventStartsAt,
  hasBackup = false,
}: ProviderDecisionPanelProps) {
  const router = useRouter();
  const [acceptText, setAcceptText] = useState("");
  const [declineText, setDeclineText] = useState("");
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function decide(decision: "accept" | "decline") {
    if (terminal || pendingRef.current) return;
    pendingRef.current = true;
    setPending(decision);
    setError(null);
    try {
      const response = await fetch(`/api/reservations/${reservationId}/${decision}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (!response.ok) throw new Error(`Relay could not ${decision} this request.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relay could not update this request.");
      setPending(null);
      pendingRef.current = false;
    }
  }

  return (
    <section className="decision-panel" aria-labelledby="decision-title">
      <h2 id="decision-title">Respond to this request</h2>
      <dl className="reservation-facts">
        {eventStartsAt ? <div><dt>Event starts</dt><dd>{eventTime(eventStartsAt)}</dd></div> : null}
        <div><dt>Urgency</dt><dd>{urgencyLabels[urgency]}</dd></div>
        <div><dt>Response window</dt><dd>{responseWindowLabels[urgency]}</dd></div>
        <div>
          <dt>Deadline</dt>
          <dd>
            <time dateTime={responseDueAt}>{eventTime(responseDueAt)}</time> ·{" "}
            <DeadlineCountdown
              target={responseDueAt}
              completeLabel="Response window ended"
              prefix="Respond in"
            />
          </dd>
        </div>
      </dl>
      {hasBackup ? <p>The shopper has a backup option</p> : null}

      {terminal ? (
        <p className="decision-complete">This request has a final decision.</p>
      ) : (
        <>
          <p>Either decision is final for this demo reservation.</p>
          <div className="decision-options">
            <label>
              Type ACCEPT to confirm
              <input value={acceptText} onChange={(event) => setAcceptText(event.target.value)} />
              <button
                className="primary-action"
                type="button"
                disabled={pending !== null || acceptText !== "ACCEPT"}
                onClick={() => decide("accept")}
              >
                Accept request
              </button>
            </label>
            <label>
              Type DECLINE to confirm
              <input value={declineText} onChange={(event) => setDeclineText(event.target.value)} />
              <button
                className="danger-action"
                type="button"
                disabled={pending !== null || declineText !== "DECLINE"}
                onClick={() => decide("decline")}
              >
                Decline request
              </button>
            </label>
          </div>
        </>
      )}
      {pending ? (
        <span className="sr-only" role="status">
          {pending === "accept" ? "Accepting request" : "Declining request"}
        </span>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
