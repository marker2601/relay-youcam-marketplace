import { describe, expect, it } from "vitest";

import {
  assignAssuranceRoles,
  calculateReadiness,
  chicagoLocalDateTimeToIso,
  classifyEventUrgency,
  responseWindowMs,
} from "@/lib/domain/assurance";

describe("Relay Rescue assurance rules", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");

  it.each([
    [11, "tonight", 15 * 60_000],
    [12, "tomorrow", 60 * 60_000],
    [36, "tomorrow", 60 * 60_000],
    [37, "this_week", 4 * 60 * 60_000],
    [8 * 24, "planned", 4 * 60 * 60_000],
  ] as const)("classifies %s hours", (hours, urgency, window) => {
    const event = new Date(now.getTime() + hours * 60 * 60_000);
    expect(classifyEventUrgency(event, now)).toBe(urgency);
    expect(responseWindowMs(urgency)).toBe(window);
  });

  it("chooses the top match as primary and a different provider as backup", () => {
    expect(assignAssuranceRoles([
      { id: "one", providerId: "provider-a" },
      { id: "two", providerId: "provider-a" },
      { id: "three", providerId: "provider-b" },
    ])).toEqual(new Map([
      ["one", "primary"],
      ["three", "backup"],
      ["two", "alternative"],
    ]));
  });

  it("returns a bounded explainable readiness score", () => {
    expect(calculateReadiness({
      available: true,
      measurementBasisPoints: 3_500,
      distanceBasisPoints: 500,
      styleBasisPoints: 4_000,
      providerConfirmed: false,
    })).toEqual({ availability: 35, measurements: 25, proximity: 20, style: 10, confirmation: 0, total: 90 });
  });

  it("converts Chicago wall time independently of the browser time zone", () => {
    expect(chicagoLocalDateTimeToIso("2026-08-17", "19:00")).toBe("2026-08-18T00:00:00.000Z");
  });
});
