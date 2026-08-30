# EMS — AI Layer

**Provider:** OpenRouter (the one sanctioned inference dependency).
**Package:** `packages/ai`. **One entry point:** `ai.run(taskId, input, ctx)`.

---

## 1. Non-negotiable rules

1. **No AI call from a route handler.** Routes enqueue; workers call.
2. **Every task has a Zod output schema.** Invalid output → one retry with a repair prompt → deterministic fallback → task marked degraded. Never a crash, never an unvalidated value in the send path.
3. **Prompts are versioned files** under `packages/ai/prompts/<task>/<version>.md`. Changing a prompt is a code change with an eval run.
4. **Every call is metered** — `taskId`, `promptVersion`, `model`, `inputTokens`, `outputTokens`, `costUsd`, `latencyMs`, `cacheHit` — into ClickHouse.
5. **Budgets are enforced before the call**, per org and per task class, with a hard monthly ceiling and a documented degraded mode per task.
6. **AI is never the last word on a compliance or send decision.** It advises; `policy` and `router` decide. An AI outage must not stop sending.
7. **PII minimization** — send the least lead data that makes the task work. Per-org AI opt-out disables the feature visibly rather than degrading it silently.

---

## 2. Model routing by task class

| Class | Latency need | Model tier | Examples |
|---|---|---|---|
| **Classify** | <2s, high volume | small/fast | reply classification, bounce categorization, ICP fit |
| **Generate** | <20s, low volume | strong | sequence copy, subject variants, personalization |
| **Reason** | <60s, rare | strongest | deliverability root-cause, sequence optimization proposals |
| **Embed** | batch | embedding | lead dedupe, similar-reply clustering, content-fingerprint neighbors |

Routing is a table (`AiTaskConfig`) with a model id, temperature, max tokens, timeout, and fallback chain per task. **An operator can re-route a task to a cheaper model without a deploy.** A model deprecation is a config change.

---

## 3. The eleven load-bearing tasks

| # | Task | In → Out | Fallback if AI unavailable |
|---|---|---|---|
| 1 | `copy.sequence` | ICP + offer + tone → 3–5 step sequence draft | Template library |
| 2 | `copy.subjects` | body + ICP → 10 subject variants + risk score | Template library + rules scorer |
| 3 | `risk.content` | composed body → risk score + specific reasons | rspamd score alone |
| 4 | `personalize.line` | lead + public signals → one opening line | Skip the token; send without |
| 5 | `classify.reply` | inbound message → {interested, not_interested, ooo, referral, unsubscribe, auto_reply, bounce, other} + confidence | Rules on keywords; route ambiguous to human |
| 6 | `classify.bounce` | SMTP response string → BounceClass | Taxonomy table (primary); AI only for `unknown` |
| 7 | `advise.deliverability` | metric window + events → root cause narrative + ranked actions | Show the raw metrics |
| 8 | `optimize.sequence` | outcome data → proposed changes with rationale | Disabled |
| 9 | `score.lead` | lead + ICP → fit score + reason | Rules on firmographics |
| 10 | `check.compliance` | draft + jurisdiction → flagged claims/omissions | Rules checklist (primary gate anyway) |
| 11 | `narrate.anomaly` | infra event series → plain-language incident summary | Raw event list |

**Note on #6:** the deterministic taxonomy table is the primary classifier. AI runs only on responses the table does not match, and its output becomes a *proposed new table row* for operator approval — so the system gets deterministically better over time instead of permanently depending on inference.

**Note on #3 and #10:** these advise. `rspamd` and the rules checklist are the gates. An AI risk score can *lower* a send's priority but only deterministic rules can *block* it.

---

## 4. Caching

Key: `sha256(taskId + promptVersion + model + normalizedInput)`. Stored in Valkey with a per-task TTL; large outputs in R2 with the key in Valkey.

Classification tasks cache aggressively (an identical OOO auto-reply body recurs constantly). Generation tasks cache only for idempotent retries. **Target: >40% hit rate on classify-class tasks within 30 days.**

---

## 5. Eval harness

`packages/ai/evals/<task>/` — fixtures with expected outputs and scored assertions.

```
pnpm ai:eval                # all tasks
pnpm ai:eval classify.reply # one task
```

- Classification tasks: labeled fixture set, scored on accuracy + confusion matrix. Gate: **≥92% accuracy, no class below 80% recall.**
- Generation tasks: rubric-scored by a judge model plus hard assertions (no banned phrases, has CTA, under length, no fabricated claims, includes required footer tokens).
- Reasoning tasks: assertions that the named root cause appears in the output for a fixture with a known cause.

**CI gate:** a prompt or model change that regresses any task's score fails the build. Fixtures grow from production `unknown`/low-confidence cases, which are queued for human labeling.

---

## 6. Cost control

- Per-org monthly token budget by plan; per-task-class sub-budgets.
- Pre-call estimate; refuse and enqueue-for-later if it would breach.
- Degraded mode per task (see the fallback column) — never a hard failure of the app.
- Nightly cost report per org, per task, with a cost-per-1k-sends metric on the dashboard.
- **Target: < $0.40 of inference per 1,000 sends.** If a task blows that, it gets re-routed to a smaller model or replaced with rules.

---

## 7. Prompt-injection posture

Inbound replies and scraped enrichment text are **untrusted input**. Rules:

- All untrusted content is wrapped in explicit delimiters and the system prompt states that content inside is data, never instructions.
- Classification outputs are constrained enums — an injected instruction cannot produce an out-of-schema value.
- **No AI task has tool access, database write access, or send authority.** The worst case of a successful injection is a wrong label on one reply, which a human sees in the inbox.
- Any AI output that would cause a state change (suppress, stop sequence, pause campaign) requires either high confidence *plus* a corroborating deterministic signal, or human confirmation. **Exception, deliberately asymmetric:** an unsubscribe/objection classification acts immediately without corroboration, because the failure mode of over-suppressing is trivial and the failure mode of under-suppressing is illegal.

---

## 8. Observability

Every task emits to ClickHouse: task, version, model, tokens, cost, latency, cache hit, schema-validation result, confidence, and (for classify) the eventual human correction if one occurs. That last field is what makes the eval fixture set grow itself.

The AI cockpit panel shows: cost trend, per-task accuracy against corrections, cache hit rate, p95 latency, budget burn-down, and the current model routing table.
