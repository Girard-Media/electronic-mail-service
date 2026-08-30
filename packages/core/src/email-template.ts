// Block-based email templates: types + a dependency-free renderer that turns a
// block tree into email-client-safe HTML (table layout, inline styles). Adapted
// from the Bootspring reference block model, trimmed to a transactional core set.
// Variables ({{...}}) are interpolated then HTML-ESCAPED — never trust the
// interpolated `data` (it can be end-user controlled).

import { interpolate, type VariableContext } from "./email-interpolate.js";

export type TextAlign = "left" | "center" | "right";
export type HeadingLevel = "h1" | "h2" | "h3";

export interface HeadingBlock {
  id: string;
  type: "heading";
  props: { text: string; level?: HeadingLevel; align?: TextAlign; fontSize?: number; color?: string };
}
export interface TextBlock {
  id: string;
  type: "text";
  props: { text: string; align?: TextAlign; fontSize?: number; color?: string };
}
export interface ButtonBlock {
  id: string;
  type: "button";
  props: { text: string; href: string; align?: TextAlign; backgroundColor?: string; textColor?: string; borderRadius?: number };
}
export interface ImageBlock {
  id: string;
  type: "image";
  props: { src: string; alt?: string; width?: number; align?: TextAlign };
}
export interface DividerBlock {
  id: string;
  type: "divider";
  props?: { color?: string; thickness?: number };
}
export interface SpacerBlock {
  id: string;
  type: "spacer";
  props: { height: number };
}

export type EmailBlock = HeadingBlock | TextBlock | ButtonBlock | ImageBlock | DividerBlock | SpacerBlock;

export const EMAIL_BLOCK_TYPES = ["heading", "text", "button", "image", "divider", "spacer"] as const;

export interface EmailSettings {
  bodyBackgroundColor?: string;
  containerBackgroundColor?: string;
  containerMaxWidth?: number;
  fontFamily?: string;
}

export interface EmailTemplateContent {
  blocks: EmailBlock[];
  settings?: EmailSettings;
}

const DEFAULTS: Required<EmailSettings> = {
  bodyBackgroundColor: "#f4f4f7",
  containerBackgroundColor: "#ffffff",
  containerMaxWidth: 600,
  fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
};

