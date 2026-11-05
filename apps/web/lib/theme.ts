// Theme selection (E18-004). Dark is the default palette on :root (tokens.css);
// light is opt-in via <html data-theme="light">. The choice is the user's alone:
// stored in localStorage, never inferred from the OS, so the existing dark
// surface is unchanged for anyone who hasn't picked light.
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ems-theme";

export function resolveTheme(stored: string | null | undefined): Theme {
  return stored === "light" ? "light" : "dark";
}

export function otherTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

// Inlined in <head> so the stored theme applies before first paint (no flash of
// the dark palette for a light-theme user). Kept dependency-free and wrapped in
// try/catch: storage can throw in private modes, and the default is fine then.
export const THEME_BOOT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="light")document.documentElement.dataset.theme="light";}catch(e){}})();`;

// Browser-only: apply and persist a theme. No-op during SSR.
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the theme still applies for this page view.
  }
}

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return resolveTheme(document.documentElement.dataset.theme);
}

// Subscribe to theme changes made anywhere on the page (toggle button, command
// palette), for useSyncExternalStore.
export function subscribeTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
