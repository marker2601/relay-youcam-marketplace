"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface ProviderDecisionPanelProps {
  reservationId: string;
  terminal: boolean;
}

export function ProviderDecisionPanel({ reservationId, terminal }: ProviderDecisionPanelProps) {
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

  if (terminal) {
    return <p className="decision-complete">This request has a final decision.</p>;
  }

  return (
    <section className="decision-panel" aria-labelledby="decision-title">
      <h2 id="decision-title">Respond to this request</h2>
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
      {pending && (
        <span className="sr-only" role="status">
          {pending === "accept" ? "Accepting request" : "Declining request"}
        </span>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
