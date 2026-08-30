/**
 * @ems/fleet-agent — the per-node agent.
 *
 * Runs on every blast node as a systemd unit. The API NEVER trusts a node's
 * self-report of health without a signature (planning/ARCHITECTURE.md §13), and
 * a decrypted DKIM key is never written to the agent log or to disk in the
 * clear (E03-045).
 */

export interface HealthReport {
  nodeId: string;
  agentVersion: string;
  queueActive: number;
  queueDeferred: number;
  loadAvg1: number;
  diskUsedPct: number;
  postfixUp: boolean;
  opendkimUp: boolean;
  rspamdUp: boolean;
  clockSkewMs: number;
  at: string; // ISO
}

export interface SignedEnvelope<T> {
  payload: T;
  nonce: string;
  signature: string;
}

export type AgentCommand =
  | { kind: "domain-add"; domain: string; dkimSelector: string; dkimPrivateKey: string }
  | { kind: "domain-remove"; domain: string }
  | { kind: "mailbox-create"; address: string }
  | { kind: "mailbox-delete"; address: string; archiveKey: string }
  | { kind: "ip-bind"; transport: string; sourceIp: string }
  | { kind: "self-test" };

/** Never delete a maildir without archiving it first. A hard guard (E05-033). */
export function requiresArchive(cmd: AgentCommand): boolean {
  return cmd.kind === "mailbox-delete";
}

async function main(): Promise<void> {
  throw new Error("not implemented — see E03-039..E03-053 in planning/TODO.md");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
