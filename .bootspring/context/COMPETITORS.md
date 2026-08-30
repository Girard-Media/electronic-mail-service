# Competitors — EMS

| Product | Model | Structural weakness we exploit |
|---|---|---|
| **Instantly** | Resells Google/Microsoft mailboxes + a warmup pool | Rents the sending path, so `sent` is a vendor counter. Pool warmup is detectable and shared-fate. |
| **Smartlead** | Same, plus unified inbox | Same rented path. Strong UX, no infrastructure story. |
| **Lemlist** | Sequences + personalisation, rented mailboxes | Weakest deliverability surface; sells creativity, not placement. |
| **Apollo** | Data + sequencing bundled | Data is the product; sending is a feature, and shared-pool reputation is opaque. |
| **Woodpecker / QuickMail / Reply** | Mature sequencers on rented paths | Same ceiling. Long-tenured, slow to change architecture. |
| **Salesforge** | AI-first copy | Copy is not the constraint; placement is. |

## The one claim none of them can make

> "Our `delivered` is the receiving MX's 250, read from our own mail log."

Everything else — sequences, inbox, personalisation — is table stakes we must
match. The infrastructure claim is the only durable one, and it is only credible
if we publish our own measured placement and let people check the methodology.

## What they do better, and we should copy without shame
- Instantly's onboarding speed (we cannot match it — warmup is physics — but we
  can be honest about the wait and make the countdown itself feel like progress).
- Smartlead's unified inbox ergonomics.
- Apollo's list-building convenience, insofar as provenance allows it.

## Where we deliberately do not compete
Purchased-data marketplaces. We will not be a source of unsourced contact data.
