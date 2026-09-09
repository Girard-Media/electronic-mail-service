/**
 * Compiles planning/backlog/*.md into planning/TODO.md — the build-loop queue
 * that `bootspring build next` reads. Backlog files are the source of truth;
 * TODO.md is generated. Edit the backlog, then re-run:  pnpm todo:compile
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BACKLOG = "planning/backlog";
const OUT = "planning/TODO.md";

const files = readdirSync(BACKLOG).filter((f) => f.endsWith(".md")).sort();

let total = 0;
let done = 0;
const sections: string[] = [];

for (const file of files) {
  const raw = readFileSync(join(BACKLOG, file), "utf8");
  const lines = raw.split("\n");
  const count = lines.filter((l) => /^- \[[ x~]\]/.test(l)).length;
  const doneCount = lines.filter((l) => /^- \[x\]/.test(l)).length;
  total += count;
  done += doneCount;
  sections.push(
    `<!-- source: ${BACKLOG}/${file} · ${doneCount}/${count} -->\n${raw.trim()}\n`,
  );
}

const header = `# Electronic Mail Services — Build TODO

**Generated file.** Source of truth is \`planning/backlog/*.md\`. Re-generate with \`pnpm todo:compile\`.

The build-loop queue (\`bootspring build next\` reads this).
Status: \`[ ]\` todo · \`[~]\` in progress · \`[x]\` done.

**${done} / ${total} complete.**

Governing documents — read before taking a task:

| Document | What it settles |
|---|---|
| \`planning/VISION.md\` | Why this exists, what we refuse to build |
| \`planning/ARCHITECTURE.md\` | The send path and invariants I1–I7 |
| \`planning/INFRA.md\` | The blast-node fleet |
| \`planning/COMPLIANCE.md\` | The policy gate and the legal map |
| \`planning/AI.md\` | The OpenRouter gateway contract |
| \`planning/HANDOFF.md\` | Current ListKit/campaign-pool slice — read before picking E15/E05/E16 |

**Order.** Epics 01–02 gate everything. 03–05 (fleet) gate 06–08 (warmup, router, send).
09–11 (deliverability, reputation) can run parallel to 12–16 (product) once the fleet exists.
17–18 (AI, frontend) follow their subsystems. 19–24 are launch-gated.

**Rule.** No task in epics 07, 08, or 14 ships without an integration test naming the
invariant it protects.

---

`;

writeFileSync(OUT, header + sections.join("\n---\n\n"));
console.log(`compiled ${files.length} epics · ${done}/${total} tasks → ${OUT}`);
