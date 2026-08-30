import {
  generateTotpSecret,
  totpAuthUrl,
  totpCode,
  verifyTotp,
} from "../packages/core/src/totp.js";
import { secretEquals as secretEq } from "../packages/core/src/keys.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let fail = 0;
const ok = (n: string, c: boolean, x = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`);
  if (!c) fail++;
};

const secret = generateTotpSecret();
ok("secret is base32-ish", /^[A-Z2-7]{32}$/.test(secret));
const code = totpCode(secret);
ok("code is 6 digits", /^\d{6}$/.test(code));
ok("current code verifies", verifyTotp(secret, code));
ok("previous window verifies", verifyTotp(secret, totpCode(secret, Date.now() - 25_000)));
ok("garbage rejected", !verifyTotp(secret, "abcdef") && !verifyTotp(secret, ""));
ok("short code rejected", !verifyTotp(secret, "123"));
ok(
  "otpauth url",
  totpAuthUrl("a@b.com", secret).startsWith("otpauth://totp/") &&
    totpAuthUrl("a@b.com", secret).includes("secret=" + secret),
);

ok("secretEquals equal", secretEq("abc", "abc"));
ok("secretEquals rejects mismatch", !secretEq("abc", "abd"));
ok("secretEquals rejects missing", !secretEq("abc", null) && !secretEq("", "x"));

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");
ok("MTA uses secretEquals", src("apps/api/src/routes/mta.ts").includes("secretEquals"));
ok("bootstrap uses secretEquals", src("apps/api/src/routes/admin.ts").includes("secretEquals"));
ok(
  "webhook secret encrypted at rest",
  src("apps/api/src/routes/app.ts").includes("secret: encryptSecret(secret)"),
);
ok(
  "worker decrypts webhook secret before HMAC",
  src("apps/workers/src/index.ts").includes("decryptSecret(delivery.endpoint.secret)"),
);
ok("impersonate requires TOTP", src("apps/api/src/routes/god.ts").includes("totpRequired"));
ok("forwards confirm is POST", src("apps/api/src/index.ts").includes('app.post("/forwards/verify"'));
ok("site.css has no Google Fonts", !src("apps/api/public/site.css").includes("fonts.googleapis.com"));
ok("globals.css has no jsdelivr", !src("apps/web/app/globals.css").includes("cdn.jsdelivr.net"));

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nALL PASS");
