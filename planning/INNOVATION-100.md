# EMS — 100 Differentiators (agency synthesis, 2026-09-14)

Source: 8-track agency swarm (DX, deliverability, AI, analytics, trust,
white-label, pricing, automation) against VISION / ARCHITECTURE / INFRA /
COMPLIANCE / AI. Competitors: Instantly, Smartlead, Lemlist, Apollo,
Woodpecker, Reply, Salesforge, QuickMail, plus Resend/SendGrid/Postmark on
the transactional side. Rule: clean-room only, own-MTA-first, reputation is
the scarce resource, every claim traces to a measurement.

How to use: items marked **[BET]** are the 20 bets promoted to
`planning/backlog/25-differentiation.md` (E25-xxx). The rest are sequenced
after Phase 2 gates pass.

## A — Send-path honesty & developer experience (1–12)

1. **Maillog-signed `delivered` receipt [BET]** — `delivered` is emitted only
   from our Postfix maillog `250` (maillog-bridge), with the queue-ID and
   receiving-MX hostname attached. Why unique: incumbents report "accepted by
   Gmail API" as delivered; ours is a provable receiving-MX fact.
2. **Per-send reputation receipt** — every send returns reputation debited,
   mailbox/IP/domain balances, and policy decision ID. Why unique: turns an
   opaque send into a ledger entry competitors don't expose.
3. **Explain-preflight (`dry-run?explain=1`)** — simulate policy, suppression,
   verification, and router choice without sending, with reasons. Why unique:
   Smartlead fails silently; we show the exact gate that would block.
4. **Idempotency replay key** — same `Idempotency-Key` returns the original
   receipt plus the maillog line, safe to retry. Why unique: outreach tools
   double-send on retry; ours is exactly-once per key.
5. **Local mailroom (fake SES/MTA)** — one-command fake MTA + seed inboxes so
   sequences run end-to-end locally. Why unique: Instantly-class tools have no
   local story; ours mirrors prod routing.
6. **Time-travel scheduler clock** — fast-forward campaign windows/warmup in
   dev to test dueAt, windows, holds. Why unique: nobody lets you deterministically
   test a 14-day sequence in minutes.
7. **Typed template variables (`tsc` for copy)** — lead fields are a typed
   schema; unresolvable tokens fail the build before launch. Why unique:
   competitors send "Hi {{first_name}}"; we refuse to compile it.
8. **Pinned API version per key** — each API key pins a send-surface version,
   upgrades are explicit per key. Why unique: avoids silent breaking changes
   that plague outreach APIs.
9. **Branded SDK generator** — agency gets `@client/sdk` with their domain,
   types, and policy presets generated. Why unique: white-label down to the
   import specifier.
10. **Captured-inbox preview** — every variant renders against 5 real leads
    into seed inboxes with screenshots. Why unique: preview with real data,
    not `{{placeholders}}`.
11. **Res Arbeit: replay-and-resign** — re-sign any sent message's DKIM and
    re-verify to prove authenticity post-hoc. Why unique: evidentiary
    deliverability, not vibes.
12. **Batch-100 atomic launch check** — launch validates 100 sampled enrolments
    (tokens, suppression, capacity) atomically; blocks with a fix list. Why
    unique: fail-before-burn instead of fail-after-burn.

## B — Reputation allocator & deliverability physics (13–25)

13. **Go/no-go verdict per send [BET]** — router emits a numeric verdict with
    trace (mailbox, IP, domain scores, time-of-day factor). Why unique:
    competitors pick a mailbox round-robin; we publish the decision.
14. **Union suppression tombstone** — global + org + campaign suppressions
    hashed into one lookup with provenance per hit. Why unique: one lookup,
    auditable reason, no silent drops.
15. **Guilty-only bounce quarantine** — only the offending IP/domain pauses,
    never the whole fleet. Why unique: blast-radius isolation incumbents can't
    do without owning the MTA.
16. **Per-ESP retry dialects** — retry/backoff curves tuned per receiving MX
    (Google vs Microsoft vs Yahoo vs Proofpoint/Mimecast/Barracuda). Why
    unique: seeded from our own bounce corpus, not generic SMTP retry.
17. **Preflight fix hints** — on soft-fail, return the concrete fix (e.g.
    "lower today's volume on domain X by 40%"). Why unique: actionable, not
    `4.7.1 deferred`.
