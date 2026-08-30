/**
 * Token bucket concurrency test — invariant I3 (E07-040, E22-019).
 *
 * The claim must be atomic across all four buckets. This test hammers a cap with
 * concurrent claimants and asserts that EXACTLY the cap succeeds: not cap+1
 * (which would mean two workers both saw headroom), and not fewer (which would
 * mean we are silently throwing away capacity).
 *
 * Requires the local stack: pnpm infra:up
 */

import Redis from "ioredis";
import {
  buildSpecs, claim, release, nextEspCap,
  type BucketInputs,
} from "../packages/router/src/buckets.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:56379";
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const AT = new Date("2026-08-30T10:07:00.000Z");

function inputs(suffix: string, over: Partial<BucketInputs> = {}): BucketInputs {
  return {
    mailboxId: `mbx-${suffix}`,
    domainId: `dom-${suffix}`,
    ipId: `ip-${suffix}`,
    esp: "google",
    mailboxDailyCap: 40,
    mailboxHourlyCap: 5,
    domainDailyCap: 100,
    ipHourlyCap: 500,
    espQuarterCap: 200,
    at: AT,
    ...over,
  };
}

async function clear(suffix: string) {
  const keys = buildSpecs(inputs(suffix)).map((s) => s.key);
  if (keys.length) await redis.del(...keys);
}

