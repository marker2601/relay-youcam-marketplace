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

const hourMs = 3_600_000;
const maximumEventHorizonHours = 90 * 24;

function urgencyForHours(hours: number): EventUrgency {
  if (hours < 12) return "tonight";
  if (hours <= 36) return "tomorrow";
  if (hours <= 7 * 24) return "this_week";
  return "planned";
}

export function classifyEventUrgency(eventStartsAt: Date, now: Date): EventUrgency {
  const hours = (eventStartsAt.getTime() - now.getTime()) / hourMs;
  if (!Number.isFinite(hours) || hours <= 0 || hours > maximumEventHorizonHours) {
    throw new RangeError("Event must be within the next 90 days");
  }
  return urgencyForHours(hours);
}

export function classifyEventUrgencyForDisplay(
  eventStartsAt: Date,
  referenceTime: Date,
): EventUrgency {
  const hours = (eventStartsAt.getTime() - referenceTime.getTime()) / hourMs;
  if (!Number.isFinite(hours)) return "planned";
  return urgencyForHours(Math.max(0, hours));
}

export function responseWindowMs(urgency: EventUrgency): number {
  return urgency === "tonight" ? 15 * 60_000 : urgency === "tomorrow" ? 60 * 60_000 : 4 * 60 * 60_000;
}

export function calculateResponseDeadline(
  eventStartsAt: Date,
  now: Date,
  urgency: EventUrgency,
): Date {
  if (
    !Number.isFinite(eventStartsAt.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    eventStartsAt.getTime() <= now.getTime()
  ) {
    throw new RangeError("Event must be in the future");
  }
  return new Date(
    Math.min(eventStartsAt.getTime(), now.getTime() + responseWindowMs(urgency)),
  );
}

const chicagoFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function chicagoParts(instant: Date) {
  const parts = chicagoFormatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function chicagoOffsetAt(instant: Date): number {
  const observed = chicagoParts(instant);
  return Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second,
  ) - instant.getTime();
}

export function chicagoDateForInstant(instant: Date): string {
  const { year, month, day } = chicagoParts(instant);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function chicagoLocalDateTimeToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new RangeError("Enter a valid Chicago event date and time");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    month! < 1 ||
    month! > 12 ||
    day! < 1 ||
    day! > 31 ||
    hour! < 0 ||
    hour! > 23 ||
    minute! < 0 ||
    minute! > 59
  ) {
    throw new RangeError("Enter a valid Chicago event date and time");
  }
  const wallClockAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const normalizedWallClock = new Date(wallClockAsUtc);
  if (
    normalizedWallClock.getUTCFullYear() !== year ||
    normalizedWallClock.getUTCMonth() + 1 !== month ||
    normalizedWallClock.getUTCDate() !== day
  ) {
    throw new RangeError("Enter a valid Chicago event date and time");
  }

  const offsets = new Set<number>();
  for (const probeHours of [-36, -12, 0, 12, 36]) {
    offsets.add(chicagoOffsetAt(new Date(wallClockAsUtc + probeHours * hourMs)));
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wallClockAsUtc - offset))
    .filter((candidate) => {
      const observed = chicagoParts(candidate);
      return (
        observed.year === year &&
        observed.month === month &&
        observed.day === day &&
        observed.hour === hour &&
        observed.minute === minute &&
        observed.second === 0
      );
    });

  if (candidates.length === 0) {
    throw new RangeError("Event time does not exist in America/Chicago");
  }
  if (candidates.length > 1) {
    throw new RangeError("Event time is ambiguous in America/Chicago");
  }
  return candidates[0]!.toISOString();
}

export function assignAssuranceRoles<T extends { id: string; providerId: string }>(rows: readonly T[]): Map<string, AssuranceRole> {
  const roles = new Map<string, AssuranceRole>();
  const primary = rows[0];
  if (!primary) return roles;
  roles.set(primary.id, "primary");
  const backup = rows.slice(1).find((row) => row.providerId !== primary.providerId);
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
