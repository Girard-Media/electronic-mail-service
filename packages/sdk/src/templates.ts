// Shared notification email template — a consistent, professional look across
// every app that sends through ems. Email-client-safe (tables + inline
// styles). Theme it per brand; the defaults are a clean neutral card.
//
// This is the product default. Dashboard block templates (`renderEmail` in
// @ems/core) use the same card: 600px, 12px radius, gray page, white
// panel. Buttons inherit organization.primaryColor (fallback #6d5efc).

export interface NotificationBrand {
  /** Brand/company name shown in the header + footer. */
  name?: string;
  /** Optional logo image URL (shown in the header instead of the name). */
  logoUrl?: string;
  /** Accent color for the top rule and CTA button (hex). */
  color?: string;
  /** Link wrapping the brand name/logo. */
  url?: string;
}

export interface NotificationTemplate {
  /** Bold headline at the top of the card. */
  title: string;
  /** Body — HTML or plain paragraphs. Plain text is auto-wrapped in <p>. */
  body: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Hidden inbox preview text. */
  preheader?: string;
  brand?: NotificationBrand;
  /** Footer line (address, "you received this because…", etc.). */
  footer?: string;
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const PAGE = "#f4f5f7";
const INK = "#111827";
const MUTED = "#374151";
const FOOT = "#6b7280";
const LINE = "#e5e7eb";
const DEFAULT_ACCENT = "#111827";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function hex(c: string | undefined, fallback: string): string {
  return c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

function safeUrl(u: string): string {
  const t = (u || "").trim();
  return /^(https?:|mailto:|tel:)/i.test(t) ? t : "#";
}

/**
 * Render a branded notification email to a full HTML document.
 *
 *   html: renderNotification({ title: "Reset your password",
 *     body: "<p>Click below to choose a new password.</p>",
 *     cta: { label: "Reset password", url: link },
 *     brand: { name: "Acme", color: "#0f3b5f" } })
 */
export function renderNotification(t: NotificationTemplate): string {
  const color = hex(t.brand?.color, DEFAULT_ACCENT);
  const name = t.brand?.name ?? "";
  const bodyHtml = /<[a-z][\s\S]*>/i.test(t.body)
    ? t.body
    : t.body
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 16px">${esc(p)}</p>`)
        .join("");
  const header = t.brand?.logoUrl
    ? `<img src="${esc(safeUrl(t.brand.logoUrl))}" alt="${esc(name)}" height="28" style="height:28px;display:block;border:0">`
    : name
      ? `<span style="font-size:15px;font-weight:700;letter-spacing:.02em;color:${INK}">${esc(name)}</span>`
      : "";
  const headerInner =
    t.brand?.url && header
      ? `<a href="${esc(safeUrl(t.brand.url))}" style="text-decoration:none;color:${INK}">${header}</a>`
      : header;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:${PAGE};font-family:${FONT}">
${t.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(t.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE}">
      <tr><td style="height:4px;line-height:4px;font-size:0;background:${color}">&nbsp;</td></tr>
      ${
        headerInner
          ? `<tr><td style="padding:20px 32px 0">${headerInner}</td></tr>`
          : ""
      }
      <tr><td style="padding:24px 32px 32px">
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK};font-weight:700">${esc(t.title)}</h1>
        <div style="font-size:15px;line-height:1.65;color:${MUTED}">${bodyHtml}</div>
        ${
          t.cta
            ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px"><tr><td style="border-radius:8px;background:${color}"><a href="${esc(safeUrl(t.cta.url))}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(t.cta.label)}</a></td></tr></table>`
            : ""
        }
      </td></tr>
      <tr><td style="padding:16px 32px 20px;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${FOOT}">
        ${t.footer ? esc(t.footer) + "<br>" : ""}${name ? `Sent by ${esc(name)}` : ""}
      </td></tr>
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:14px">Delivered by ems</div>
  </td></tr>
</table>
</body></html>`;
}

export interface InquiryReceivedInput {
  brand: NotificationBrand & { name: string };
  firstName?: string;
  /** Short description of what they asked for (damage type, move size, …). */
  summary?: string;
  /** Display phone, e.g. "(561) 220-0117". */
  phone?: string;
  /** E.164 or tel href, e.g. "+15612200117". */
  phoneHref?: string;
  siteUrl?: string;
  /** Override the headline. Default: "We received your inquiry". */
  title?: string;
}

/**
 * Product starter: "inquiry received, someone will get back to you."
 * Same card as `renderNotification`. Dashboard Templates → New also offers this.
 */
export function inquiryReceivedEmail(input: InquiryReceivedInput): {
  subject: string;
  text: string;
  html: string;
} {
  const brand = input.brand.name;
  const who = (input.firstName || "").trim() || "there";
  const title = input.title || "We received your inquiry";
  const about = (input.summary || "").trim();
  const aboutLine = about
    ? `We have your request about ${about}.`
    : "We have your request.";
  const phone = (input.phone || "").trim();
  const callLine = phone
    ? `If you need us sooner, call ${phone}.`
    : "If you need us sooner, reply to this email.";
  const paragraphs = [
    `Hi ${who},`,
    `Thanks for contacting ${brand}. ${aboutLine} Someone will get back to you shortly.`,
    callLine,
  ];
  const text = paragraphs.join("\n\n");
  const html = renderNotification({
    title,
    body: paragraphs.join("\n\n"),
    preheader: `Thanks — ${brand} has your inquiry.`,
    brand: input.brand,
    footer: `You received this because you submitted an inquiry on ${brand}.`,
    cta:
      phone && (input.phoneHref || phone)
        ? {
            label: `Call ${phone}`,
            url: `tel:${(input.phoneHref || phone).replace(/\s/g, "")}`,
          }
        : input.siteUrl
          ? { label: `Visit ${brand}`, url: input.siteUrl }
          : undefined,
  });
  return {
    subject: `We received your inquiry — ${brand}`,
    text,
    html,
  };
}
