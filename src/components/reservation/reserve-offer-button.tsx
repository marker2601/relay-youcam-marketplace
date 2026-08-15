"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface ReserveOfferButtonProps {
  offerId: string;
  garmentTitle: string;
}

export function ReserveOfferButton({ offerId, garmentTitle }: ReserveOfferButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function reserve() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/offers/${offerId}/reserve`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const body = await response.json() as { id?: string };
      if (!response.ok || !body.id) throw new Error("This offer could not be requested.");
      router.push(`/reservations/${body.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This offer could not be requested.");
      setPending(false);
      pendingRef.current = false;
    }
  }

  return (
    <>
      <button
        className="primary-action offer-action"
        type="button"
        onClick={reserve}
        disabled={pending}
        aria-busy={pending}
      >
        {`Request ${garmentTitle}`}
      </button>
      {pending && <span className="sr-only" role="status">Sending reservation request</span>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
