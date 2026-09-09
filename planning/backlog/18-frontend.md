# Epic 18 — Frontend: The Four Cockpits

Next.js 15 App Router per gm-stack, held to app-feel standards.
Infrastructure and Deliverability are the differentiated surfaces and get the design investment.
The campaign builder should be plain and fast, not clever.

## Foundation
- [ ] E18-001 — Strip the inherited usermails marketing pages from apps/web
- [ ] E18-002 — Establish the EMS design tokens: colour, type scale, spacing, radius, elevation
- [ ] E18-003 — Define the light and dark palettes on :root with a documented contrast floor
- [ ] E18-004 — Build the layout shell: sidebar, top bar, workspace switcher, command palette
- [ ] E18-005 — Implement the command palette with fuzzy search across every entity
- [ ] E18-006 — Implement global keyboard shortcuts with a discoverable help sheet
- [ ] E18-007 — Establish the data layer: cached, deduped, no fetch-on-mount waterfalls
- [ ] E18-008 — Forbid per-row fetching in any list; batch at the route
- [ ] E18-009 — Add a lint rule catching fetch-on-mount in a component
- [ ] E18-010 — Implement optimistic mutations with rollback across every write surface
- [ ] E18-011 — Implement honest loading states: skeletons matching the real layout, no spinners over content
- [ ] E18-012 — Implement empty states that explain what will appear and how to make it appear
- [ ] E18-013 — Implement error states with the actual error and a route to resolution
- [ ] E18-014 — Never dead-end a navigation; every screen has a way forward
- [ ] E18-015 — Implement the SSE client for realtime updates with reconnection
- [ ] E18-016 — Implement stale-while-revalidate on every list
- [ ] E18-017 — Implement route-level prefetch on hover for the common paths
- [ ] E18-018 — Measure and budget first contentful paint per route
- [ ] E18-019 — Measure and budget interaction-to-next-paint per route
- [ ] E18-020 — Fail CI on a performance budget regression
- [ ] E18-021 — Implement responsive layouts down to mobile for the inbox and campaign views
- [ ] E18-022 — Implement full keyboard navigation and visible focus rings
- [ ] E18-023 — Meet WCAG AA contrast on every token pair
- [ ] E18-024 — Add screen-reader labels on every icon-only control
- [ ] E18-025 — Add an automated accessibility check to CI
- [ ] E18-026 — Implement the toast and notification system with a persistent activity feed
- [ ] E18-027 — Never show a toast as the only record of an important event
- [ ] E18-028 — Implement the confirmation pattern for destructive actions showing the exact impact
- [ ] E18-029 — Require typing the resource name for irreversible fleet actions
- [ ] E18-030 — Implement undo where the action is reversible

## Infrastructure cockpit
- [ ] E18-031 — Build the fleet overview: nodes, IPs, domains, mailboxes, headroom, health on one screen
- [ ] E18-032 — Make fleet overview the operator landing page
- [ ] E18-033 — Build the node list with capacity utilisation
- [ ] E18-034 — Build the node detail with status, IPs, queue, health, and provisioning transcript
- [ ] E18-035 — Build the IP list with listing status across every DNSBL
- [ ] E18-036 — Build the IP detail with the reputation series and recent transactions
- [ ] E18-037 — Build the domain list sortable by health, age, and capacity
- [ ] E18-038 — Build the domain detail with auth status, warmup, caps, and reputation
- [ ] E18-039 — Build the DNS desired-versus-live diff view with a one-click repair
- [ ] E18-040 — Build the mailbox list with warmup progress and headroom
- [ ] E18-041 — Build the mailbox detail with the warmup curve and recent sends
- [ ] E18-042 — Build the persona editor with postal-address validation
- [ ] E18-043 — Build the warmup calendar across the whole fleet
- [ ] E18-044 — Build the capacity planner with the current fleet plugged in
- [ ] E18-045 — Build the fleet event feed in real time
- [ ] E18-046 — Build the provisioning flow with a live progress stream
- [ ] E18-047 — Build the bulk domain purchase flow behind an approval and a spend cap
- [ ] E18-048 — Build the bulk mailbox creation flow
- [ ] E18-049 — Build the drain, pause, quarantine, and retire actions with impact preview
- [ ] E18-050 — Build the global kill switch with two-person confirmation to lift
- [ ] E18-051 — Build fleet search across every identifier
- [ ] E18-052 — Build saved views and tagging across fleet resources
- [ ] E18-053 — Build the fleet onboarding checklist for a new org
- [ ] E18-054 — Build the node comparison view

