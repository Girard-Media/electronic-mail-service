# Vision — Electronic Mail Services

> Canonical source: `planning/VISION.md`. This is the agent-facing summary.

**Cold B2B outreach infrastructure that we own end to end** — our metal, our IPs,
our MTA, our mail log. That ownership *is* the product: it is why `delivered`
means the receiving MX returned 250, read from our own Postfix log, rather than
a vendor's optimistic counter.

## The reframe

To send 1,000 cold emails a day you need ~30 healthy mailboxes across ~12 domains,
because a mailbox plateaus at 30–50/day for cold traffic. So this is not a "send a
lot of mail" product. It is a fleet-management and scheduling system that happens
to emit email — closer to Kubernetes than to Mailchimp.

**Reputation is the scarce resource.** Every campaign burns it; warmup and good
behaviour regenerate it. The product is a reputation budget allocator.

## Why incumbents cannot copy this

Instantly, Smartlead, Lemlist, Apollo and the rest resell Google/Microsoft
mailboxes or third-party SMTP. They rent the mailbox, the IP, the MTA, the
reputation and the economics. They see "accepted by Google," never "delivered by
the receiving MX" — so bounce classification is guesswork and per-IP warmup is
impossible.

## Scope boundary — enforce this

EMS is acquisition. **usermails is lifecycle.** The moment a lead opts in they
leave EMS via the handoff. Do not add opt-in marketing features here.

## Refused, permanently

Header forgery · domain spoofing · open relay · `RE:` on a first touch ·
invisible text, homoglyphs, zero-width padding · hidden or delayed unsubscribes ·
cross-customer fake-engagement warmup pools · lists with no provenance · sending
for an unidentified customer · a score we cannot decompose.

The line: every deliverability feature here is what a *good* sender does. We do
not build tools whose purpose is to defeat a filter that correctly identified spam.
