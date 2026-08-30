import {
  assertPublicWebhookUrl,
  isBlockedAddress,
  publicLookup,
} from "../packages/core/src/ssrf.js";

let fail = 0;
const allow = (u: string) => {
  try {
    assertPublicWebhookUrl(u);
    console.log("✓ allow", u);
  } catch (e) {
    console.log("✗ WRONGLY BLOCKED", u, (e as Error).message);
    fail++;
  }
};
const block = (u: string) => {
  try {
    assertPublicWebhookUrl(u);
    console.log("✗ WRONGLY ALLOWED", u);
    fail++;
  } catch {
    console.log("✓ block ", u);
  }
};
const addr = (ip: string, expectBlocked: boolean) => {
  const got = isBlockedAddress(ip);
  if (got !== expectBlocked) {
    console.log("✗ address", ip, "blocked=", got, "want", expectBlocked);
    fail++;
  } else {
    console.log(`✓ addr ${expectBlocked ? "block" : "allow"}`, ip);
  }
};

allow("https://example.com/webhooks");
allow("https://hooks.acme.co/ems");
allow("https://1.2.3.4/hook"); // public IP literal
allow("https://facebook.com/hooks"); // must not trip IPv6 `fc` prefix
allow("https://fd.com/hooks"); // real TLD name, not fd00::/8
allow("https://fc.com/hooks");
block("http://example.com"); // not https
block("https://localhost/x");
block("https://app.local/x");
block("https://svc.internal/x");
block("https://127.0.0.1");
block("https://0.0.0.0");
block("https://169.254.169.254/latest/meta-data");
block("https://10.0.0.5");
block("https://10.10.0.2"); // fleet data-box
block("https://172.16.5.5");
block("https://192.168.1.1");
block("https://100.100.0.1"); // CGNAT
block("https://[::1]/x");
block("https://[fd00::1]/x");
block("https://[fc00::1]/x");
block("https://[fe80::1]/x");
block("not-a-url");

addr("8.8.8.8", false);
addr("1.1.1.1", false);
addr("10.10.0.2", true);
addr("127.0.0.1", true);
addr("0.0.0.0", true);
addr("169.254.169.254", true);
addr("192.168.0.9", true);
addr("172.31.255.1", true);
addr("100.64.0.1", true);
addr("224.0.0.1", true);
addr("::1", true);
addr("fd00::1", true);
addr("fc00::2", true);
addr("fe80::1", true);
addr("2001:4860:4860::8888", false); // Google DNS
addr("::ffff:127.0.0.1", true);
addr("::ffff:10.0.0.1", true);
addr("::ffff:8.8.8.8", false);

await new Promise<void>((resolve) => {
  publicLookup("localhost", {}, (err) => {
    if (err) console.log("✓ lookup blocks localhost");
    else {
      console.log("✗ lookup allowed localhost");
      fail++;
    }
    resolve();
  });
});
await new Promise<void>((resolve) => {
  publicLookup("127.0.0.1", {}, (err) => {
    if (err) console.log("✓ lookup blocks 127.0.0.1");
    else {
      console.log("✗ lookup allowed 127.0.0.1");
      fail++;
    }
    resolve();
  });
});

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