function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Only http(s)/mailto/tel survive into an href/src; anything else (javascript:,
// data:, …) collapses to '#' so a template can't smuggle a script URL.
function safeUrl(u: string): string {
  const t = (u || "").trim();
  return /^(https?:|mailto:|tel:)/i.test(t) ? t : "#";
}

function hex(c: string | undefined, fallback: string): string {
  return c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

// Coerce a stored prop to a finite number — never let an attacker-controlled
// string reach a style attribute (e.g. fontSize: '16px" onmouseover=...').
function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

// font-family flows into a style="" attribute, so strip anything that could
// break out of it (quotes, <>, ;, braces) — keep only font-name-safe chars.
function safeFont(f: unknown): string {
  const cleaned = String(f ?? "").replace(/[^a-zA-Z0-9 ,'\-]/g, "").trim();
  return cleaned || DEFAULTS.fontFamily;
}

const alignOf = (a: TextAlign | undefined): TextAlign =>
  a === "center" || a === "right" ? a : "left";

function renderBlock(block: EmailBlock, ctx: VariableContext, font: string, brand: string): string {
  const interp = (s: string): string => esc(interpolate(s, ctx));
  switch (block.type) {
    case "heading": {
      const p = block.props;
      const lvl = p.level === "h2" ? 2 : p.level === "h3" ? 3 : 1;
      const size = num(p.fontSize, lvl === 1 ? 28 : lvl === 2 ? 22 : 18);
      return `<tr><td style="padding:8px 0"><h${lvl} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:700;color:${hex(p.color, "#1a1a1a")};text-align:${alignOf(p.align)}">${interp(p.text || "")}</h${lvl}></td></tr>`;
    }
    case "text": {
      const p = block.props;
      const body = interp(p.text || "").replace(/\n/g, "<br>");
      return `<tr><td style="padding:6px 0"><p style="margin:0;font-family:${font};font-size:${num(p.fontSize, 16)}px;line-height:1.6;color:${hex(p.color, "#374151")};text-align:${alignOf(p.align)}">${body}</p></td></tr>`;
    }
    case "button": {
      const p = block.props;
      const href = esc(safeUrl(interpolate(p.href || "#", ctx)));
      return `<tr><td style="padding:14px 0;text-align:${alignOf(p.align ?? "center")}"><a href="${href}" target="_blank" style="display:inline-block;font-family:${font};font-size:16px;font-weight:600;color:${hex(p.textColor, "#ffffff")};background:${hex(p.backgroundColor, brand)};text-decoration:none;padding:12px 24px;border-radius:${Math.max(0, num(p.borderRadius, 8))}px">${interp(p.text || "Button")}</a></td></tr>`;
    }
    case "image": {
      const p = block.props;
      const src = esc(safeUrl(interpolate(p.src || "", ctx)));
      if (src === "#") return "";
      const w = p.width != null ? ` width="${Math.max(1, num(p.width, 1))}"` : "";
      return `<tr><td style="padding:8px 0;text-align:${alignOf(p.align ?? "center")}"><img src="${src}" alt="${esc(p.alt || "")}"${w} style="max-width:100%;height:auto;border:0;display:inline-block"></td></tr>`;
    }
    case "divider": {
      const p = block.props ?? {};
      return `<tr><td style="padding:16px 0"><div style="border-top:${Math.max(1, num(p.thickness, 1))}px solid ${hex(p.color, "#e5e7eb")};font-size:0;line-height:0">&nbsp;</div></td></tr>`;
    }
    case "spacer": {
      const h = Math.max(0, num(block.props?.height, 24));
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`;
    }
    default:
      return "";
  }
}

/**
 * Render a template's blocks to a complete, email-client-safe HTML document.
 * `context` supplies {{variables}} — by convention { organization, data }.
 */
export function renderEmail(content: EmailTemplateContent, context: VariableContext = {}): string {
  const s = { ...DEFAULTS, ...(content.settings ?? {}) };
  const font = safeFont(s.fontFamily);
  const maxW = num(s.containerMaxWidth, DEFAULTS.containerMaxWidth);
  // Buttons (and other accents) with no explicit colour inherit the tenant's
  // brand colour from the context, so starter templates auto-brand per org.
  const brand = hex(
    (context.organization as { primaryColor?: string } | undefined)?.primaryColor,
    "#6d5efc",
  );
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  // A malformed block (null / missing props / unknown type) must never crash the
  // whole render — skip it rather than 500 the send or preview.
  const rows = blocks
    .map((b) => {
      try {
        return b && typeof b === "object" ? renderBlock(b, context, font, brand) : "";
      } catch {
        return "";
      }
    })
    .join("");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>` +
    `<body style="margin:0;padding:0;background:${hex(s.bodyBackgroundColor, DEFAULTS.bodyBackgroundColor)}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${hex(s.bodyBackgroundColor, DEFAULTS.bodyBackgroundColor)}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="${maxW}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${maxW}px;background:${hex(s.containerBackgroundColor, DEFAULTS.containerBackgroundColor)};border-radius:12px;padding:28px">` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/** Defensive parse of the stored content JSON into a render-ready shape. */
export function parseTemplateContent(raw: unknown): EmailTemplateContent {
  if (raw && typeof raw === "object" && Array.isArray((raw as EmailTemplateContent).blocks)) {
    const c = raw as EmailTemplateContent;
    return { blocks: c.blocks, settings: c.settings };
  }
  if (Array.isArray(raw)) return { blocks: raw as EmailBlock[] };
  return { blocks: [] };
}
