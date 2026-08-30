# Market — EMS

## Shape
Cold outbound tooling is a crowded, feature-converged market with a hard physical
floor nobody has built to: inbox placement at low per-mailbox volume across many
domains. Every incumbent competes on sequencer ergonomics and AI copy, which are
not the binding constraint.

## The wedge
Receivers tightened materially in 2024–2026: Google and Yahoo's bulk-sender
requirements made authentication, one-click unsubscribe and complaint-rate
thresholds mandatory rather than advisory. Apple MPP destroyed open rates as a
signal. The combined effect is that **infrastructure quality now determines
outcomes more than copy does** — and it is the thing every incumbent outsources.

## Timing
Buying and operating your own MTA fleet became tractable for a small team only
recently: cheap KVM VPS with rDNS control, mature Postfix/OpenDKIM/rspamd, and
cheap columnar storage for the telemetry. We already run the fleet for usermails,
so the marginal cost of doing it again for outreach is one box.

## Risk
The same tightening that creates the wedge could go further — if receivers move to
effectively requiring established-domain reputation, the cold-outreach category
shrinks regardless of who owns the infrastructure. That is a category risk we
accept and monitor, not one we can engineer around.
