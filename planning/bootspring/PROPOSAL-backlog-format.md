# Proposal — a backlog format Bootspring could adopt

Concrete spec derived from what we had to build by hand for a 2,500-task project.
Offered as a candidate convention, not as a demand.

## Layout

```
planning/
  backlog/
    01-foundation.md
    02-data-model.md
    …
    24-launch.md
  TODO.md          <- generated, never hand-edited
```

## Task line grammar

```
- [ ] E07-042 — Implement the adaptive per-recipient-ESP bucket  <!-- needs: E02-049 -->
  ^   ^  ^      ^                                                    ^
  |   |  id     imperative task text                                 optional dependency
  |   status: ' ' todo | '~' in progress | 'x' done
  standard markdown checkbox — stays greppable and human-editable
```

- **Id** is `E<epic:2>-<seq:3>`, stable forever. Never renumber; a completed task keeps its
  id so an incident review can reference it years later.
- **Text** is imperative, one line, names the artefact where possible.
- **Dependency** is an HTML comment so it renders as nothing and breaks no markdown tooling.

## Header contract for an epic file

```markdown
# Epic 07 — Router, Pacing & the Send Path

One or two sentences of intent, plus the invariant this epic protects.

- [ ] E07-001 — …
```

The prose block is what an agent reads before taking any task in the epic. Keep it short
enough that it always gets read.

## Commands

| Command | Behaviour |
|---|---|
| `bootspring todo compile` | backlog → `TODO.md`, computes `done/total`, validates ids are unique and dependencies resolve |
| `bootspring todo lint` | fails on duplicate id, dangling dependency, malformed line, or hand-edited `TODO.md` |
| `bootspring build ready` | lists unblocked open tasks — the queue an agent should actually pull from |
| `bootspring build next [--epic N]` | claims the next unblocked task, flips it to `[~]`, prints the epic prose plus the governing documents |
| `bootspring build done <id>` | flips to `[x]`, recompiles |
| `bootspring todo stats` | per-epic completion, useful for a status report |

`compile` and `lint` in CI keep the generated file honest.

## Why the ids matter more than they look

At 115 tasks you address a task by quoting its text. At 2,500 you cannot — texts collide,
and an agent that "does the routing one" may do the wrong routing one. A stable id also
lets an epic's prose reference other work (`see E11-020`) and lets a post-incident review
say "this was E14-045, which we deferred" without archaeology.

## What this deliberately does not do

- **No YAML front-matter per task.** The moment a task has structured metadata, humans stop
  editing the file by hand and the format's main virtue is gone.
- **No estimates or points.** They would be fabricated at this scale and would decay
  immediately.
- **No assignee field.** That belongs in whatever tracker a team already uses; duplicating
  it here creates two sources of truth.
- **No database.** The file *is* the state. Git is the history. That is the whole point.
