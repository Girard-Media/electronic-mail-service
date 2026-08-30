import {
  stripSubAddress,
  resolveInboundMailbox,
  inboundDisposition,
  forwardDestinations,
} from "../packages/core/src/mailbox.js";

let f = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log((c ? "✓" : "✗") + " " + n + (x ? " — " + x : ""));
  if (!c) f++;
};

ok(
  "+tag strip",
  stripSubAddress("Hi <support+news@acme.com>") === "support@acme.com",
);
ok("bare address lowercased", stripSubAddress("You@Acme.com") === "you@acme.com");

const boxes = [
  { address: "hi@acme.com", catchAll: false, status: "active", domainName: "acme.com" },
  { address: "catch@acme.com", catchAll: true, status: "active", domainName: "acme.com" },
  { address: "old@acme.com", catchAll: false, status: "suspended", domainName: "acme.com" },
  { address: "other@other.com", catchAll: true, status: "active", domainName: "other.com" },
];

ok(
  "exact match beats catch-all",
  resolveInboundMailbox("hi@acme.com", boxes)?.address === "hi@acme.com",
);
ok(
  "unknown local-part → catch-all on that domain",
  resolveInboundMailbox("sales@acme.com", boxes)?.address === "catch@acme.com",
);
ok(
  "no mailbox, no catch-all on domain → drop",
  resolveInboundMailbox("x@fresh.example", boxes) === undefined,
);
ok(
  "suspended exact does not match; catch-all does",
  resolveInboundMailbox("old@acme.com", boxes)?.address === "catch@acme.com",
);
ok(
  "other.com catch-all does not steal acme.com",
  resolveInboundMailbox("z@acme.com", boxes)?.address === "catch@acme.com",
);
ok(
  "+tag still exact-matches",
  resolveInboundMailbox("hi+list@acme.com", boxes)?.address === "hi@acme.com",
);

const dKeep = inboundDisposition({
  keepCopy: true, verifiedForwardCount: 2, usedBytes: 10, quotaBytes: 1000, sizeBytes: 50,
});
ok("keepCopy + forwards → store and forward", dKeep.store && dKeep.forward && !dKeep.overQuota);

const dFwdOnly = inboundDisposition({
  keepCopy: false, verifiedForwardCount: 1, usedBytes: 10, quotaBytes: 1000, sizeBytes: 50,
});
ok("keepCopy false + verified forward → no store, still forward", !dFwdOnly.store && dFwdOnly.forward);

const dNoFwd = inboundDisposition({
  keepCopy: false, verifiedForwardCount: 0, usedBytes: 10, quotaBytes: 1000, sizeBytes: 50,
});
ok("no verified forwards → store even if keepCopy false", dNoFwd.store && !dNoFwd.forward);

const dQuota = inboundDisposition({
  keepCopy: true, verifiedForwardCount: 3, usedBytes: 900, quotaBytes: 1000, sizeBytes: 200,
});
ok("over quota → no store, no forward", dQuota.overQuota && !dQuota.store && !dQuota.forward);

const dests = forwardDestinations("hi@acme.com", [
  { destination: "you@gmail.com", verifiedAt: new Date() },
  { destination: "pending@gmail.com", verifiedAt: null },
  { destination: "hi@acme.com", verifiedAt: new Date() },
  { destination: "YOU@gmail.com", verifiedAt: new Date() },
]);
ok("unverified skipped", !dests.includes("pending@gmail.com"));
ok("self-forward skipped", !dests.includes("hi@acme.com"));
ok("verified dest kept, deduped", dests.length === 1 && dests[0] === "you@gmail.com");

console.log(f === 0 ? "\nALL PASS" : `\n${f} FAIL`);
process.exit(f ? 1 : 0);
