/**
 * Inbox attribution test (E16-010).
 *
 * A reply must land on the right lead, campaign, and mailbox. The join key
 * is our own Message-ID (SendIntent.messageId ↔ In-Reply-To), References
 * second, sender email last — and the sender fallback must NEVER invent a
 * campaign, because a lead can sit in several.
 *
 * Pure tests with stub lookups: the DB wiring in
 * apps/api/src/lib/fleet-inbound.ts reuses attributeInbound unchanged.
 */
import { parseInboundMessage } from "../packages/providers/src/inbound.js";
import {
  attributeInbound,
  extractAddr,
  type AttributionLookups,
} from "../packages/inbox/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

// One org's rows. intents is keyed by OUR outbound Message-ID.
function lookups(over: {
  intents?: Record<string, { leadId: string; campaignId: string }>;
  leads?: Record<string, string>;
} = {}): AttributionLookups {
  return {
    findIntentByMessageId: async (id) => over.intents?.[id] ?? null,
    findLeadByEmail: async (email) => {
      const id = over.leads?.[email];
      return id ? { id } : null;
    },
  };
}

console.log("\n--- References parsing ---");
{
  const raw = [
    "From: Dana <dana@acme.com>",
    "To: alex@nw-labs.com",
    "Subject: Re: quick question",
    "Message-ID: <in-2@them>",
    "In-Reply-To: <out-1@ems>",
    "References: <out-0@ems> <out-1@ems>",
    "Content-Type: text/plain",
    "",
    "Works for me.",
  ].join("\r\n");
  const m = parseInboundMessage(raw);
  ok("In-Reply-To parses", m.inReplyTo === "<out-1@ems>", m.inReplyTo);
  ok("References parse oldest-first",
    JSON.stringify(m.references) === JSON.stringify(["<out-0@ems>", "<out-1@ems>"]),
    JSON.stringify(m.references));
}
{
  const m = parseInboundMessage("From: a@b.com\r\nSubject: hi\r\n\r\nbody");
  ok("missing References is an empty array, not undefined", Array.isArray(m.references) && m.references.length === 0);
}

console.log("\n--- extractAddr ---");
ok("display-name form unwraps", extractAddr("Dana Lee <dana@acme.com>") === "dana@acme.com");
ok("bare address lowercases", extractAddr("Dana@Acme.COM") === "dana@acme.com");

console.log("\n--- attribution precedence ---");
{
  const a = await attributeInbound(
    { inReplyTo: "<out-1@ems>", references: ["<out-0@ems>"], from: "dana@acme.com" },
    lookups({ intents: { "<out-1@ems>": { leadId: "lead-1", campaignId: "camp-1" } } }),
  );
  ok("In-Reply-To wins with lead + campaign",
    a.via === "in-reply-to" && a.leadId === "lead-1" && a.campaignId === "camp-1", JSON.stringify(a));
}
{
  // Nearest reference first: <out-1> is newest, so it must win over <out-0>.
  const a = await attributeInbound(
    { inReplyTo: null, references: ["<out-0@ems>", "<out-1@ems>"], from: "dana@acme.com" },
    lookups({
      intents: {
        "<out-0@ems>": { leadId: "lead-OLD", campaignId: "camp-OLD" },
        "<out-1@ems>": { leadId: "lead-1", campaignId: "camp-1" },
      },
    }),
  );
  ok("References joins on the NEAREST ancestor",
    a.via === "references" && a.leadId === "lead-1" && a.campaignId === "camp-1", JSON.stringify(a));
}
{
  // The newest reference is someone else's id; fall through to the older ours.
  const a = await attributeInbound(
    { inReplyTo: null, references: ["<out-0@ems>", "<unknown@them>"], from: "dana@acme.com" },
    lookups({ intents: { "<out-0@ems>": { leadId: "lead-1", campaignId: "camp-1" } } }),
  );
  ok("an unmatchable newest reference falls through to the older match",
    a.via === "references" && a.matchedMessageId === "<out-0@ems>", JSON.stringify(a));
}
{
  // In-Reply-To names a message we never sent: do NOT stop, keep looking.
  const a = await attributeInbound(
    { inReplyTo: "<stranger@them>", references: ["<out-0@ems>"], from: "dana@acme.com" },
    lookups({ intents: { "<out-0@ems>": { leadId: "lead-1", campaignId: "camp-1" } } }),
  );
  ok("a foreign In-Reply-To does not block the References match",
    a.via === "references" && a.leadId === "lead-1", JSON.stringify(a));
}

console.log("\n--- the sender fallback never invents a campaign ---");
{
  const a = await attributeInbound(
    { inReplyTo: null, references: [], from: "Dana Lee <dana@acme.com>" },
    lookups({ leads: { "dana@acme.com": "lead-1" } }),
  );
  ok("sender match yields the lead", a.leadId === "lead-1", JSON.stringify(a));
  ok("but campaignId stays null — the lead may sit in several campaigns",
    a.campaignId === null && a.via === "sender-email", JSON.stringify(a));
}
{
  const a = await attributeInbound(
    { inReplyTo: null, references: [], from: "stranger@other.com" },
    lookups({ leads: { "dana@acme.com": "lead-1" } }),
  );
  ok("an unknown sender attributes to nothing",
    a.via === "none" && a.leadId === null && a.campaignId === null, JSON.stringify(a));
}
{
  const a = await attributeInbound(
    { inReplyTo: null, references: [], from: "not-an-address" },
    lookups({ leads: { "not-an-address": "lead-1" } }),
  );
  ok("a sender without an @ never matches, even if the lookup would hit",
    a.via === "none", JSON.stringify(a));
}

console.log("\n--- cross-org safety ---");
{
  // The lookups are org-scoped by contract: a lookup that finds nothing
  // (e.g. another org's intent) must fall through to sender, then none —
  // never across.
  const a = await attributeInbound(
    { inReplyTo: "<out-1@ems>", references: [], from: "dana@acme.com" },
    lookups({}),
  );
  ok("an intent from another org is invisible: no lead, no campaign",
    a.via === "none" && a.leadId === null, JSON.stringify(a));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
