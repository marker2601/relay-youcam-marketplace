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
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      const nextRemainingMs = remainingUntil(target);
      setRemainingMs(nextRemainingMs);
      if (nextRemainingMs > 0) {
        timer = window.setTimeout(update, Math.min(1_000, nextRemainingMs));
      }
    };
    update();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [target]);

  const totalSeconds = remainingMs === null ? null : Math.ceil(remainingMs / 1_000);
  const minutes = totalSeconds === null ? null : Math.floor(totalSeconds / 60);
  const seconds = totalSeconds === null ? null : totalSeconds % 60;

  return (
    <span aria-live="polite" aria-atomic="true">
      {remainingMs === null
        ? `${prefix} …`
        : remainingMs === 0
          ? completeLabel
          : `${prefix} ${minutes}m ${seconds}s`}
    </span>
  );
}
