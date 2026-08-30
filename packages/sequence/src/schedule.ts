/**
 * Send-window scheduling (E07-048..E07-052, E15-006..E15-008, E15-059).
 *
 * Rules that are easy to get wrong and expensive when you do:
 *
 *  - Windows are evaluated in the LEAD's timezone, not the sender's. "9am" means
 *    9am where the recipient is.
 *  - We DEFER to the next open window rather than clamping into the boundary
 *    minute (E07-051). Clamping is how every campaign in a fleet ends up firing
 *    at 09:00:00 sharp, which is both a spam signal and a thundering herd.
 *  - Sends spread across the window rather than stacking at the opening minute
 *    (E07-052), deterministically so a re-run reproduces the same schedule.
 *  - Holidays and non-send days are skipped, not squeezed.
 *
 * Timezone handling uses Intl rather than a date library: the offset for a given
 * instant in a given zone is the only thing we need, and getting it from the
 * platform means DST is correct without shipping a tz database.
 */

export interface SendWindow {
  /** "09:00" — local to the lead. */
  start: string;
  /** "17:00" — exclusive. */
  end: string;
  /** ISO weekdays permitted: 1=Mon … 7=Sun. */
  days: number[];
  timezone: string;
}

export interface ScheduleOptions {
  window: SendWindow;
  /** ISO dates ("2026-12-25") treated as non-sending in this lead's country. */
  holidays?: Set<string>;
  /** Stable key so the spread within a window is reproducible (E15-012). */
  jitterKey: string;
  /** Cap on how far ahead we will search before giving up. */
  maxDaysAhead?: number;
}

/** Minutes past midnight, in the given IANA zone, for an instant. */
export function zonedParts(at: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some locales/engines; normalise it.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAY[parts.weekday ?? "Mon"] ?? 1,
  };
}

/** The UTC offset, in minutes, that `timeZone` is at the given instant. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Seconds are dropped by the formatter, so compare on whole minutes.
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The instant corresponding to a wall-clock time in a zone.
 *
 * Resolved iteratively because the offset depends on the instant we are trying
 * to compute. Two passes converge everywhere except inside a DST transition,
 * which the caller handles by re-checking the result is actually in the window.
 */
export function instantFor(
  y: number, m: number, d: number, hh: number, mm: number, timeZone: string,
): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (let i = 0; i < 3; i++) {
    const off = offsetMinutes(guess, timeZone);
    const corrected = new Date(Date.UTC(y, m - 1, d, hh, mm) - off * 60_000);
    if (corrected.getTime() === guess.getTime()) break;
    guess = corrected;
  }
  return guess;
}

function parseHhMm(s: string): { h: number; m: number } {
  const [h = "0", m = "0"] = s.split(":");
  return { h: Number(h), m: Number(m) };
}

