/**
 * Translate a RouteResult into a SendIntent patch (I5). Pure.
 * The worker writes the patch; this module does not touch Prisma.
 */

type PlanLike = {
  kind: "plan";
  mailboxId: string;
  sendAt: Date;
  score: number;
  trace: unknown;
};
type DeferLike = {
  kind: "defer";
  until: Date;
  reason: string;
  bindingConstraint: string;
};

export type IntentRoutePatch = {
  state: "ROUTED" | "DEFERRED";
  mailboxId: string | null;
  routedAt: Date | null;
  routeScore: number | null;
  routeTrace: unknown;
  deferUntil: Date | null;
  deferReason: string | null;
  deferCount: number;
};

export function applyRouteResult(result: PlanLike | DeferLike, deferCount: number): IntentRoutePatch {
  if (result.kind === "plan") {
    return {
      state: "ROUTED",
      mailboxId: result.mailboxId,
      routedAt: result.sendAt,
      routeScore: result.score,
      routeTrace: result.trace,
      deferUntil: null,
      deferReason: null,
      deferCount,
    };
  }
  return {
    state: "DEFERRED",
    mailboxId: null,
    routedAt: null,
    routeScore: null,
    routeTrace: { reason: result.reason, bindingConstraint: result.bindingConstraint },
    deferUntil: result.until,
    deferReason: result.reason,
    deferCount: deferCount + 1,
  };
}
