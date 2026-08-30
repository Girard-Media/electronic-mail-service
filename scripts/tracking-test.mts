// Open/click tracking unit test — signed-token roundtrip + tamper rejection, and
// applyTracking's pixel injection / link rewrite respecting the per-feature opts.
import {
  signOpen,
  signClick,
  verifyTrack,
  applyTracking,
  openPixelUrl,
  clickUrl,
} from "../packages/core/src/tracking.js";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

// --- token roundtrip ---
const ot = signOpen("email_abc");
const ov = verifyTrack(ot);
ok("open token roundtrip", ov?.kind === "o" && ov.emailId === "email_abc");

const url = "https://shop.example.com:8443/p?x=1&y=2";
const ct = signClick("email_abc", url);
const cv = verifyTrack(ct);
ok("click token roundtrip (emailId)", cv?.kind === "c" && cv.emailId === "email_abc");
ok("click token preserves URL with colons", cv?.kind === "c" && cv.url === url, cv?.kind === "c" ? cv.url : "");

ok("tampered token rejected", verifyTrack(ot.slice(0, -1) + (ot.slice(-1) === "a" ? "b" : "a")) === null);
ok("garbage rejected", verifyTrack("nope") === null);

// --- applyTracking ---
const html = `<html><body><p>Hi</p><a href="https://acme.com/welcome">Welcome</a> <a href="https://acme.com/u/abc">unsub-ish</a></body></html>`;

const both = applyTracking(html, "email_abc", { opens: true, clicks: true });
ok("both: open pixel injected before </body>", /\/t\/o\/[^"]+"[^>]*><\/body>/.test(both) || both.includes("/t/o/"));
ok("both: pixel sits before </body>", both.indexOf("/t/o/") < both.indexOf("</body>"));
ok("both: real link rewritten to /t/c/", both.includes("/t/c/") && !both.includes('href="https://acme.com/welcome"'));

const opensOnly = applyTracking(html, "email_abc", { opens: true, clicks: false });
ok("opens-only: pixel present", opensOnly.includes("/t/o/"));
ok("opens-only: links NOT rewritten", opensOnly.includes('href="https://acme.com/welcome"') && !opensOnly.includes("/t/c/"));

const clicksOnly = applyTracking(html, "email_abc", { opens: false, clicks: true });
ok("clicks-only: link rewritten", clicksOnly.includes("/t/c/"));
ok("clicks-only: NO pixel", !clicksOnly.includes("/t/o/"));

// own /u/ links must not be wrapped (would double-handle our unsubscribe)
ok("own /u/ link left alone", clicksOnly.includes('href="https://acme.com/u/abc"'));

// HTML-encoded ampersands in the href must decode before signing, so the 302
// Location carries a real '&' (not a literal '&amp;') and query params survive.
const entHtml = `<a href="https://shop.com/p?a=1&amp;b=2&amp;c=3">go</a>`;
const entOut = applyTracking(entHtml, "email_abc", { opens: false, clicks: true });
const entToken = entOut.match(/\/t\/c\/([^"']+)/)?.[1] ?? "";
const entUrl = (verifyTrack(entToken) as { url?: string } | null)?.url;
ok("ampersand entity decoded into redirect URL", entUrl === "https://shop.com/p?a=1&b=2&c=3", entUrl ?? "(none)");

// no-body html → pixel still appended
const noBody = applyTracking("<p>hi</p>", "email_abc", { opens: true, clicks: false });
ok("no-body: pixel appended", noBody.includes("/t/o/"));

// empty html → unchanged (no throw)
ok("empty html safe", applyTracking("", "email_abc") === "");

// url helpers
ok("openPixelUrl shape", openPixelUrl("e1").includes("/t/o/"));
ok("clickUrl shape", clickUrl("e1", "https://x.com").includes("/t/c/"));

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
