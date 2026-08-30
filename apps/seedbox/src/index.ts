/**
 * @ems/seedbox — inbox-placement probe agent.
 *
 * Seed probes are the ONLY true measure of placement. Everything else is a
 * proxy, and we label it as one (planning/ARCHITECTURE.md §5).
 *
 * Runs on its own host. Seed credentials live nowhere else, and no host may
 * hold both seed credentials and campaign sending (E21-094).
 */

export type SeedProvider =
  | "GMAIL" | "OUTLOOK" | "YAHOO" | "ZOHO" | "PROTON" | "ICLOUD" | "AOL" | "GMX" | "CORPORATE";

export type PlacementFolder =
  | "PRIMARY" | "PROMOTIONS" | "UPDATES" | "SOCIAL" | "SPAM" | "MISSING" | "UNKNOWN";

export interface ProbeResult {
  seedAddress: string;
  provider: SeedProvider;
  folder: PlacementFolder;
  latencyMs: number | null;
  /** Authentication-Results and provider spam headers, verbatim (E10-015). */
  headers: Record<string, string>;
  observedAt: Date;
}

/** Unreturned probes are MISSING. We never assume delivery (E10-026). */
export const DEFAULT_COLLECTION_WINDOW_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  throw new Error("not implemented — see E10-001..E10-035 in planning/TODO.md");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
