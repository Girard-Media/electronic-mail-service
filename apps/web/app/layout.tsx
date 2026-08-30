import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const DESCRIPTION =
  "Developer-first, white-label application email. A drop-in Resend-compatible API on a mail server we operate — delivered, bounced, and complained are real events, not a send count.";

// metadataBase anchors canonical + OpenGraph URLs (critical for the SEO phase).
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://electronicmailservices.com"),
  title: { default: "EMS", template: "%s · EMS" },
  description: DESCRIPTION,
  applicationName: "EMS",
  // app/icon.svg is picked up automatically; declared here so /favicon.ico probes
  // from older clients resolve to it too.
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], shortcut: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: "EMS",
    title: "EMS — application email on infrastructure you control",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "EMS — application email on infrastructure you control",
    description: DESCRIPTION,
  },
};

// Matches --bg in globals.css so mobile browser chrome blends with the page.
export const viewport: Viewport = {
  themeColor: "#0a0d14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Linked, not bundled: the icon font lives in public/ and its own
            @font-face URL is relative ("./fonts/…"), so it only resolves when
            the stylesheet is served from /vendor/. A CSS @import of an absolute
            path is resolved by the bundler as a module and fails the build. */}
        <link rel="stylesheet" href="/vendor/tabler-icons.min.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
