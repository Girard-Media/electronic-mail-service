// scheduled_at must be strict: an explicit-offset ISO-8601 timestamp in the
// future. A lenient parse (bare `new Date()`) silently accepts "2026" or a
// naive local-time string; a past value silently clamps to a 0ms queue delay
// and sends immediately instead of erroring.
import { parseScheduledAt } from "../packages/core/src/schema.js";

let fail = 0;
const ok = (n: string, c: boolean) => { console.log((c ? "✓" : "✗") + " " + n); if (!c) fail++; };

const NOW = Date.parse("2026-08-11T12:00:00Z");
const good = (v: string) => parseScheduledAt(v, NOW).ok;
const bad = (v: string) => !parseScheduledAt(v, NOW).ok;

ok("UTC Z accepted", good("2026-08-12T09:30:00Z"));
ok("negative offset accepted", good("2026-08-12T09:30:00-04:00"));
ok("positive offset accepted", good("2026-08-12T09:30:00+02:00"));
ok("offset without colon accepted", good("2026-08-12T09:30:00+0200"));
ok("milliseconds accepted", good("2026-08-12T09:30:00.123Z"));
ok("seconds optional", good("2026-08-12T09:30Z"));

ok("naive (no offset) rejected", bad("2026-08-12T09:30:00"));
ok("year-only rejected", bad("2026"));
ok("date-only rejected", bad("2026-08-12"));
ok("natural language rejected", bad("in 1 hour"));
ok("human date rejected", bad("March 5, 2027"));
ok("garbage rejected", bad("not-a-date"));
ok("empty rejected", bad(""));
ok("impossible date rejected", bad("2026-02-31T09:30:00Z"));

ok("past rejected", bad("2020-01-01T00:00:00Z"));
ok("now rejected (must be strictly future)", bad("2026-08-11T12:00:00Z"));
ok("one second in the future accepted", good("2026-08-11T12:00:01Z"));

const r = parseScheduledAt("2026-08-12T09:30:00Z", NOW);
ok("returns a Date on success", r.ok && r.date instanceof Date);
ok("parsed instant is correct", r.ok && r.date.getTime() === Date.parse("2026-08-12T09:30:00Z"));
const e = parseScheduledAt("nope", NOW);
ok("error message mentions scheduled_at", !e.ok && e.message.includes("scheduled_at"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAIL`); process.exit(fail ? 1 : 0);
