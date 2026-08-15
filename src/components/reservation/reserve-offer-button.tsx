"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ReserveOfferButtonProps {
  offerId: string;
  garmentTitle: string;
}

export function ReserveOfferButton({ offerId, garmentTitle }: ReserveOfferButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reserve() {
    if (pending) return;
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
        {pending ? "Sending request…" : `Request ${garmentTitle}`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
