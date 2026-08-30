/**
 * Browser crash-structure headers. One map so the API, Next, and the test
 * share the same names/values. HTML gets a CSP that still allows the
 * dashboard's inline JS/CSS; JSON gets a
 * lock-down CSP. HSTS is production-only and is NOT preload (preload is
 * irreversible without the hstspreload.org removal process).
 */
export function securityHeaders(opts: {
  production: boolean;
  html: boolean;
}): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-DNS-Prefetch-Control": "off",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (opts.production) {
    h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  }
  if (opts.html) {
    h["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
  } else {
    h["Content-Security-Policy"] =
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
  }
  return h;
}
