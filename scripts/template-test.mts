// Email template engine test — interpolation semantics + the renderer's security
// guarantees: interpolated data is HTML-escaped, and only safe URLs survive.
import { interpolate, extractVariables } from "../packages/core/src/email-interpolate.js";
import { renderEmail, parseTemplateContent } from "../packages/core/src/email-template.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

// ---- interpolate ----
ok("basic path", interpolate("Hi {{data.name}}", { data: { name: "Alex" } }) === "Hi Alex");
ok("missing → default", interpolate("{{data.x|'N/A'}}", { data: {} }) === "N/A");
ok("missing → empty when no default", interpolate("[{{data.x}}]", { data: {} }) === "[]");
ok("uppercase formatter", interpolate("{{data.x|uppercase}}", { data: { x: "abc" } }) === "ABC");
ok("capitalize formatter", interpolate("{{data.x|capitalize}}", { data: { x: "hELLO" } }) === "Hello");
ok("currency formatter", interpolate("{{data.amt|currency}}", { data: { amt: 1234.5 } }).includes("$1,234.50"), interpolate("{{data.amt|currency}}", { data: { amt: 1234.5 } }));
ok("nested + org", interpolate("{{organization.name}}", { organization: { name: "Acme" } }) === "Acme");
ok("never throws on garbage", interpolate("{{...|||}}", {}) === "");
ok("extractVariables", JSON.stringify(extractVariables("{{a.b}} {{c|date}} {{a.b}}")) === JSON.stringify(["a.b", "c"]));

// ---- renderEmail: structure ----
const html = renderEmail(
  { blocks: [{ id: "1", type: "heading", props: { text: "Welcome {{data.name}}", level: "h1" } }] },
  { data: { name: "Alex" } },
);
ok("doctype present", html.startsWith("<!doctype html>"));
ok("heading rendered + interpolated", html.includes("<h1") && html.includes("Welcome Alex"));

// ---- renderEmail: XSS escaping of interpolated data ----
const xss = renderEmail(
  { blocks: [{ id: "1", type: "text", props: { text: "Hi {{data.name}}" } }] },
  { data: { name: "<script>alert(1)</script>" } },
);
ok("interpolated data is escaped", xss.includes("&lt;script&gt;") && !xss.includes("<script>alert"));

// ---- renderEmail: URL sanitization ----
const jsBtn = renderEmail({ blocks: [{ id: "1", type: "button", props: { text: "x", href: "javascript:alert(1)" } }] }, {});
ok("javascript: href neutralized to #", jsBtn.includes('href="#"') && !jsBtn.toLowerCase().includes("javascript:"));
const okBtn = renderEmail({ blocks: [{ id: "1", type: "button", props: { text: "Go", href: "https://x.com/a?b=1&c=2" } }] }, {});
ok("https href preserved", okBtn.includes('href="https://x.com/a?b=1') );
const dataImg = renderEmail({ blocks: [{ id: "1", type: "image", props: { src: "data:text/html,<script>", alt: "x" } }] }, {});
ok("data: image src dropped", !dataImg.includes("data:text/html"));

// ---- renderEmail: href interpolation still sanitized ----
const interpBtn = renderEmail(
  { blocks: [{ id: "1", type: "button", props: { text: "Go", href: "{{data.link}}" } }] },
  { data: { link: "javascript:evil()" } },
);
ok("interpolated unsafe href neutralized", interpBtn.includes('href="#"'));

// ---- renderEmail: numeric props can't break out of style attributes ----
const badNum = renderEmail(
  { blocks: [{ id: "1", type: "heading", props: { text: "X", fontSize: '16px" onmouseover="alert(1)' } as never }] },
  {},
);
ok("non-numeric fontSize coerced (no attr breakout)", !badNum.includes("onmouseover") && /font-size:\d+px/.test(badNum) && !badNum.includes('"alert'));

// ---- renderEmail: malicious settings can't break out of style/attrs ----
const badFont = renderEmail(
  { blocks: [{ id: "1", type: "text", props: { text: "hi" } }], settings: { fontFamily: 'Arial" onload="alert(1)' } as never },
  {},
);
ok("malicious fontFamily sanitized", !badFont.includes('onload="') && !badFont.includes('Arial"'));
const badW = renderEmail(
  { blocks: [], settings: { containerMaxWidth: '600"><script>x' } as never },
  {},
);
ok("malicious containerMaxWidth coerced", !badW.includes("<script") && /max-width:600px/.test(badW));

// ---- renderEmail: buttons inherit the org brand colour ----
const brandedBtn = renderEmail({ blocks: [{ id: "1", type: "button", props: { text: "Go", href: "https://x.com" } }] }, { organization: { primaryColor: "#e11d48" } });
ok("button inherits org brand colour", brandedBtn.includes("background:#e11d48"));
const defaultBtn = renderEmail({ blocks: [{ id: "1", type: "button", props: { text: "Go", href: "https://x.com" } }] }, {});
ok("button falls back to default brand", defaultBtn.includes("background:#6d5efc"));

const inquiry = renderEmail(
  {
    blocks: [
      { id: "h", type: "heading", props: { text: "We received your inquiry", level: "h1" } },
      { id: "t", type: "text", props: { text: "Hi {{data.firstName|'there'}}, thanks for contacting {{organization.name}}." } },
      { id: "b", type: "button", props: { text: "Call {{data.phone}}", href: "tel:{{data.phoneHref}}" } },
    ],
  },
  {
    organization: { name: "Storm Repair Pro", primaryColor: "#0f3b5f" },
    data: { firstName: "Leah", phone: "(561) 220-0117", phoneHref: "+15612200117" },
  },
);
ok("inquiry starter interpolates", inquiry.includes("Hi Leah") && inquiry.includes("Storm Repair Pro"));
ok("inquiry tel: href survives", inquiry.includes('href="tel:+15612200117"'));
ok("inquiry button uses org color", inquiry.includes("background:#0f3b5f"));
const explicitBtn = renderEmail({ blocks: [{ id: "1", type: "button", props: { text: "Go", href: "https://x.com", backgroundColor: "#00ff00" } }] }, { organization: { primaryColor: "#e11d48" } });
ok("explicit button colour wins over brand", explicitBtn.includes("background:#00ff00"));

// ---- renderEmail: malformed blocks never crash the render ----
ok(
  "malformed blocks skipped, no throw",
  (() => {
    try {
      const h = renderEmail(
        { blocks: [null, 42, "x", { type: "heading" }, { type: "unknown", props: {} }, { id: "1", type: "spacer", props: { height: 8 } }] as never },
        {},
      );
      return h.startsWith("<!doctype") && h.includes("<table");
    } catch {
      return false;
    }
  })(),
);

// ---- parseTemplateContent ----
ok("parse: {blocks} object", parseTemplateContent({ blocks: [{ id: "1", type: "spacer", props: { height: 8 } }] }).blocks.length === 1);
ok("parse: legacy array", parseTemplateContent([{ id: "1", type: "spacer", props: { height: 8 } }]).blocks.length === 1);
ok("parse: garbage → empty", parseTemplateContent("nope").blocks.length === 0);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