async function main() {
  // ── 1. Concurrency: exactly `cap` claims succeed, no more, no fewer.
  {
    const suffix = "race";
    await clear(suffix);
    const CAP = 40;
    const CLAIMANTS = 200;

    const results = await Promise.all(
      Array.from({ length: CLAIMANTS }, () =>
        claim(redis, buildSpecs(inputs(suffix, { mailboxHourlyCap: 10_000, mailboxDailyCap: CAP }))),
      ),
    );
    const granted = results.filter((r) => r.ok).length;
    ok(
      `exactly ${CAP} of ${CLAIMANTS} concurrent claims granted (I3: no cap overflow)`,
      granted === CAP,
      `granted ${granted}`,
    );

    const counter = Number(await redis.get(buildSpecs(inputs(suffix)).find((s) => s.name === "mailbox-daily")!.key));
    ok("the counter equals the grants — no phantom spend", counter === CAP, `counter ${counter}`);

    const denials = results.filter((r) => !r.ok);
    ok(
      "every denial names mailbox-daily as the binding constraint",
      denials.every((d) => !d.ok && d.bindingConstraint === "mailbox-daily"),
    );
    await clear(suffix);
  }

  // ── 2. All-or-nothing: a full bucket must not let the others be spent.
  {
    const suffix = "atomic";
    await clear(suffix);
    // Hourly cap of 1 is the binding constraint; daily has plenty of room.
    const spec = inputs(suffix, { mailboxHourlyCap: 1, mailboxDailyCap: 40 });

    const first = await claim(redis, buildSpecs(spec));
    ok("first claim granted", first.ok);

    const second = await claim(redis, buildSpecs(spec));
    ok("second claim denied on the hourly bucket", !second.ok && second.bindingConstraint === "mailbox-hourly");

    const dailyKey = buildSpecs(spec).find((s) => s.name === "mailbox-daily")!.key;
    const daily = Number(await redis.get(dailyKey));
    ok(
      "the DENIED claim spent nothing — daily is still 1, not 2 (all-or-nothing)",
      daily === 1,
      `daily counter ${daily}`,
    );
    await clear(suffix);
  }

  // ── 3. Each bucket can be the binding constraint, and says so.
  {
    for (const [name, over] of [
      ["mailbox-daily",  { mailboxDailyCap: 0 }],
      ["mailbox-hourly", { mailboxHourlyCap: 0 }],
      ["domain-daily",   { domainDailyCap: 0 }],
      ["ip-hourly",      { ipHourlyCap: 0 }],
      ["esp-adaptive",   { espQuarterCap: 0 }],
    ] as const) {
      const suffix = `bind-${name}`;
      await clear(suffix);
      const r = await claim(redis, buildSpecs(inputs(suffix, over)));
      ok(`${name} reports itself as the binding constraint`, !r.ok && r.bindingConstraint === name,
        r.ok ? "granted" : `got ${r.bindingConstraint}`);
      await clear(suffix);
    }
  }

  // ── 4. Release returns unspent allowance, and cannot mint capacity.
  {
    const suffix = "release";
    await clear(suffix);
    const specs = buildSpecs(inputs(suffix, { mailboxDailyCap: 3 }));

    await claim(redis, specs);
    await claim(redis, specs);
    const key = specs.find((s) => s.name === "mailbox-daily")!.key;
    ok("two claims counted", Number(await redis.get(key)) === 2);

    await release(redis, specs);
    ok("release returns one", Number(await redis.get(key)) === 1);

    await release(redis, specs);
    await release(redis, specs);
    await release(redis, specs);
    ok("over-release floors at zero — it can never mint capacity",
      Number(await redis.get(key)) === 0, `counter ${await redis.get(key)}`);
    await clear(suffix);
  }

  // ── 5. Windows are independent: a new hour does not reset the day.
  {
    const suffix = "window";
    await clear(suffix);
    const hour10 = buildSpecs(inputs(suffix, { at: new Date("2026-08-30T10:30:00Z") }));
    const hour11 = buildSpecs(inputs(suffix, { at: new Date("2026-08-30T11:30:00Z") }));

    ok("hourly keys differ across the hour boundary",
      hour10.find((s) => s.name === "mailbox-hourly")!.key !== hour11.find((s) => s.name === "mailbox-hourly")!.key);
    ok("daily keys are the same within one day",
      hour10.find((s) => s.name === "mailbox-daily")!.key === hour11.find((s) => s.name === "mailbox-daily")!.key);

    const q07 = buildSpecs(inputs(suffix, { at: new Date("2026-08-30T10:07:00Z") }));
    const q14 = buildSpecs(inputs(suffix, { at: new Date("2026-08-30T10:14:00Z") }));
    const q16 = buildSpecs(inputs(suffix, { at: new Date("2026-08-30T10:16:00Z") }));
    ok("10:07 and 10:14 share a 15-minute ESP window",
      q07.find((s) => s.name === "esp-adaptive")!.key === q14.find((s) => s.name === "esp-adaptive")!.key);
    ok("10:16 starts a new 15-minute ESP window",
      q07.find((s) => s.name === "esp-adaptive")!.key !== q16.find((s) => s.name === "esp-adaptive")!.key);
    await clear(suffix);
  }

  // ── 6. Every bucket gets a TTL, so a crashed worker cannot strand a counter.
  {
    const suffix = "ttl";
    await clear(suffix);
    const specs = buildSpecs(inputs(suffix));
    await claim(redis, specs);
    for (const s of specs) {
      const ttl = await redis.ttl(s.key);
      ok(`${s.name} has a TTL set`, ttl > 0, `ttl ${ttl}`);
    }
    await clear(suffix);
  }

  // ── 7. The adaptive ESP cap backs off hard and recovers slowly.
  {
    ok("a deferral spike halves the ESP rate immediately", nextEspCap(200, 0.2) === 100);
    ok("back-off repeats while deferrals persist", nextEspCap(100, 0.2) === 50);
    ok("a clean window recovers only ~10%", nextEspCap(100, 0) === 110);
    ok("recovery is slower than back-off (asymmetric by design)",
      200 - nextEspCap(200, 0.2) > nextEspCap(200, 0) - 200);
    ok("a low but non-zero defer rate holds steady", nextEspCap(100, 0.01) === 100);
    ok("the cap never falls below the floor", nextEspCap(6, 0.9) === 5);
    ok("the cap never exceeds the ceiling", nextEspCap(500, 0) === 500);
  }

  console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
  await redis.quit();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await redis.quit();
  process.exit(1);
});