## Deliverability cockpit
- [ ] E18-055 — Build the cockpit information architecture leading with placement
- [ ] E18-056 — Build the placement tile per provider with folder breakdown and sample size
- [ ] E18-057 — Build the delivered, deferred, and bounced tiles with sources labelled
- [ ] E18-058 — Build the per-ESP breakdown as the primary decomposition
- [ ] E18-059 — Build the five reputation series on one annotated timeline
- [ ] E18-060 — Make timeline annotations clickable through to the evidence
- [ ] E18-061 — Build the listings panel, unmissable when anything is listed
- [ ] E18-062 — Build the DMARC alignment view with sources and disposition
- [ ] E18-063 — Build the TLS health view
- [ ] E18-064 — Build the bounce explorer with verbatim responses
- [ ] E18-065 — Build the reclassification action feeding a rule proposal
- [ ] E18-066 — Build the placement test runner with live seed results
- [ ] E18-067 — Build the placement comparison across domains and across content
- [ ] E18-068 — Build the reputation delta view ranking contributing factors
- [ ] E18-069 — Build the remediation history view
- [ ] E18-070 — Build the AI deliverability advisor panel grounded in the shown metrics
- [ ] E18-071 — Show the underlying numbers alongside every narration
- [ ] E18-072 — Show window, sample size, and source on every metric
- [ ] E18-073 — Add a confidence indicator on small samples
- [ ] E18-074 — Build the message journey view: intent, route, submit, log lines, events
- [ ] E18-075 — Make the journey view permanently linkable for support
- [ ] E18-076 — Build the live transaction stream with filters and response search
- [ ] E18-077 — Build the weekly digest preview in-app

## Campaign cockpit
- [ ] E18-078 — Build the campaign list with status, progress, and health
- [ ] E18-078a — Campaign create/detail: attach domains and mailboxes via `PUT /app/campaigns/:id/mailboxes` (API already ships)
- [ ] E18-079 — Build the campaign creation wizard as a linear flow
- [ ] E18-080 — Build the sequence editor, plain-text-first
- [ ] E18-081 — Show the live spam-signal score as the user types
- [ ] E18-082 — Show the exact rendered message including the footer
- [ ] E18-083 — Preview against a real lead's data
- [ ] E18-084 — Show unresolvable personalisation tokens before launch
- [ ] E18-085 — Build the spintax editor with rendered variations
- [ ] E18-086 — Build the variable palette from the list's real fields
- [ ] E18-087 — Build the AI copy panel presenting drafts for acceptance
- [ ] E18-088 — Build the subject-variant panel with per-variant risk
- [ ] E18-089 — Build the schedule editor with the projected send curve
- [ ] E18-090 — Show the projected completion date and the binding constraint
- [ ] E18-091 — Build the what-if tool for added capacity
- [ ] E18-092 — Build the pre-launch checklist with every item linked to its fix
- [ ] E18-093 — Build the soft-launch flow with results before full send
- [ ] E18-094 — Build the campaign detail leading with replies
- [ ] E18-095 — Build the funnel with every number sourced
- [ ] E18-096 — Build the variant comparison with confidence intervals
- [ ] E18-097 — Build the per-mailbox and per-ESP performance breakdown
- [ ] E18-098 — Build the enrolment list with per-lead state and next due time
- [ ] E18-099 — Build the per-lead "why has this not sent yet" explainer
- [ ] E18-100 — Build the issues panel ranked by leads affected
- [ ] E18-101 — Build the campaign cost view with cost per positive reply
- [ ] E18-102 — Build the benchmark comparison against anonymised platform medians
- [ ] E18-103 — Build the campaign duplication and template flows

## Lead surfaces
- [ ] E18-104 — Build the import wizard with mapping, preview, and reversibility
- [ ] E18-105 — Build the compliance gate screen showing sendable, blocked, and why
- [ ] E18-106 — Build the downloadable compliance report action
- [ ] E18-107 — Build the list view with import status and compliance state
- [ ] E18-108 — Build the lead detail with fields, consent, verification, campaigns, and threads
- [ ] E18-109 — Build the lead timeline linking every entry to its evidence
- [ ] E18-110 — Build the segment builder with a live count
- [ ] E18-111 — Build lead search with sub-second response
- [ ] E18-112 — Build bulk lead actions with exact counts and undo
- [ ] E18-113 — Build the duplicate review and merge screen
- [ ] E18-114 — Build the company view across all leads at one company
- [ ] E18-115 — Build the do-not-contact management screen
- [ ] E18-116 — Build the enrichment review screen showing every source

