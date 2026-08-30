/**
 * Fixture set for classify.reply (E17-056, E17-064).
 *
 * Every fixture is a reply of a kind we will actually receive. The set is meant
 * to GROW: production cases that came back low-confidence or that a human
 * corrected get added here, so the CI gate gets harder over time rather than
 * rotting into a formality.
 */
import type { Fixture } from "../src/evals.js";
import type { ClassifyReplyInput, ReplyIntent } from "../src/tasks/classify-reply.js";

export const CLASSIFY_REPLY_FIXTURES: Array<Fixture<ClassifyReplyInput, ReplyIntent>> = [
  // ── UNSUBSCRIBE. Over-matching here is cheap; under-matching is illegal.
  { id: "u1", input: { subject: "Re: quick question", body: "Please remove me from your list." }, expected: "UNSUBSCRIBE" },
  { id: "u2", input: { subject: "Re: onboarding", body: "unsubscribe" }, expected: "UNSUBSCRIBE" },
  { id: "u3", input: { subject: "stop", body: "Take me off this. Thanks." }, expected: "UNSUBSCRIBE" },
  { id: "u4", input: { subject: "Re:", body: "Please opt me out of future emails." }, expected: "UNSUBSCRIBE" },
  { id: "u5", input: { subject: "Re: hi", body: "STOP EMAILING ME" }, expected: "UNSUBSCRIBE",
    note: "shouty but unambiguous" },
  { id: "u6", input: { subject: "Re: hi", body: "Please do not contact me again." }, expected: "UNSUBSCRIBE" },
  { id: "u7", input: { subject: "Re: intro", body: "I no longer wish to receive these." }, expected: "UNSUBSCRIBE" },
  { id: "u8", input: { subject: "Re:", body: "Delete my email address from your records." }, expected: "UNSUBSCRIBE" },
  { id: "u9", input: { subject: "Re: quick question", body: "Take us off your mailing list please." }, expected: "UNSUBSCRIBE" },
  { id: "u10", input: { subject: "Re:", body: "Cease contact." }, expected: "UNSUBSCRIBE",
    note: "terse; added after u4 showed the rule was too narrow" },
  { id: "u11", input: { subject: "Re:", body: "please remove me" }, expected: "UNSUBSCRIBE",
    note: "bare form with no off/from — broadening the rule for u4 briefly broke this" },

  // ── OUT_OF_OFFICE
  { id: "o1", input: { subject: "Automatic reply: quick question", body: "I am out of the office until 5 September with limited access to email." }, expected: "OUT_OF_OFFICE" },
  { id: "o2", input: { subject: "Re: intro", body: "I'm on annual leave, returning on the 12th." }, expected: "OUT_OF_OFFICE" },
  { id: "o3", input: { subject: "Away", body: "On holiday. For urgent matters contact Sam." }, expected: "OUT_OF_OFFICE",
    note: "mentions a colleague but is not a referral" },

  // ── AUTO_REPLY
  { id: "a1", input: { subject: "Automatic reply", body: "Thank you for your message. Do not reply to this address." }, expected: "AUTO_REPLY" },
  { id: "a2", input: { subject: "Ticket #4821 received", body: "This is an automatic reply confirming we received your message." }, expected: "AUTO_REPLY" },

  // ── BOUNCE
  { id: "b1", input: { subject: "Undeliverable: quick question", body: "Delivery has failed to these recipients." }, expected: "BOUNCE" },
  { id: "b2", input: { subject: "Delivery Status Notification (Failure)", body: "Mail delivery subsystem returned an error." }, expected: "BOUNCE" },

  // ── REFERRAL
  { id: "r1", input: { subject: "Re: quick question", body: "Not the right person — you should talk to Priya, cc'd." }, expected: "REFERRAL" },
  { id: "r2", input: { subject: "Re: intro", body: "I'm forwarding you to our head of ops." }, expected: "REFERRAL" },
  { id: "r3", input: { subject: "Re: onboarding", body: "Best to reach out to procurement on this one." }, expected: "REFERRAL" },

  // ── NOT_INTERESTED
  { id: "n1", input: { subject: "Re: quick question", body: "No thanks, we're all set." }, expected: "NOT_INTERESTED" },
  { id: "n2", input: { subject: "Re: intro", body: "Not interested." }, expected: "NOT_INTERESTED" },
  { id: "n3", input: { subject: "Re: pricing", body: "Not a good fit for us right now." }, expected: "NOT_INTERESTED" },

  // ── INTERESTED
  { id: "i1", input: { subject: "Re: quick question", body: "Sounds interesting — can you send pricing?" }, expected: "INTERESTED" },
  { id: "i2", input: { subject: "Re: intro", body: "Yes, tell me more." }, expected: "INTERESTED" },
  { id: "i3", input: { subject: "Re: onboarding", body: "Happy to book a call. What does your calendar look like?" }, expected: "INTERESTED" },
  { id: "i4", input: { subject: "Re: demo", body: "Can we do a demo next week?" }, expected: "INTERESTED" },

  // ── OTHER
  { id: "x1", input: { subject: "Re: quick question", body: "ok" }, expected: "OTHER" },
  { id: "x2", input: { subject: "Re:", body: "Who is this?" }, expected: "OTHER" },
];
