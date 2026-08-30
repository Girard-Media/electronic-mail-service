# EMS — Compliance Architecture

Compliance is implemented as a **gate in the send path**, not as guidance in a help article. `packages/policy` can block any message and its decisions are immutable.

---

## 1. The legal map for unsolicited B2B email

| Jurisdiction | Law | Regime | Default in EMS |
|---|---|---|---|
| **United States** | CAN-SPAM Act 2003 | **Opt-out** | **ALLOW** with mandatory elements |
| **Canada** | CASL 2014 | Opt-in (narrow B2B implied consent) | **BLOCK** unless consent basis recorded |
| **EU / EEA** | GDPR + ePrivacy Directive | Member-state split; legitimate interest arguable B2B | **BLOCK** unless LIA + basis recorded |
| **United Kingdom** | UK GDPR + PECR | B2B corporate subscribers permitted with opt-out | **ALLOW-WITH-BASIS** (corporate, non-sole-trader) |
| **Australia** | Spam Act 2003 | Opt-in / inferred consent (published business address) | **ALLOW-WITH-BASIS** (inferred consent path) |
| **Germany** | UWG §7 | Strict; prior express consent | **BLOCK** |
| **France** | CNIL B2B guidance | B2B permitted, professional address, relevant to role | **ALLOW-WITH-BASIS** |
| **Netherlands / Spain / Italy / Poland** | national implementations | Varies | **BLOCK** pending per-country rule row |
| **Everything else** | — | Unknown | **BLOCK** |

> These rows are **configuration, not code** — a `JurisdictionPolicy` table, versioned, with an effective date and a citation field, reviewable by counsel without a deploy. Nothing above is legal advice; the product's job is to make the rule explicit, enforce it, and prove what it did.

### 1.1 CAN-SPAM mandatory elements (enforced, not suggested)

Every US-bound message must have all of these or it does not send:

1. Accurate `From`, `Reply-To`, and routing headers — **no forgery, ever**.
2. A subject line that does not misrepresent the content.
3. Identification as a commercial/advertising message.
4. A **valid physical postal address** for the sender.
5. A clear, functioning opt-out mechanism.
6. Opt-outs honored within **10 business days** — EMS honors them in **under 60 seconds**.
7. No sending to an address that has opted out.
8. Liability is not transferable — the customer *and* we are on the hook, which is why KYC is mandatory.

Implementation: `policy.validateMessage()` runs after composition and before scoring. A missing postal address is a hard block with a specific error, not a warning.

---

## 2. The jurisdiction resolver

Order of precedence, first confident answer wins, confidence recorded:

1. **Declared** — the customer supplied a country on the lead, with a source.
2. **Company record** — enriched HQ country.
3. **ccTLD** — `.de`, `.ca`, `.com.au` are strong signals.
4. **MX / A-record geolocation** — weak, used only to *raise* strictness, never to lower it.
5. **Unresolved** → **BLOCK**.

**Asymmetry rule:** a weak signal may make the policy *stricter* but may never make it *looser*. If TLD says `.com` (ambiguous) and MX geo says Germany, the message is treated as German.

---

## 3. Consent and lawful basis ledger

Every contact carries zero or more `ConsentRecord` rows:

| Field | Purpose |
|---|---|
| `basis` | `LEGITIMATE_INTEREST` \| `IMPLIED_B2B` \| `EXPRESS_OPT_IN` \| `PUBLISHED_ADDRESS` \| `EXISTING_RELATIONSHIP` |
| `source` | Where it came from — URL, event, import batch, form |
| `evidenceUrl` | Link to the artifact (R2 object) |
| `attestedBy` | The user who attested, with timestamp and IP |
| `lia` | Legitimate Interest Assessment record, for GDPR bases |
| `expiresAt` | CASL implied consent is time-boxed (6 or 24 months) |
| `revokedAt` | Set on any unsubscribe or objection |

**Import gate:** a list cannot be activated for sending until every row resolves to a jurisdiction *and* an allowed basis. The importer produces a per-batch compliance report showing exactly how many rows are sendable, blocked, and why. This artifact is downloadable — it is what a customer's legal team asks for.

---

## 4. Suppression

Three layers, all checked, all enforced below the application:

1. **Global** — platform-wide. Complaints, spam-trap hits, abuse reports, legal demands, our own employees, competitor domains, `.gov`/`.mil` blocks. **No tenant can override.**
2. **Organization** — the customer's own suppression across all their workspaces.
3. **Domain/role** — `abuse@`, `postmaster@`, `security@`, plus customer-specified blocked domains.

