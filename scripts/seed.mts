/** pnpm db:seed — idempotent reference data (E02-073). */
import { PrismaClient } from "../packages/db/src/generated/index.js";
import { seed } from "../packages/db/src/seed/index.js";

const prisma = new PrismaClient();

const counts = await seed(prisma);
for (const [table, n] of Object.entries(counts)) {
  console.log(`  ${String(n).padStart(4)}  ${table}`);
}
console.log("\n  seed complete (idempotent — safe to re-run)");
await prisma.$disconnect();
