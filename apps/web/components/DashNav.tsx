"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASH_NAV } from "@/lib/dash-nav";

// Dashboard sidebar (E18-004). Ready sections are real links with aria-current on the
// current page; sections not ported yet are announced as unavailable rather than
// rendered as links that go nowhere.
export function DashNav() {
  const pathname = usePathname();
  return (
    <nav className="dash-nav" aria-label="Dashboard">
      <ul>
        {DASH_NAV.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.id}>
              {item.ready ? (
                <Link
                  href={item.href}
                  className={`dash-nav-item${current ? " active" : ""}`}
                  aria-current={current ? "page" : undefined}
                >
                  <i className={`ti ${item.icon}`} aria-hidden="true" />
                  {item.label}
                </Link>
              ) : (
                <span className="dash-nav-item soon" aria-disabled="true">
                  <i className={`ti ${item.icon}`} aria-hidden="true" />
                  {item.label}
                  <span className="dash-soon">
                    soon<span className="sr-only"> (not available yet)</span>
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
