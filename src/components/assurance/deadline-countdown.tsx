"use client";

import { useEffect, useState } from "react";

function remainingUntil(target: string): number {
  return Math.max(0, new Date(target).getTime() - Date.now());
}

interface DeadlineCountdownProps {
  target: string;
  completeLabel: string;
  prefix: string;
}

export function DeadlineCountdown({
  target,
  completeLabel,
  prefix,
}: DeadlineCountdownProps) {
  const [remainingMs, setRemainingMs] = useState(() => remainingUntil(target));

  useEffect(() => {
    const update = () => setRemainingMs(remainingUntil(target));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [target]);

  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);

  return (
    <span aria-live="polite" aria-atomic="true">
      {remainingMs === 0 ? completeLabel : `${prefix} ${minutes}m ${seconds}s`}
    </span>
  );
}
