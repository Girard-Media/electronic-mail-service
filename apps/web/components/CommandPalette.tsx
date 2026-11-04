"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { buildCommands, filterCommands, moveActive, type Command, type Workspace } from "@/lib/dash-nav";
import { applyTheme, currentTheme, otherTheme, subscribeTheme } from "@/lib/theme";
import { switchWorkspace } from "@/components/WorkspaceSwitcher";

// Dashboard command palette shell (E18-004). Opens with Cmd/Ctrl+K or the top-bar
// button; a modal dialog with a combobox input driving a listbox (aria-activedescendant),
// arrow/Home/End/Enter/Escape keys, and focus returned to whatever opened it.
export function CommandPalette(props: { workspaces: Workspace[]; activeOrgId: string | null }) {
  const router = useRouter();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "dark" as const);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const commands = useMemo(
    () => buildCommands({ workspaces: props.workspaces, activeOrgId: props.activeOrgId, theme }),
    [props.workspaces, props.activeOrgId, theme],
  );
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  const show = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setError(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const run = async (cmd: Command | undefined) => {
    if (!cmd) return;
    if (cmd.kind === "theme") {
      applyTheme(otherTheme(theme));
      close();
    } else if (cmd.kind === "href") {
      setOpen(false);
      if (/^https?:/.test(cmd.href)) window.location.assign(cmd.href);
      else router.push(cmd.href);
    } else {
      try {
        await switchWorkspace(cmd.orgId);
        close();
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void run(results[active]);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setActive((i) => moveActive(e.key, i, results.length));
    } else if (e.key === "Tab") {
      // Keep focus inside the modal: the input is its only tab stop.
      e.preventDefault();
    }
  };

  const optionId = (i: number) => `${baseId}-opt-${i}`;

  return (
    <>
      <button type="button" className="btn cmdk-trigger" onClick={show} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
        <i className="ti ti-search" aria-hidden="true" />
        <span>Search or jump to…</span>
        <kbd aria-hidden="true">⌘K</kbd>
      </button>
      {open ? (
        <div className="cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="cmdk-input">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={results.length ? optionId(active) : undefined}
                aria-label="Search commands"
                placeholder="Type a command or page…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
              />
            </div>
            <ul className="cmdk-list" id={listId} role="listbox" aria-label="Commands">
              {results.map((cmd, i) => (
                <li
                  key={cmd.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className="cmdk-item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => void run(cmd)}
                >
                  <i className={`ti ${cmd.icon}`} aria-hidden="true" />
                  <span>{cmd.label}</span>
                  <span className="cmdk-group">{cmd.group}</span>
                </li>
              ))}
            </ul>
            {results.length === 0 ? <p className="cmdk-empty">No matching commands.</p> : null}
            {error ? (
              <p className="cmdk-empty" role="alert">
                {error}
              </p>
            ) : null}
            <p className="cmdk-hint" aria-hidden="true">
              ↑↓ to move · Enter to run · Esc to close
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
