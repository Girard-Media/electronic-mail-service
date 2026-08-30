// Clear historical failed jobs from the send queue so /readyz is not
// permanently degraded. Failed === 0 is the readiness definition
// (packages/core/src/health.ts). Waiting jobs are left untouched.
import { sendQueue } from "../packages/core/src/queue.js";

const limit = Number(process.env.CLEAN_LIMIT ?? 500);
const removed = await sendQueue.clean(0, limit, "failed");
const counts = await sendQueue.getJobCounts("waiting", "failed", "active", "delayed");
console.log(
  JSON.stringify(
    { removed: removed.length, counts },
    null,
    2,
  ),
);
await sendQueue.close();
if ((counts.failed ?? 0) > 0) {
  console.error(`still ${counts.failed} failed — re-run with a higher CLEAN_LIMIT`);
  process.exit(1);
}
