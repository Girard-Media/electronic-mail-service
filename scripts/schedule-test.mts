/**
 * Send-window scheduling test (E15-104, E15-105, E22-028).
 *
 * The DST and holiday cases are the ones that bite in production, so they are
 * asserted against real transition dates rather than a mocked clock.
 */
import {
  nextSendTime, scheduleStep, validateWindow, resolveTimezone,
  zonedParts, jitterFraction, type SendWindow,
} from "../packages/sequence/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const NY: SendWindow = { start: "09:00", end: "17:00", days: [1,2,3,4,5], timezone: "America/New_York" };
const opts = (w: SendWindow, key = "k1", holidays?: Set<string>) =>
  ({ window: w, jitterKey: key, holidays });

function localHour(d: Date, tz: string) { return zonedParts(d, tz).hour; }
function localDate(d: Date, tz: string) {
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}

console.log("\n--- window basics ---");
{
  // Monday 2026-08-31, 06:00 New York — before the window opens.
  const r = nextSendTime(new Date("2026-08-31T10:00:00Z"), opts(NY));
  ok("a pre-window request lands inside the window today",
    localHour(r.sendAt, NY.timezone) >= 9 && localHour(r.sendAt, NY.timezone) < 17,
    r.sendAt.toISOString());
  ok("and on the same local day", localDate(r.sendAt, NY.timezone) === "2026-08-31");
}
{
  // Monday 22:00 New York — window has closed.
  const r = nextSendTime(new Date("2026-09-01T02:00:00Z"), opts(NY));
  ok("a post-window request defers to the NEXT day, never clamps backwards",
    localDate(r.sendAt, NY.timezone) === "2026-09-01", localDate(r.sendAt, NY.timezone));
  ok("and is still inside the window",
    localHour(r.sendAt, NY.timezone) >= 9 && localHour(r.sendAt, NY.timezone) < 17);
}
{
  // Saturday 2026-09-05.
  const r = nextSendTime(new Date("2026-09-05T14:00:00Z"), opts(NY));
  ok("a weekend request skips to Monday", localDate(r.sendAt, NY.timezone) === "2026-09-07",
    localDate(r.sendAt, NY.timezone));
  ok("and records why each day was skipped", r.skipped.some((s) => s.reason === "not-a-send-day"));
}
{
  const holidays = new Set(["2026-09-07"]); // US Labor Day
  const r = nextSendTime(new Date("2026-09-05T14:00:00Z"), opts(NY, "k1", holidays));
  ok("a holiday is skipped, not squeezed", localDate(r.sendAt, NY.timezone) === "2026-09-08",
    localDate(r.sendAt, NY.timezone));
  ok("and reported as a holiday", r.skipped.some((s) => s.reason === "holiday"));
}

console.log("\n--- spread, not a thundering herd ---");
{
  const at = new Date("2026-08-31T10:00:00Z");
  const times = Array.from({ length: 40 }, (_, i) =>
    nextSendTime(at, opts(NY, `lead-${i}`)).sendAt.getTime());
  const distinct = new Set(times);
  ok("40 leads do not all fire at the same instant", distinct.size > 20, `${distinct.size} distinct`);
  const minutes = times.map((t) => zonedParts(new Date(t), NY.timezone).hour * 60 + zonedParts(new Date(t), NY.timezone).minute);
  ok("every send is inside the window", minutes.every((m) => m >= 540 && m < 1020));
  ok("the spread covers most of the window",
    Math.max(...minutes) - Math.min(...minutes) > 300, `${Math.max(...minutes)-Math.min(...minutes)}m`);
}
{
  const a = nextSendTime(new Date("2026-08-31T10:00:00Z"), opts(NY, "lead-7")).sendAt.getTime();
  const b = nextSendTime(new Date("2026-08-31T10:00:00Z"), opts(NY, "lead-7")).sendAt.getTime();
  ok("scheduling is deterministic for the same key", a === b);
  ok("jitter is stable and bounded", jitterFraction("x") === jitterFraction("x") && jitterFraction("x") <= 1);
}

console.log("\n--- daylight saving ---");
{
  // US DST ends 2026-11-01. A Friday-before → Monday-after step crosses it.
  const before = new Date("2026-10-30T13:00:00Z"); // Fri 09:00 EDT
  const r = scheduleStep(before, 3, 0, opts(NY, "dst"));
  ok("a step across the DST boundary still lands in the local window",
    localHour(r.sendAt, NY.timezone) >= 9 && localHour(r.sendAt, NY.timezone) < 17,
    `${r.sendAt.toISOString()} → local hour ${localHour(r.sendAt, NY.timezone)}`);
  ok("and on a permitted weekday",
    [1,2,3,4,5].includes(zonedParts(r.sendAt, NY.timezone).weekday));
}
{
  // Southern hemisphere transitions the other way.
  const SYD: SendWindow = { ...NY, timezone: "Australia/Sydney" };
  const r = nextSendTime(new Date("2026-10-03T22:00:00Z"), opts(SYD, "syd"));
  ok("Sydney's spring-forward is handled",
    localHour(r.sendAt, SYD.timezone) >= 9 && localHour(r.sendAt, SYD.timezone) < 17,
    `local hour ${localHour(r.sendAt, SYD.timezone)}`);
}
{
  // A half-hour offset zone — the classic off-by-30-minutes bug.
  const IST: SendWindow = { ...NY, timezone: "Asia/Kolkata" };
  const r = nextSendTime(new Date("2026-08-31T01:00:00Z"), opts(IST, "ist"));
  ok("a half-hour-offset zone lands in the window",
    localHour(r.sendAt, IST.timezone) >= 9 && localHour(r.sendAt, IST.timezone) < 17,
    `local hour ${localHour(r.sendAt, IST.timezone)}`);
}

console.log("\n--- multi-step sequences ---");
{
  let at = new Date("2026-08-31T13:30:00Z");
  const days = [] as string[];
  for (let step = 0; step < 5; step++) {
    const r = scheduleStep(at, 3, 0, opts(NY, `seq-${step}`));
    at = r.sendAt;
    days.push(localDate(at, NY.timezone));
  }
  ok("a 5-step sequence stays on weekdays",
    days.every((_, i) => [1,2,3,4,5].includes(zonedParts(new Date(at), NY.timezone).weekday)));
  ok("and moves strictly forward", new Set(days).size === days.length, days.join(","));
}

console.log("\n--- window validation ---");
ok("a window with no send days is rejected",
  validateWindow({ ...NY, days: [] }).includes("no-send-days"));
ok("start must precede end",
  validateWindow({ ...NY, start: "17:00", end: "09:00" }).includes("start-not-before-end"));
ok("an unknown timezone is rejected",
  validateWindow({ ...NY, timezone: "Mars/Olympus" }).includes("unknown-timezone"));
ok("a malformed time is rejected",
  validateWindow({ ...NY, start: "9am" }).includes("bad-time-format"));
ok("a valid window has no defects", validateWindow(NY).length === 0);

console.log("\n--- timezone resolution ---");
ok("a declared zone wins",
  resolveTimezone("Europe/Berlin", "US", "UTC").timezone === "Europe/Berlin");
ok("an invalid declared zone falls through, it does not throw",
  resolveTimezone("Not/AZone", "DE", "UTC").timezone === "Europe/Berlin");
ok("country maps to its business zone",
  resolveTimezone(null, "AU", "UTC").timezone === "Australia/Sydney");
ok("an unmapped country falls back rather than guessing",
  resolveTimezone(null, "XX", "America/Chicago").source === "fallback");
ok("no signal at all falls back",
  resolveTimezone(null, null, "UTC").timezone === "UTC");

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
