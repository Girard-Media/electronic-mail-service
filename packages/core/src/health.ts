/**
 * Process liveness vs dependency readiness — the k8s / Better Stack split.
 *
 * /livez (and legacy /health) must stay 200 whenever the process can answer,
 * even if Postgres is down; putting deps on liveness turns a DB blip into a
 * container kill loop. /readyz is 503 when Postgres or Redis is unreachable.
 */

export const SEND_QUEUE_DEGRADED_WAITING = 200;

export type Probe = { ok: boolean; ms: number };

export type QueueDepth = { waiting: number; failed: number };

export type QueueCheck = { ok: boolean; waiting: number; failed: number };

export type ReadyStatus = "ok" | "degraded" | "down";

export interface Readiness {
  status: ReadyStatus;
  service: string;
  checks: {
    postgres: Probe;
    redis: Probe;
    send_queue: QueueCheck;
  };
}

export function liveBody(service = "ems-api"): { status: "ok"; service: string } {
  return { status: "ok", service };
}

export function queueCheck(depth: QueueDepth | undefined): QueueCheck {
  const waiting = depth?.waiting ?? 0;
  const failed = depth?.failed ?? 0;
  return {
    ok: waiting <= SEND_QUEUE_DEGRADED_WAITING && failed === 0,
    waiting,
    failed,
  };
}

/** Pure classifier so tests don't need a live database. */
export function classifyReadiness(input: {
  postgres: Probe;
  redis: Probe;
  sendQueue?: QueueDepth;
  service?: string;
}): { body: Readiness; http: 200 | 503 } {
  const send_queue = queueCheck(input.sendQueue);
  const depsOk = input.postgres.ok && input.redis.ok;
  const status: ReadyStatus = !depsOk ? "down" : send_queue.ok ? "ok" : "degraded";
  return {
    http: depsOk ? 200 : 503,
    body: {
      status,
      service: input.service ?? "ems-api",
      checks: { postgres: input.postgres, redis: input.redis, send_queue },
    },
  };
}

export async function timedProbe(fn: () => Promise<unknown>): Promise<Probe> {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

/**
 * Better Stack heartbeat ping. No-op when the URL is unset so local/dev never
 * depends on an observability vendor. Never throws — a missed ping is the
 * signal; a thrown ping must not take down the worker.
 */
export async function pingHeartbeat(url: string | undefined): Promise<void> {
  const target = url?.trim();
  if (!target) return;
  try {
    await fetch(target, { method: "GET", signal: AbortSignal.timeout(5000) });
  } catch {
    /* swallow */
  }
}
