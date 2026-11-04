"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Workspace } from "@/lib/dash-nav";

// Switch the active organization (E18-004). Posts to the same-origin bridge in
// app/api/workspace/switch, which forwards to the API's membership-checked switch.
// Callers router.refresh() afterwards so the server layout re-reads the session.
export async function switchWorkspace(orgId: string): Promise<void> {
  const res = await fetch("/api/workspace/switch", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message || `Switch failed (HTTP ${res.status}).`);
  }
}

export function WorkspaceSwitcher(props: {
  workspaces: Workspace[];
  activeOrgId: string | null;
  activeName: string;
  role: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canSwitch = props.workspaces.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = (
    <>
      <i className="ti ti-building" aria-hidden="true" />
      <strong>{props.activeName}</strong>
      {props.role ? <span className="dash-role">{props.role}</span> : null}
    </>
  );

  if (!canSwitch) return <div className="dash-org">{label}</div>;

  return (
    <div className="ws-switch" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="dash-org ws-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <i className="ti ti-selector" aria-hidden="true" />
        <span className="sr-only">Switch workspace</span>
      </button>
      {open ? (
        <ul className="ws-menu" id={menuId} aria-label="Workspaces">
          {props.workspaces.map((ws) => {
            const active = ws.orgId === props.activeOrgId;
            return (
              <li key={ws.orgId}>
                <button
                  type="button"
                  className="ws-item"
                  aria-current={active ? "true" : undefined}
                  disabled={busy !== null}
                  onClick={async () => {
                    if (active) return setOpen(false);
                    setBusy(ws.orgId);
                    setError(null);
                    try {
                      await switchWorkspace(ws.orgId);
                      setOpen(false);
                      router.refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                    setBusy(null);
                  }}
                >
                  <span className="ws-name">{ws.name}</span>
                  <span className="ws-meta">{busy === ws.orgId ? "Switching…" : active ? "Current" : ws.role}</span>
                </button>
              </li>
            );
          })}
          {error ? (
            <li role="alert" className="ws-error">
              {error}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
