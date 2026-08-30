/**
 * @ems/dmarc-ingest — aggregate report receiver.
 *
 * One dedicated domain hosts dmarc@ and tlsrpt@ for EVERY sending domain's
 * rua/ruf, which keeps report traffic off the sending domains and gives one
 * ingestion point (planning/INFRA.md §9).
 *
 * Order of operations is fixed: store the original attachment to R2 BEFORE
 * parsing, always (E09-044). The raw report is evidence.
 */

export interface AggregateReportEnvelope {
  from: string;
  subject: string;
  attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array }>;
  receivedAt: Date;
}

export type ReportKind = "dmarc-rua" | "tls-rpt" | "unknown";

export function classifyAttachment(filename: string, contentType: string): ReportKind {
  const f = filename.toLowerCase();
  if (f.endsWith(".xml") || f.endsWith(".xml.gz") || f.endsWith(".zip")) return "dmarc-rua";
  if (f.endsWith(".json") || f.endsWith(".json.gz") || contentType.includes("tlsrpt")) return "tls-rpt";
  return "unknown";
}

async function main(): Promise<void> {
  throw new Error("not implemented — see E09-042..E09-057 in planning/TODO.md");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
