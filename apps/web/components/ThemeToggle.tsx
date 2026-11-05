"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, currentTheme, otherTheme, subscribeTheme } from "@/lib/theme";

// Light/dark switch (E18-004). A real <button> with aria-pressed, so assistive tech
// hears "Light theme, toggle button, pressed/not pressed". The server snapshot is
// "dark" (the :root default); the boot script in app/layout.tsx has already applied
// a stored light choice before hydration, and the store re-reads it on the client.
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "dark" as const);
  const light = theme === "light";
  return (
    <button
      type="button"
      className="btn icon-btn"
      aria-pressed={light}
      aria-label="Light theme"
      title={light ? "Switch to dark theme" : "Switch to light theme"}
      onClick={() => applyTheme(otherTheme(theme))}
    >
      <i className={`ti ${light ? "ti-sun" : "ti-moon"}`} aria-hidden="true" />
    </button>
  );
}
