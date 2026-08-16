export type EventUrgency = "tonight" | "tomorrow" | "this_week" | "planned";
export type AssuranceRole = "primary" | "backup" | "alternative";
export type AssuranceCoverage = "primary_and_backup" | "primary_only";

export interface ReadinessBreakdown {
  availability: number;
  measurements: number;
  proximity: number;
  style: number;
  confirmation: number;
  total: number;
}

export function classifyEventUrgency(eventStartsAt: Date, now: Date): EventUrgency {
  const hours = (eventStartsAt.getTime() - now.getTime()) / 3_600_000;
  if (hours <= 0 || hours > 90 * 24) throw new RangeError("Event must be within the next 90 days");
  if (hours < 12) return "tonight";
  if (hours <= 36) return "tomorrow";
  if (hours <= 7 * 24) return "this_week";
  return "planned";
}

export function responseWindowMs(urgency: EventUrgency): number {
  return urgency === "tonight" ? 15 * 60_000 : urgency === "tomorrow" ? 60 * 60_000 : 4 * 60 * 60_000;
}

export function chicagoLocalDateTimeToIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const offsetAt = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
    return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - instant.getTime();
  };
  const first = new Date(wallClockAsUtc - offsetAt(new Date(wallClockAsUtc)));
  return new Date(wallClockAsUtc - offsetAt(first)).toISOString();
}

export function assignAssuranceRoles<T extends { id: string; providerId: string }>(rows: readonly T[]): Map<string, AssuranceRole> {
  const roles = new Map<string, AssuranceRole>();
  const primary = rows[0];
  if (!primary) return roles;
  roles.set(primary.id, "primary");
  const backup = rows.slice(1).find((row) => row.providerId !== primary.providerId) ?? rows[1];
  if (backup) roles.set(backup.id, "backup");
  for (const row of rows.slice(1)) if (!roles.has(row.id)) roles.set(row.id, "alternative");
  return roles;
}

function scale(value: number, sourceMaximum: number, targetMaximum: number): number {
  return Math.round(Math.min(1, Math.max(0, value / sourceMaximum)) * targetMaximum);
}

export function calculateReadiness(input: {
  available: boolean;
  measurementBasisPoints: number;
  distanceBasisPoints: number;
  styleBasisPoints: number;
  providerConfirmed: boolean;
}): ReadinessBreakdown {
  const result = {
    availability: input.available ? 35 : 0,
    measurements: scale(input.measurementBasisPoints, 3_500, 25),
    proximity: scale(input.distanceBasisPoints, 500, 20),
    style: scale(input.styleBasisPoints, 4_000, 10),
    confirmation: input.providerConfirmed ? 10 : 0,
  };
  return { ...result, total: Object.values(result).reduce((sum, value) => sum + value, 0) };
}