18. **Quota-ramped warmup curves [BET]** — conservative/standard/aggressive
    curves enforced as token buckets in Valkey Lua, with auto-hold on bounces.
    Why unique: warmup as code with a demonstrated rollback.
19. **Seed-riding warmup** — warmup messages share batches with seed probes so
    placement feedback lands in minutes. Why unique: closes the loop faster
    than overnight seed checks.
20. **Variant throttling by reputation cost** — high-risk copy variants get a
    smaller reputation budget automatically. Why unique: A/B tests that can't
    torch the domain.
21. **DMARC RUA auto-fix loop** — aggregate reports parsed nightly into
    alignment fixes (SPF/DKIM/forwarding). Why unique: DMARC as a control
    loop, not a dashboard chart.
22. **Exportable deliverability passport** — per-domain placement, bounce
    taxonomy, and warmup history exportable as a signed PDF for clients. Why
    unique: agencies can prove inbox math to customers.
23. **Mid-retry MX failover** — on per-MX deferral storms, re-route queued
    intents to the next-best IP without duplicating. Why unique: requires
    owning queue + MTA + router together.
24. **Bulk-first load shedding** — under pressure, bulk steps shed before
    high-intent follow-ups, by declared priority. Why unique: reputation triage
    instead of FIFO collapse.
25. **Cold-to-opt-in handoff API [BET]** — the moment a lead opts in, EMS
    emits a signed handoff to usermails and suppresses locally. Why unique:
    acquisition and lifecycle on separate iron, by design.

## C — AI copy & personalization, human-gated (26–38)

26. **Voice-per-project fine profile** — per-client tone/ICP/offer profile
    versioned; generation cites the profile version. Why unique: agency can
    prove *whose voice* wrote it.
27. **Resend+AI in one call** — `generate + send` drafts via OpenRouter then
    requires human accept before emit (E15-046..048). Why unique: AI speed
    with a hard human gate — never autonomous sending.
28. **Gated token budgets per campaign** — AI spend capped per campaign with
    per-task ledgers (AiCall). Why unique: prevents a runaway personalization
    bill; competitors meter opaquely.
29. **Paraphrase-and-rescore loop** — spam-signal score re-runs after every AI
    rewrite until under threshold or human override. Why unique: deliverability
    inside the writing loop.
30. **Plain-text-first a11y fixer** — heavy HTML flagged, auto-suggests
    plain-text equivalent with reason. Why unique: VISION refuses the
    drag-and-drop designer; we enforce what converts.
31. **Authored MIME, not generated blobs** — AI writes body + text part; MIME
    assembly stays deterministic in code. Why unique: no LLM-invented headers.
32. **Glossary-pinned ICU rendering** — per-locale glossary + ICU MessageFormat
    validation before send. Why unique: localized outreach without broken
    placeholders.
33. **4-subject bandit with guardrails [BET]** — Thompson sampling over
    subjects, auto-paused on underpowered samples, CIs shown. Why unique:
    honest experimentation (E15-014..017).
34. **Zod-typed merge tags** — tag types (date/email/int) validated at
    materialisation. Why unique: "Hi 2026-13-99" becomes impossible.
35. **Tone-per-segment generation** — persona vs SMB vs enterprise tones from
    the same offer, labeled. Why unique: one campaign, many voices, auditable.
36. **Signed provenance stamp** — headers record model, prompt version, human
    approver. Why unique: answers "did a robot write this?" in court.
37. **One-call offer packs** — ICP + offer + proof + CTA packed into a single
    validated brief object. Why unique: kills the 12-field campaign form.
38. **Alt-compress for images** — images forced to carry text equivalents or
    are stripped with a warning. Why unique: image-only cold mail dies here.

## D — Observability & proof (39–50)

39. **Per-message timeline [BET]** — queued → routed → submitted → 250 →
    open/click/reply/bounce as one trace. Why unique: single ID across
    Postgres, ClickHouse, and maillog.
40. **Tenant-scoped embeds** — live placement/funnel widgets scoped by orgId,
    signed URLs. Why unique: agencies embed proof in client portals safely.
41. **Trace-per-send (OpenTelemetry)** — router decision, policy verdict, and
    SMTP transcript linked. Why unique: debugging a single cold email like a
    distributed trace.
42. **Guardrailed SQL cockpit** — curated ClickHouse queries with orgId
    injection enforced. Why unique: self-serve analytics that can't leak
    cross-tenant (I-rule).
