// Global dashboard keyboard shortcuts (E18-006). One table drives both the key
// handler and the help sheet, so the sheet can never list a shortcut that doesn't
// work (or miss one that does).
export type ShortcutAction = "palette" | "help" | "theme" | "go-overview";

export type Shortcut = { keys: string[]; label: string; action: ShortcutAction };

// `keys` is the display form; sequences are space-separated in matching below.
export const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘K", "Ctrl K"], label: "Open the command palette", action: "palette" },
  { keys: ["/"], label: "Open the command palette", action: "palette" },
  { keys: ["?"], label: "Show keyboard shortcuts", action: "help" },
  { keys: ["G then O"], label: "Go to Overview", action: "go-overview" },
  { keys: ["T"], label: "Toggle light / dark theme", action: "theme" },
];

export const SEQUENCE_TIMEOUT_MS = 1200;

export type KeyInput = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  // True when focus is in a text field, select, or contenteditable: plain-letter
  // shortcuts must never steal typing.
  editable?: boolean;
};

// Returns the action for this key press (if any) and the pending sequence prefix
// to carry into the next press. Cmd/Ctrl+K is handled by the palette itself.
export function resolveShortcut(input: KeyInput, pending: string | null): { action: ShortcutAction | null; pending: string | null } {
  if (input.editable || input.metaKey || input.ctrlKey || input.altKey) return { action: null, pending: null };
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (pending === "g") {
    if (key === "o") return { action: "go-overview", pending: null };
    return { action: null, pending: null };
  }
  switch (key) {
    case "?":
      return { action: "help", pending: null };
    case "/":
      return { action: "palette", pending: null };
    case "t":
      return { action: "theme", pending: null };
    case "g":
      return { action: null, pending: "g" };
    default:
      return { action: null, pending: null };
  }
}

export function isEditableTarget(target: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["button", "checkbox", "radio", "submit", "reset"].includes((target.type ?? "text").toLowerCase());
  return false;
}

// The palette listens for this so "/" and the help sheet can open it.
export const OPEN_PALETTE_EVENT = "ems:open-palette";
export const OPEN_SHORTCUTS_EVENT = "ems:open-shortcuts";
