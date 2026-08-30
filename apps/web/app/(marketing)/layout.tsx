import type { ReactNode } from "react";
import { SiteNav } from "../../components/SiteNav";
import { SiteFooter } from "../../components/SiteFooter";

// Marketing route group: every apex page (/, /features, /pricing, /docs,
// /deliverability, /blog) gets the shared nav + footer chrome. Pages render only their
// own sections. The (marketing) segment is a layout group — it adds no URL segment.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
    </>
  );
}