43. **Subsecond tail on placed mail** — p50/p95 from submit to 250 per MX. Why
    unique: latency honesty incumbents hide.
44. **Anomaly auto-pause [BET]** — bounce/complaint/reply-rate anomalies pause
    the campaign with a stated reason. Why unique: circuit breaker, not a
    Monday-morning apology.
45. **Versioned funnels** — funnel definitions versioned; history recomputable.
    Why unique: "reply rate dropped" becomes diffable.
46. **R2-archived raw MIME** — every sent MIME in R2 keyed by Message-ID. Why
    unique: evidentiary replay years later.
47. **Backoff health board** — per-IP/domain backoff state visible live. Why
    unique: operators see the throttle, not just the queue depth.
48. **Raw-dialect bounce codes** — verbatim SMTP reply preserved alongside the
    classified bounce. Why unique: our taxonomy is auditable against reality.
49. **Hash-chained audit log** — policy/suppression/send events hash-chained.
    Why unique: tamper-evident proof for legal teams.
50. **Mirror fanout to warehouse** — ClickHouse → customer webhook/S3 mirror.
    Why unique: your data, streaming, no export ticket.

## E — Compliance, security & trust (51–63)

51. **Versioned policy packs [BET]** — jurisdiction/consent/AUP rules versioned
    and pinned per campaign. Why unique: prove *which law version* gated a send.
52. **Asymmetric-resolver verification** — verification SMTP checks run from
    dedicated IPs, never burning sender reputation. Why unique: verify without
    poisoning the pool.
53. **Per-contact consent ledger** — every address carries lawful-basis history,
    append-only. Why unique: GDPR answers in one query.
54. **Send/block gate with reason codes** — BLOCKED_BY_POLICY with machine
    reason, never silent skip. Why unique: E15-005 as a product promise.
55. **Three-layer suppression (global/org/person)** — pre-send check across all
    three, fail-closed. Why unique: suppression is invariant I-guarded, not a
    checkbox.
56. **Erasure that keeps the hash** — GDPR erase drops plaintext, retains salted
    hash so re-imports stay suppressed. Why unique: forgetful *and* safe.
57. **Atomic 60s unsubscribe** — one-click RFC 8058 unsub propagates within 60s
    across all campaigns. Why unique: tested, timed, contractual.
58. **Ambiguous-means-suppressed** — fuzzy/role/disposable verdicts default to
    suppression, not send. Why unique: false-valid rate published (Phase 2 gate).
59. **Chained evidence packets** — each send bundles policy version, suppression
    proof, verification verdict. Why unique: a per-send legal exhibit.
60. **KYC-gated sending** — new orgs pass KYB/AUP screening before first
    emit. Why unique: keeps the fleet clean; abuse screening ships with the
    send path, per AGENTS.md.
61. **Auto-pause breakers on complaints** — complaint-rate breaker per domain
    with operator-resume required. Why unique: reputation firewall.
62. **72h DSR auto-fulfilment** — access/erasure requests fulfilled from the
    ledger within 72h. Why unique: privacy as a feature, not a ticket queue.
63. **Refused-capability list in-product** — no open tracking by default, no
    newsletter mode, no warmup pool — shown with reasons. Why unique: VISION §7
    enforced in UI, a moat of refusal.

## F — White-label fleet multi-tenancy & agency model (64–76)

64. **Scoped keys per project [BET]** — API keys scoped to org/project/mailbox
    set with least privilege. Why unique: client keys that can't cross tenants.
65. **Per-client DKIM selectors** — each sub-brand signs under its own
    selector/domain. Why unique: reputation isolation per client on shared iron.
66. **Per-client tracking domains** — click/open (opt-in) under client domains.
    Why unique: white-label down to the pixel URL.
67. **Per-project secrets vault** — SMTP/DNS/API secrets namespaced per
    project, never global. Why unique: evacuate one client without touching
    the fleet.
68. **Cost-plus markup billing [BET]** — agency sets margin over measured
    infra cost per client. Why unique: margin math from real metering, not
    seat pass-through.
69. **Brand-blind operator roles** — staff see only assigned client brands.
    Why unique: true multi-brand operations.
70. **Custom-domain client portal** — `mail.client.com` portal with their logo,
    our iron. Why unique: the agency *is* the ESP to their client.
71. **One-command client evacuation** — move a client's domains/mailboxes to
    quarantine IPs on abuse signal. Why unique: firewall a bad client in
    seconds, save the fleet.
