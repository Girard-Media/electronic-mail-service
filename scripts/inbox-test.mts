/**
 * Inbox threading and inbound-safety test (E16-074..E16-081).
 *
 * The threading assertions are mostly about what we REFUSE to join: showing a
 * customer someone else's conversation is worse than opening a new thread.
 */
import {
  resolveThread, normalizeSubject, splitQuoted, splitSignature,
  classifyAttachment, sanitizeHtml, blockRemoteImages, WEAK_MATCH_FLOOR,
  actsWithoutCorroboration, resolveAmbiguous,
  type InboundEnvelope, type ThreadIndex,
} from "../packages/inbox/src/index.js";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.log(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

const NOW = new Date("2026-08-30T12:00:00Z");
const env = (over: Partial<InboundEnvelope> = {}): InboundEnvelope => ({
  messageId: "<in@them>", inReplyTo: null, references: [],
  subject: "Re: quick question", from: "Dana <dana@acme.com>",
  to: ["alex@nw-labs.com"], receivedAt: NOW, ...over,
});

function index(over: Partial<ThreadIndex> = {}): ThreadIndex {
  return {
    byMessageId: (id) => (id === "<out-1@ems>" ? "thread-1" : id === "<out-0@ems>" ? "thread-0" : null),
    bySubject: () => [],
    ...over,
  };
}

console.log("\n--- subject normalisation ---");
ok("Re: is stripped", normalizeSubject("Re: quick question") === "quick question");
ok("stacked prefixes are stripped", normalizeSubject("RE: Fwd: RE: quick question") === "quick question");
ok("numbered prefixes are stripped", normalizeSubject("Re[2]: quick question") === "quick question");
ok("non-English prefixes are stripped", normalizeSubject("AW: quick question") === "quick question");
ok("a bare subject is unchanged", normalizeSubject("quick question") === "quick question");
ok("whitespace collapses", normalizeSubject("Re:   quick    question ") === "quick question");

console.log("\n--- threading precedence ---");
{
  const m = resolveThread(env({ inReplyTo: "<out-1@ems>" }), index());
  ok("In-Reply-To joins with full confidence", m.kind === "header" && m.confidence === 1);
}
{
  const m = resolveThread(env({ references: ["<out-0@ems>", "<out-1@ems>"] }), index());
  ok("References joins when In-Reply-To is absent", m.kind === "references");
  ok("and picks the NEAREST ancestor",
    m.kind === "references" && m.threadId === "thread-1", m.kind === "references" ? m.threadId : "");
}
{
  const m = resolveThread(env(), index());
  ok("no headers and no subject match opens a NEW thread", m.kind === "new");
}

console.log("\n--- the heuristic is deliberately conservative ---");
{
  const idx = index({
    bySubject: () => [{ threadId: "t9", participants: ["dana@acme.com", "alex@nw-labs.com"], lastMessageAt: new Date("2026-08-29T12:00:00Z") }],
  });
  const m = resolveThread(env(), idx);
  ok("subject + known participant + recency joins", m.kind === "heuristic", m.kind);
  ok("but never at full confidence", m.confidence < 1 && m.confidence >= WEAK_MATCH_FLOOR, String(m.confidence));
}
{
  const idx = index({
    bySubject: () => [{ threadId: "t9", participants: ["someone-else@other.com"], lastMessageAt: NOW }],
  });
  ok("a STRANGER on a matching subject does NOT join — that would leak a conversation",
    resolveThread(env(), idx).kind === "new");
}
{
  const idx = index({
    bySubject: () => [{ threadId: "t9", participants: ["dana@acme.com"], lastMessageAt: new Date("2026-01-01T00:00:00Z") }],
  });
  ok("a match that is months stale does not join", resolveThread(env(), idx).kind === "new");
}
{
  const idx = index({ bySubject: () => [{ threadId: "t9", participants: ["dana@acme.com"], lastMessageAt: NOW }] });
  ok("a trivially short subject never joins heuristically",
    resolveThread(env({ subject: "Re: hi" }), idx).kind === "new");
}

console.log("\n--- quoted history ---");
{
  const gmail = `Yes, that works — Tuesday at 10 suits me.

On Fri, Aug 28, 2026 at 9:14 AM Alex Rivera <alex@nw-labs.com> wrote:
> Would Tuesday work for a short call?
> Alex`;
  const s = splitQuoted(gmail);
  ok("Gmail quoting splits", s.reply === "Yes, that works — Tuesday at 10 suits me.", JSON.stringify(s.reply));
  ok("and the quoted part is RETAINED, not discarded", s.quoted.includes("Would Tuesday work"));
}
{
  const outlook = `Happy to chat.

_____________________________________________
From: Alex Rivera <alex@nw-labs.com>
Sent: 28 August 2026 09:14
To: Dana
Subject: quick question

Would Tuesday work?`;
  const s = splitQuoted(outlook);
  ok("Outlook's divider splits", s.reply === "Happy to chat.", JSON.stringify(s.reply));
}
{
  const original = `Sure.

-----Original Message-----
From: Alex
Would Tuesday work?`;
  ok("the Original Message marker splits", splitQuoted(original).reply === "Sure.");
}
{
  const german = `Ja, gerne.

Am 28.08.2026 um 09:14 schrieb Alex Rivera:
> Passt Dienstag?`;
  ok("German quoting splits", splitQuoted(german).reply === "Ja, gerne.");
}
{
  const french = `Oui, avec plaisir.

Le 28 août 2026 à 09:14, Alex Rivera a écrit :
> Mardi vous convient ?`;
  ok("French quoting splits", splitQuoted(french).reply === "Oui, avec plaisir.");
}
{
  const bare = `Works for me.

> Would Tuesday work?
> Alex`;
  ok("a bare '>' block with no marker still splits", splitQuoted(bare).reply === "Works for me.");
}
{
  const none = "Sounds good, let's do it.";
  const s = splitQuoted(none);
  ok("a message with no quoting is untouched", s.reply === none && s.quoted === "");
}

console.log("\n--- signatures ---");
{
  const withDelim = "Thanks, that works.\n\n-- \nDana Lee\nAcme Widgets\n+1 512 555 0143";
  const s = splitSignature(withDelim);
  ok("the standard -- delimiter splits", s.body.trim() === "Thanks, that works.");
  ok("and the signature is captured", s.signature.includes("Dana Lee"));
}
{
  const signoff = "Tuesday at 10 works.\n\nBest,\nDana\nAcme Widgets";
  const s = splitSignature(signoff);
  ok("a sign-off near the end splits", s.body.trim() === "Tuesday at 10 works.", JSON.stringify(s.body));
}
{
  // The failure mode that matters: cutting mid-message and deleting the answer.
  const midThanks = "Thanks,\n\nI looked at this and the answer is yes, but only if we can start in Q1. " +
    "There are three things we would need first, and I want to walk through each of them properly " +
    "because the second one has caught us out before and I do not want to repeat it.\n\nDana";
  const s = splitSignature(midThanks);
  ok("a 'Thanks,' at the START does not truncate the message",
    s.body.includes("the answer is yes"), JSON.stringify(s.body.slice(0, 40)));
}

console.log("\n--- attachment safety ---");
for (const [name, expected] of [
  ["invoice.pdf", "allow"],
  ["deck.pptx", "allow"],
  ["photo.jpg", "allow"],
  ["setup.exe", "quarantine"],
  ["script.js", "quarantine"],
  ["macro.vbs", "quarantine"],
  ["archive.zip", "quarantine"],
  ["invoice.pdf.exe", "quarantine"],
  ["photo.jpg.scr", "quarantine"],
] as const) {
  ok(`${name} → ${expected}`, classifyAttachment(name).verdict === expected,
    classifyAttachment(name).verdict);
}
ok("a double extension is named as the reason",
  classifyAttachment("invoice.pdf.exe").reason.includes("."));
ok("a right-to-left override in the filename is quarantined",
  classifyAttachment("cv‮gpj.exe").verdict === "quarantine");

console.log("\n--- HTML sanitisation ---");
ok("script tags are removed", !sanitizeHtml("<p>hi</p><script>alert(1)</script>").includes("script"));
ok("iframes are removed", !sanitizeHtml('<iframe src="//evil"></iframe>').includes("iframe"));
ok("inline handlers are removed", !/onerror/i.test(sanitizeHtml('<img src=x onerror="alert(1)">')));
ok("javascript: hrefs are neutralised",
  !/javascript:/i.test(sanitizeHtml('<a href="javascript:alert(1)">x</a>')));
ok("data: hrefs are neutralised",
  !/href\s*=\s*"?data:/i.test(sanitizeHtml('<a href="data:text/html,<script>">x</a>')));
ok("svg is removed entirely", !sanitizeHtml('<svg><use href="#x"/></svg>').includes("svg"));
ok("form tags are removed", !sanitizeHtml('<form action="//evil"><input></form>').includes("<form"));
ok("ordinary markup survives", sanitizeHtml("<p><b>hello</b></p>") === "<p><b>hello</b></p>");

console.log("\n--- remote images blocked by default ---");
{
  const r = blockRemoteImages('<img src="https://tracker.example/pixel.gif"><p>hi</p>');
  ok("a remote image is blocked", r.blocked === 1);
  ok("its src is moved out of the loading path", !/\ssrc\s*=\s*"https/.test(r.html));
  ok("but retained so the user can reveal it", r.html.includes("data-blocked-src"));
  ok("and flagged for the UI", r.html.includes('data-ems-blocked="1"'));
}
{
  const r = blockRemoteImages('<img src="cid:embedded">');
  ok("an inline cid: image is left alone", r.blocked === 0);
}

console.log("\n--- the unsubscribe asymmetry, at the inbox layer ---");
ok("only an unsubscribe acts without corroboration", actsWithoutCorroboration("UNSUBSCRIBE"));
ok("an interested reply does not", !actsWithoutCorroboration("INTERESTED"));
ok("a confident label is kept", resolveAmbiguous("INTERESTED", 0.95) === "INTERESTED");
ok("an ambiguous label resolves toward suppression", resolveAmbiguous("INTERESTED", 0.2) === "UNSUBSCRIBE");

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAIL\n`);
process.exit(failures === 0 ? 0 : 1);