## Inbox
- [ ] E18-117 — Build the unified inbox defaulting to interested first
- [ ] E18-118 — Build the thread view with lead context alongside
- [ ] E18-119 — Build the classification chip with a one-click correction
- [ ] E18-120 — Build the reply composer sending from the receiving mailbox
- [ ] E18-121 — Build the AI reply-draft panel requiring acceptance
- [ ] E18-122 — Build assignment, snooze, close, and archive controls
- [ ] E18-123 — Build the unassigned queue with an SLA timer
- [ ] E18-124 — Build internal notes and mentions
- [ ] E18-125 — Build realtime new-reply updates over SSE
- [ ] E18-126 — Build inbox keyboard navigation and bulk actions
- [ ] E18-127 — Build inbox search across every thread
- [ ] E18-128 — Build the mobile inbox layout
- [ ] E18-129 — Build the handoff action with inline status
- [ ] E18-130 — Build the meeting-booked outcome control

## Admin, settings, and platform
- [ ] E18-131 — Build the workspace switcher with keyboard access
- [ ] E18-132 — Build team management with roles and invites
- [ ] E18-133 — Build API key management with scoping
- [ ] E18-134 — Build webhook endpoint management with delivery history
- [ ] E18-135 — Build the billing and usage screen
- [ ] E18-136 — Build the plan comparison and upgrade flow
- [ ] E18-137 — Build the AI usage and opt-out screen
- [ ] E18-138 — Build the org profile with the postal address used in footers
- [ ] E18-139 — Build the KYC submission flow
- [ ] E18-140 — Build the audit log viewer
- [ ] E18-141 — Build the data export and erasure request screens
- [ ] E18-142 — Build the notification preferences screen
- [ ] E18-143 — Build the security screen with sessions and TOTP
- [ ] E18-144 — Build the platform admin console for operators
- [ ] E18-145 — Build the KYC review queue in the admin console
- [ ] E18-146 — Build the abuse case view in the admin console
- [ ] E18-147 — Build the policy table admin view for counsel
- [ ] E18-148 — Build the bounce rule admin with proposal approval
- [ ] E18-149 — Build the AI task configuration admin
- [ ] E18-150 — Build the impersonation flow gated behind TOTP and fully audited

## Marketing site
- [ ] E18-151 — Build the homepage leading with the owned-infrastructure claim
- [ ] E18-152 — Build the deliverability page with our own live measured numbers
- [ ] E18-153 — Never publish a number on the marketing site we did not measure this week
- [ ] E18-154 — Build the methodology page every published number links to
- [ ] E18-155 — Build the comparison page against Instantly, Smartlead, and Lemlist on structure not adjectives
- [ ] E18-156 — Build the pricing page with the real plan limits
- [ ] E18-157 — Build the compliance posture page for prospects' counsel
- [ ] E18-158 — Build the security page with the actual controls
- [ ] E18-159 — Build the docs site covering every subsystem
- [ ] E18-160 — Build the changelog generated from releases
- [ ] E18-161 — Build the status page fed by real health checks
- [ ] E18-162 — Build the blog with the inherited CMS retargeted
- [ ] E18-163 — Add structured data and sitemap generation
- [ ] E18-164 — Add OG images generated per page
- [ ] E18-165 — Meet the performance budget on every marketing route
- [ ] E18-166 — Build the signup flow with the KYC gate placed honestly
- [ ] E18-167 — Build the onboarding sequence explaining the warmup wait on day one
- [ ] E18-168 — Show a countdown to first safe send with the reason for the wait
- [ ] E18-169 — Never let onboarding imply sending can start today
- [ ] E18-170 — Build the demo mode with fabricated data clearly labelled as such
- [ ] E18-171 — Add a self-serve trial that provisions a real warmed shared mailbox
- [ ] E18-172 — Never give a trial account access to a dedicated IP
- [ ] E18-173 — Build the white-label tenant surface reusing the inherited subdomain proxy
- [ ] E18-174 — Build the reseller sub-tenant switcher
- [ ] E18-175 — Build the customisable branding screen
- [ ] E18-176 — Test the white-label surface end to end on a real subdomain
- [ ] E18-177 — Add the design-system documentation page for internal use
- [ ] E18-178 — Add visual regression tests on the ten most important screens
- [ ] E18-179 — Add an interaction test suite covering the critical flows
- [ ] E18-180 — Run the whole frontend against a slow-network profile and fix what breaks
- [ ] E18-181 — Run the whole frontend against a screen reader and fix what breaks
- [ ] E18-182 — Audit every screen against the app-feel checklist and record the result
- [ ] E18-183 — Remove every screen that exists but does nothing useful
- [ ] E18-184 — Verify no screen displays a number without a traceable source
- [ ] E18-185 — Add a design review gate before any new cockpit screen ships