72. **Branded unsub pages** — per-client unsub/privacy pages with signed URLs.
    Why unique: compliance that carries the client's brand.
73. **Locked template blocks** — agency locks footer/legal blocks; clients edit
    only body. Why unique: CAN-SPAM safety under delegation.
74. **Signed SOC2 evidence pack** — per-client audit export (sends, suppressions,
    policy versions). Why unique: enterprise deals without a security marathon.
75. **Prepaid client wallets** — per-client credit wallets with low-balance
    auto-pause. Why unique: agencies never front infra cost.
76. **Sub-brand warmup pools (isolated)** — per-client warmup that never mixes
    reputations across clients. Why unique: D-decision (no cross-customer pool)
    as architecture.

## G — Pricing, packaging & marketplace moats (77–88)

77. **Pay-per-verified-delivered [BET]** — billing on maillog-250 deliveries,
    not API accepts. Why unique: we charge for what actually delivered.
78. **Subdomain-based free tier** — free tier on shared subdomains with strict
    caps; paid unlocks root domains. Why unique: free without risking paid
    reputations.
79. **Scored template marketplace** — community sequences ranked by measured
    reply rate, not likes. Why unique: templates with audited outcomes.
80. **Sub-billing with markup lines** — client invoices show usage + agency
    margin lines from metering. Why unique: Stripe BillingProvider seam doing
    agency math.
81. **BYO-iron flat fee** — run EMS on the customer's Hostinger box for a flat
    fee. Why unique: portable fleet, honest for regulated clients.
82. **Pay-per-clean-save verification** — verification billed only when it
    prevents a bounce. Why unique: value-priced data hygiene.
83. **Auto-credit on false-verdict** — misclassified bounces/placements credit
    automatically. Why unique: honesty as a billing rule.
84. **Warmup-as-SKU** — warmup sold standalone for external domains. Why unique:
    monetizes the engine without selling sends.
85. **Placement bounty** — beat the agreed placement SLA, earn credits; miss it,
    get credited. Why unique: SLA with teeth both ways.
86. **One-call offer packs as SKUs** — buy a vetted ICP+offer pack per
    vertical. Why unique: productized GTM, not consulting.
87. **2x rollover reputation credits** — unused send credits roll over 2x if
    complaint rate stays clean. Why unique: rewards good behavior, prices bad.
88. **Project-cap kill switch** — hard spend/suppression caps per project with
    instant halt. Why unique: finance-safe cold outreach.

## H — Workflow, automation & integrations (89–100)

89. **Halt-on-any-signal triggers** — reply/bounce/complaint/unsub stops all
    campaigns for the person (and optionally company) in seconds. Why unique:
    E15-018/019 as a platform guarantee.
90. **Native Resend bridge** — Resend-compatible surface for transactional
    overflow, routed to separate iron. Why unique: acquisition + lifecycle
    without mixing reputations.
91. **Per-tenant BullMQ lanes [BET]** — queue lanes per org with fair-share
    scheduling; one tenant can't starve others. Why unique: noisy-neighbor-proof
    sending.
92. **Persistent replay log** — every intent transition persisted; replay any
    hour after an outage. Why unique: ClickHouse-down never loses a send.
93. **Diffable automation graphs** — visual sequences stored as diffable JSON
    with code review. Why unique: Git for outreach logic.
94. **Self-deferring windows** — intents defer themselves to the next legal
    window/timezone without worker churn. Why unique: timezone-correct at scale.
95. **tRPC-Zod form-to-API parity** — dashboard forms and API share Zod
    schemas; validation identical. Why unique: UI and API can't disagree.
96. **7-day dry-run simulator** — simulate a campaign week's volume, reputation
    burn, and capacity before launch. Why unique: launch with a forecast, not
    a prayer.
97. **Screened enrolment gates** — enrolment re-checks jurisdiction,
    suppression, and capacity (E15-004). Why unique: double-gated, both logged.
98. **Branch-on-bounce playbooks** — bounce clusters trigger domain pause +
    list-cleaning task automatically. Why unique: failure becomes workflow.
99. **Forkable offer packs** — clone any pack/campaign as code with pinned
    versions. Why unique: agency IP that compounds.
100. **Atomic cron+event scheduler [BET]** — dueAt claims via fencing token;
     race-harness proven, no cap overflow. Why unique: the Phase 1 gate as a
     permanent property.