function isoDate(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Deterministic 0..1 from a key — the spread within a window (E07-052).
 *
 * FNV-1a alone avalanches poorly on short, similar inputs: measured over 40
 * sequential `lead-N` keys it left three deciles empty and covered only 59% of
 * the range. Since real lead ids are often sequential or share a prefix, that
 * would produce exactly the bursty firing pattern jitter exists to prevent.
 * The MurmurHash3 fmix32 finaliser fixes the avalanche.
 */
export function hash32(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // fmix32
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function jitterFraction(key: string): number {
  return hash32(key) / 0x100000000;
}

export interface ScheduleResult {
  sendAt: Date;
  /** Days skipped and why — surfaced when a customer asks "why not today?" */
  skipped: Array<{ date: string; reason: "not-a-send-day" | "holiday" | "window-passed" }>;
}

/**
 * Earliest instant at or after `notBefore` that falls inside the window, on a
 * permitted day, in the lead's timezone — spread deterministically across the
 * window rather than pinned to its opening minute.
 */
export function nextSendTime(notBefore: Date, opts: ScheduleOptions): ScheduleResult {
  const { window: w, holidays, jitterKey } = opts;
  const maxDays = opts.maxDaysAhead ?? 30;
  const start = parseHhMm(w.start);
  const end = parseHhMm(w.end);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  const span = Math.max(0, endMin - startMin);
  const skipped: ScheduleResult["skipped"] = [];

  // Offset within the window, stable per (lead, step) and clamped inside it.
  const offsetInWindow = span > 0 ? Math.floor(jitterFraction(jitterKey) * span) : 0;

  let cursor = notBefore;
  for (let i = 0; i <= maxDays; i++) {
    const p = zonedParts(cursor, w.timezone);
    const date = isoDate(p);

    if (!w.days.includes(p.weekday)) {
      skipped.push({ date, reason: "not-a-send-day" });
      cursor = startOfNextLocalDay(cursor, w.timezone);
      continue;
    }
    if (holidays?.has(date)) {
      skipped.push({ date, reason: "holiday" });
      cursor = startOfNextLocalDay(cursor, w.timezone);
      continue;
    }

    const target = instantFor(p.year, p.month, p.day, start.h, start.m, w.timezone);
    const candidate = new Date(target.getTime() + offsetInWindow * 60_000);

    // Already past this day's slot? Take any remaining time in the window, else
    // move to the next day. We never clamp backwards into the boundary minute.
    if (candidate >= cursor) {
      const nowMin = p.hour * 60 + p.minute;
      if (nowMin < endMin) return { sendAt: candidate, skipped };
    } else {
      const nowMin = p.hour * 60 + p.minute;
      if (nowMin >= startMin && nowMin < endMin) return { sendAt: cursor, skipped };
    }

    skipped.push({ date, reason: "window-passed" });
    cursor = startOfNextLocalDay(cursor, w.timezone);
  }

  // Should be unreachable with a sane window; returning the cursor beats throwing
  // inside the scheduler, and the empty-days case is caught by validateWindow().
  return { sendAt: cursor, skipped };
}

function startOfNextLocalDay(at: Date, timeZone: string): Date {
  const p = zonedParts(at, timeZone);
  const midnightToday = instantFor(p.year, p.month, p.day, 0, 0, timeZone);
  // 26 hours forward then snapped back to local midnight, so a DST day that is
  // 23 or 25 hours long still lands on the following calendar day.
  const roughlyTomorrow = new Date(midnightToday.getTime() + 26 * 3600_000);
  const t = zonedParts(roughlyTomorrow, timeZone);
  return instantFor(t.year, t.month, t.day, 0, 0, timeZone);
}

/** Add step delay, then find the next open slot. */
export function scheduleStep(
  previousAt: Date,
  delayDays: number,
  delayHours: number,
  opts: ScheduleOptions,
): ScheduleResult {
  const notBefore = new Date(previousAt.getTime() + delayDays * 86_400_000 + delayHours * 3_600_000);
  return nextSendTime(notBefore, opts);
}

export type WindowDefect = "no-send-days" | "start-not-before-end" | "unknown-timezone" | "bad-time-format";

export function validateWindow(w: SendWindow): WindowDefect[] {
  const defects: WindowDefect[] = [];
  if (w.days.length === 0) defects.push("no-send-days");
  if (!/^\d{1,2}:\d{2}$/.test(w.start) || !/^\d{1,2}:\d{2}$/.test(w.end)) {
    defects.push("bad-time-format");
  } else {
    const s = parseHhMm(w.start), e = parseHhMm(w.end);
    if (s.h * 60 + s.m >= e.h * 60 + e.m) defects.push("start-not-before-end");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: w.timezone });
  } catch {
    defects.push("unknown-timezone");
  }
  return defects;
}

/**
 * Timezone for a lead, in the precedence order from planning/COMPLIANCE.md §2.
 * Falls back to the campaign's fixed zone rather than guessing (E13-032).
 */
export function resolveTimezone(
  declared: string | null,
  countryCode: string | null,
  campaignFallback: string,
): { timezone: string; source: "declared" | "country" | "fallback" } {
  if (declared && isValidZone(declared)) return { timezone: declared, source: "declared" };
  if (countryCode) {
    const zone = COUNTRY_ZONE[countryCode.toUpperCase()];
    if (zone) return { timezone: zone, source: "country" };
  }
  return { timezone: campaignFallback, source: "fallback" };
}

function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * One representative business zone per country. Deliberately coarse: for a
 * country spanning several zones this is the commercial centre, and the error is
 * bounded by hours rather than by a whole working day. Countries where that
 * would be misleading are simply absent, and fall through to the campaign zone.
 */
export const COUNTRY_ZONE: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", GB: "Europe/London",
  IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin",
  NL: "Europe/Amsterdam", BE: "Europe/Brussels", ES: "Europe/Madrid",
  IT: "Europe/Rome", PT: "Europe/Lisbon", CH: "Europe/Zurich",
  AT: "Europe/Vienna", SE: "Europe/Stockholm", NO: "Europe/Oslo",
  DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw",
  CZ: "Europe/Prague", GR: "Europe/Athens", RO: "Europe/Bucharest",
  AU: "Australia/Sydney", NZ: "Pacific/Auckland", JP: "Asia/Tokyo",
  SG: "Asia/Singapore", HK: "Asia/Hong_Kong", IN: "Asia/Kolkata",
  AE: "Asia/Dubai", IL: "Asia/Jerusalem", ZA: "Africa/Johannesburg",
  BR: "America/Sao_Paulo", MX: "America/Mexico_City", AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago", CO: "America/Bogota",
};
