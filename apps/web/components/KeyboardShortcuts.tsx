"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  OPEN_PALETTE_EVENT,
  OPEN_SHORTCUTS_EVENT,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
  isEditableTarget,
  resolveShortcut,
} from "@/lib/shortcuts";
import { applyTheme, currentTheme, otherTheme } from "@/lib/theme";

// Global dashboard shortcuts + the "?" help sheet (E18-006). Discoverable three
// ways: "?" anywhere, the palette's "Keyboard shortcuts" command, and the top-bar
// keyboard button.
export function KeyboardShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = () => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return; // a dialog owns the keyboard
      const { action, pending: next } = resolveShortcut(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          editable: isEditableTarget(e.target as HTMLInputElement | null),
        },
        pending.current,
      );
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      if (next) timer.current = setTimeout(() => (pending.current = null), SEQUENCE_TIMEOUT_MS);
      if (!action) return;
      e.preventDefault();
      if (action === "help") show();
      else if (action === "palette") window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
      else if (action === "theme") applyTheme(otherTheme(currentTheme()));
      else if (action === "go-overview") router.push("/dashboard");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        setOpen(false);
        returnFocus.current?.focus?.();
      } else if (e.key === "Tab") {
        e.preventDefault(); // the close button is the dialog's only tab stop
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    returnFocus.current?.focus?.();
  };

  return (
    <>
      <button
        type="button"
        className="btn icon-btn"
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts="Shift+?"
        aria-haspopup="dialog"
        title="Keyboard shortcuts (?)"
        onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}
      >
        <i className="ti ti-keyboard" aria-hidden="true" />
      </button>
      {open ? (
        <div className="cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="cmdk kbd-sheet" role="dialog" aria-modal="true" aria-labelledby="kbd-sheet-title">
            <div className="kbd-sheet-head">
              <h2 id="kbd-sheet-title">Keyboard shortcuts</h2>
              <button ref={closeRef} type="button" className="btn icon-btn" aria-label="Close" onClick={close}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <dl className="kbd-list">
              {SHORTCUTS.map((s) => (
                <div key={`${s.action}-${s.keys.join()}`} className="kbd-row">
                  <dt>{s.label}</dt>
                  <dd>
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 ? <span className="kbd-or"> or </span> : null}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="cmdk-hint">Shortcuts are off while you type in a field. Esc closes this sheet.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
