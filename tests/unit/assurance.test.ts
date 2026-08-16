import { describe, expect, it } from "vitest";

import {
  assignAssuranceRoles,
  calculateResponseDeadline,
  calculateReadiness,
  chicagoLocalDateTimeToIso,
  classifyEventUrgency,
  classifyEventUrgencyForDisplay,
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

  it("keeps same-provider candidates as alternatives instead of inventing a backup", () => {
    expect(assignAssuranceRoles([
      { id: "one", providerId: "provider-a" },
      { id: "two", providerId: "provider-a" },
      { id: "three", providerId: "provider-a" },
    ])).toEqual(new Map([
      ["one", "primary"],
      ["two", "alternative"],
      ["three", "alternative"],
    ]));
  });

  it("keeps historical event urgency readable after the event", () => {
    expect(
      classifyEventUrgencyForDisplay(
        new Date("2026-08-15T10:00:00.000Z"),
        new Date("2026-08-16T12:00:00.000Z"),
      ),
    ).toBe("tonight");
  });

  it("uses exact seven-day and ninety-day creation boundaries", () => {
    expect(
      classifyEventUrgency(new Date(now.getTime() + 7 * 24 * 60 * 60_000), now),
    ).toBe("this_week");
    expect(
      classifyEventUrgency(new Date(now.getTime() + 7 * 24 * 60 * 60_000 + 1), now),
    ).toBe("planned");
    expect(
      classifyEventUrgency(new Date(now.getTime() + 90 * 24 * 60 * 60_000), now),
    ).toBe("planned");
    expect(() =>
      classifyEventUrgency(new Date(now.getTime() + 90 * 24 * 60 * 60_000 + 1), now),
    ).toThrow("Event must be within the next 90 days");
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

  it("rejects a nonexistent Chicago DST-gap wall time", () => {
    expect(() => chicagoLocalDateTimeToIso("2027-03-14", "02:30")).toThrow(
      "Event time does not exist in America/Chicago",
    );
  });

  it("rejects an ambiguous Chicago DST-fold wall time", () => {
    expect(() => chicagoLocalDateTimeToIso("2026-11-01", "01:30")).toThrow(
      "Event time is ambiguous in America/Chicago",
    );
  });

  it("caps a provider response deadline at the event start", () => {
    const eventStartsAt = new Date(now.getTime() + 5 * 60_000);

    expect(calculateResponseDeadline(eventStartsAt, now, "tonight")).toEqual(eventStartsAt);
  });
});
