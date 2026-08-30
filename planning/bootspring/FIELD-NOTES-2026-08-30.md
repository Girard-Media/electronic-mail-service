# Bootspring — field notes from the EMS cold start

**Context:** greenfield project (`electronic-mail-service`), hard-forked from an existing
Bootspring-managed repo (`usermails`), 2,500-task backlog authored in one session.
Bootspring v3.4.3 CLI installed, API online v3.4.2.

Written as product feedback, not as a bug report. Each item states what happened, why it
cost something, and what would have avoided it.

---

## 1. Every MCP tool is gated behind auth, including the ones that only read the filesystem

**What happened.** The first call of the session:

```
bootspring_context({ project_path: "…/electronic-mail-service" })
→ Authentication required. Run `bootspring auth login` first.
```

`bootspring auth status` confirmed: **Auth: Not Authenticated · API: Online (v3.4.2)**.
The session was non-interactive, so the OAuth flow could not run. Every one of the ~30
`bootspring_*` tools was unavailable for the whole build.

**Why it cost something.** `bootspring_context` reads `.bootspring/context/*` and
`CLAUDE.md` — files sitting on local disk that the agent could `cat` directly, and did.
`bootspring_todo` reads `planning/TODO.md`. `bootspring_build` reads the same file. None
of these need the API. The gate turned a local-first tool into a network-dependent one and
pushed the agent onto raw `Bash`, which is exactly the workflow Bootspring exists to replace.

**Suggestion.** Split the tool surface by what it actually touches:

| Tier | Tools | Auth |
|---|---|---|
| **Local** | `context`, `todo`, `build`, `spec`, `project_memory`, `repo_intelligence` | none — pure filesystem |
| **Metered** | `skill`, `agent`, `search`, `web_research`, `seed`, `design` | required |
| **Account** | `fleet`, `room`, `overnight`, `sprint` | required |

Local-tier tools should degrade to filesystem mode with a one-line notice
(`unauthenticated — local mode, remote skills unavailable`) rather than refusing.
The failure mode today is that an agent hits one auth wall and abandons the toolchain
entirely for the rest of the session.

**Second-order suggestion.** When auth *is* missing, the error should say what the tool
would have done and what the degraded path is, so the agent can route around it in one
step rather than testing each tool.

---

## 2. `planning/TODO.md` as a single flat file does not survive a real backlog

**What happened.** The inherited convention is one `TODO.md` with `- [ ]` lines that
`bootspring build next` reads. That works at the 115 tasks `usermails` carries. At 2,500
it does not: the file is 2,722 lines, un-reviewable in a diff, and merge-conflicts on every
parallel edit.

**What we built instead.** `planning/backlog/NN-<epic>.md` as the source of truth, plus
`scripts/compile-todo.mts` that concatenates them into a generated `planning/TODO.md`
with a computed `done/total` header. `pnpm todo:compile` regenerates it.

**Suggestion.** Bootspring should own this natively:

- `bootspring todo compile` — backlog directory → queue file
- Treat `planning/backlog/*.md` as first-class when present, falling back to flat `TODO.md`
- Emit the progress header (`8 / 2500 complete`) rather than making every project write it
- Parse the `E07-042` style task id if present and expose it to `bootspring build next`,
  so a task can be addressed by id rather than by line number

That last one matters: with 2,500 tasks, "the next task" is rarely the right task.

---

## 3. There is no dependency or gating model between tasks

**What happened.** The backlog has hard ordering constraints — epics 03–05 (fleet) gate
06–08 (warmup, router, send), because you cannot route across mailboxes that do not exist.
We encoded this in prose in the `TODO.md` header, which is unenforceable.

**Suggestion.** A minimal, optional dependency syntax that the build loop honours:

```markdown
- [ ] E07-013 — Implement reputationScore as a router input  <!-- needs: E11-020 -->
```

`bootspring build next` should skip a task whose dependencies are open, and say why.
Even without a full graph, "do not hand me a task that cannot be done yet" removes a
whole class of wasted loop iterations. A `bootspring build ready` that lists only
unblocked tasks would be the single highest-value addition for a backlog this size.

---

## 4. A fork carries stale `.bootspring/` state and there is no re-seed

**What happened.** `rsync` brought across `.bootspring/context/*` (12 strategy documents
about a *transactional email* product), `.bootspring/specs/transactional-core/`,
`.bootspring/facts/`, and `.bootspring/project-memory/memories.json`. After the global
rebrand these files read as confident, well-formatted, **wrong** context for the new
product — the most dangerous possible state, because an agent trusts them.

We had to add explicit backlog tasks (E01-016 through E01-025) to rewrite or delete each one.

**Suggestion.** `bootspring fork <source> <dest>` or `bootspring reseed --from-fork`:

- Copy the code, exclude or quarantine `.bootspring/context`, `specs`, `facts`, `project-memory`
- Write `.bootspring/lineage.json` recording source, commit, and date
- Mark inherited context files `status: stale-from-fork` so `bootspring_context` returns
  them with a loud warning instead of silently
- Prompt for the new product definition before anything else runs

Stale context is worse than no context. Right now the tool has no way to know the
difference.

---

## 5. `bootspring.config.js` drifted from reality and nothing noticed

**What happened.** The inherited config declared `hosting: "coolify"` and
`email: "aws-ses"`. Coolify was retired from this fleet in 2026-07 and replaced by
`hostssh`; the MTA has been self-hosted Postfix since 2026-08. The config had been wrong
for a month and was still being served as project truth.

**Suggestion.** A `bootspring doctor` that checks declared stack against observable
reality — `hosting` against the git remotes, `orm`/`database` against what is in
`package.json` and the schema, `queue` against the dependency tree — and reports drift.
Cheap to implement, and config drift is the quiet failure mode that poisons every
downstream agent decision.

---

## 6. What worked well, and should not change

- **The `planning/` + `.bootspring/context/` split** is right. Human-authored strategy in
  `planning/`, agent-consumed context in `.bootspring/`, with the second derived from the
  first. It survived a fork and a complete product pivot intact.
- **`- [ ]` / `[~]` / `[x]` in markdown** is the correct storage format. Greppable,
  diffable, editable by a human without a tool. Resist the pull toward a database.
- **`AGENTS.md` + `CLAUDE.md` at the repo root** meant an agent picked up the licence
  boundary (freeresend MIT vs usesend AGPL) without being told. That constraint survived
  the fork *because it was in a file the agent reads by default.* This is the strongest
  argument for the whole convention.
- **`SEED.md`** as a durable statement of original intent is genuinely useful when
  re-reading a project a year later.

---

## 7. The one thing that would have changed this session most

An unauthenticated **local mode**. Everything else here is an enhancement. That one is the
difference between Bootspring being the workflow and Bootspring being the thing the agent
worked around for six hours.
