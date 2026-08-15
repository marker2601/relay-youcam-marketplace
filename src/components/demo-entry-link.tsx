"use client";

import { useState, type MouseEvent, type ReactNode } from "react";

interface DemoEntryLinkProps {
  className: string;
  href: string;
  userId: string;
  children: ReactNode;
}

export function DemoEntryLink({ className, href, userId, children }: DemoEntryLinkProps) {
  const [pending, setPending] = useState(false);

  async function enterDemo(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) throw new Error("Demo session could not be created");
      window.location.assign(href);
    } catch {
      setPending(false);
    }
  }

  return (
    <a className={className} href={href} onClick={enterDemo} aria-disabled={pending}>
      {pending ? "Opening Relay…" : children}
    </a>
  );
}