Backed by Postgres, mirrored to a Valkey set + bloom filter for the hot path, re-checked immediately before emit. Unsubscribe writes to Postgres **and** invalidates the Valkey entry synchronously; the emit path fails closed on a Valkey miss (falls back to Postgres rather than assuming allowed).

**Retention:** suppression records are permanent. Deleting a lead does not delete their suppression — that is the one thing a GDPR erasure request must preserve (as a hash), because re-mailing them would be the greater harm.

---

## 5. Unsubscribe

- **RFC 8058 one-click**: `List-Unsubscribe: <mailto:…>, <https://…>` **and** `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Both required — Google and Yahoo mandate it for bulk senders and it is a placement factor.
- The HTTPS endpoint honors `POST` without confirmation, without login, and without a landing page interstitial.
- A visible unsubscribe link in the body, in readable contrast, not hidden in a 6px footer. **Hiding it is a refused feature.**
- Unsubscribe → suppression → sequence stop → all campaigns for that person stop → confirmation, in one transaction.
- Reply-based unsubscribe: the AI reply classifier detects "remove me"/"unsubscribe"/"stop" and suppresses automatically, with a human-review queue for ambiguous cases. **Ambiguous defaults to suppressing.**

---

## 6. Customer trust and abuse (KYC/AUP)

We are the sender of record on our IPs. One abusive customer damages every other customer.

**Before the first live send:**
1. Verified business identity — legal name, registration, website, verified postal address.
2. Verified ownership of any domain they want to send from (DNS TXT challenge).
3. Signed AUP.
4. A description of their list source, retained.
5. Payment method on file (a weak but real identity signal).

**Continuous:**
- Complaint rate > 0.1% → automatic campaign pause + review.
- Hard bounce rate > 5% → automatic list quarantine + re-verification required.
- Spam-trap hit → immediate stop, manual review, no self-serve resume.
- Content screening on campaign creation (AI + rules) for prohibited categories.
- Per-tenant reputation accounting so damage is attributable, and shared-pool tenants can be evicted to an isolated pool.

**Prohibited content** (blocked at campaign creation): adult, gambling, crypto/token promotion, pharma, weapons, MLM, payday/debt relief, forex/binary options, guaranteed-return investment claims, anything impersonating a person or brand. This list is a table, editable by an operator, versioned.

---

## 7. Data subject rights

| Right | Implementation | SLA |
|---|---|---|
| Access (Art. 15) | Export job → signed R2 URL | 72h automated |
| Rectification (16) | Lead edit + audit | immediate |
| Erasure (17) | Purge job; suppression hash retained | 72h automated |
| Objection (21) | = unsubscribe + permanent suppression | <60s |
| Portability (20) | JSON/CSV export | 72h |
| Restriction (18) | Lead freeze flag; router excludes | immediate |

Inherited from usermails' `packages/core/src/privacy.ts` and `apps/api/src/routes/privacy.ts`, extended to the lead/campaign domain. Every request is logged, timed, and reportable.

---

## 8. Audit trail

Append-only `PolicyDecision` and `AuditLog` tables. Every send records:

```
{ intentId, leadId, campaignId, jurisdiction, jurisdictionSource, jurisdictionConfidence,
  consentBasis, consentRecordId, suppressionChecks[], contentScore, policyVersion,
  decision: ALLOW|BLOCK|REQUIRE_BASIS, reasons[], at, actor }
```

Periodically snapshotted to R2 with a hash chain so tampering is detectable. **The question "prove you were allowed to send that" must be answerable in one query, a year later.**

---

## 9. Deliberately refused capabilities

Restating so they are never quietly added:

| Refused | Why |
|---|---|
| Header/From forgery, domain spoofing | Fraud; illegal under CAN-SPAM §5(a)(1) |
| `RE:` / `FW:` on a first-touch subject | Deceptive subject line; illegal and detectable |
| Invisible text, homoglyphs, zero-width padding, image-only bodies to defeat scanners | Filter evasion, not deliverability |
| Hidden/broken/delayed unsubscribe | Illegal, and the fastest route to a complaint spike |
| Fake engagement pools across strangers' mailboxes | Shared-fate liability; increasingly penalized |
| Scraping behind auth walls / ToS-violating harvesting | Legal exposure and garbage data |
| Sending for an unidentified customer | We are the sender of record |
| Ingesting a purchased list with no stated provenance | The single largest source of spam-trap hits |

The distinction we hold: **every deliverability feature we build is what a good sender does** — authenticate, warm up, pace, keep lists clean, honor opt-outs, monitor reputation. We do not build tools whose purpose is to make spam look like non-spam.
