import {
  classifyReadiness,
  liveBody,
  queueCheck,
  SEND_QUEUE_DEGRADED_WAITING,
} from "../packages/core/src/health.js";

let f = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log((c ? "✓" : "✗") + " " + n + (x ? " — " + x : ""));
  if (!c) f++;
};

const up = { ok: true, ms: 2 };
const down = { ok: false, ms: 5 };

ok("live body is always ok", liveBody().status === "ok" && liveBody().service === "ems-api");

{
  const r = classifyReadiness({ postgres: up, redis: up, sendQueue: { waiting: 0, failed: 0 } });
  ok("both deps up, empty queue → ok/200", r.http === 200 && r.body.status === "ok");
}

{
  const r = classifyReadiness({ postgres: down, redis: up });
  ok("postgres down → down/503", r.http === 503 && r.body.status === "down");
  ok("livez must not follow readyz", liveBody().status === "ok");
}

{
  const r = classifyReadiness({ postgres: up, redis: down });
  ok("redis down → down/503", r.http === 503 && r.body.status === "down");
}

{
  const r = classifyReadiness({
    postgres: up,
    redis: up,
    sendQueue: { waiting: SEND_QUEUE_DEGRADED_WAITING + 50, failed: 0 },
  });
  ok("queue waiting over threshold → degraded/200", r.http === 200 && r.body.status === "degraded");
  ok("degraded still exposes waiting", r.body.checks.send_queue.waiting === SEND_QUEUE_DEGRADED_WAITING + 50);
}

{
  const r = classifyReadiness({
    postgres: up,
    redis: up,
    sendQueue: { waiting: 3, failed: 2 },
  });
  ok("failed jobs → degraded/200", r.http === 200 && r.body.status === "degraded" && !r.body.checks.send_queue.ok);
}

ok("queueCheck at threshold still ok", queueCheck({ waiting: SEND_QUEUE_DEGRADED_WAITING, failed: 0 }).ok);
ok("queueCheck just over threshold not ok", !queueCheck({ waiting: SEND_QUEUE_DEGRADED_WAITING + 1, failed: 0 }).ok);

console.log(f === 0 ? "\nALL PASS" : `\n${f} FAIL`);
process.exit(f ? 1 : 0);
