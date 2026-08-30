// {{variable}} interpolation for email templates. Adapted (pure TS, no deps) from
// the Bootspring reference engine. Syntax: {{path.to.value|formatter|'default'}}.
// Safe by design — never throws; missing values become the default or "".
//
// IMPORTANT: this returns RAW text. Callers rendering into HTML MUST escape the
// result (render.ts does) — interpolated `data` can be end-user controlled.

export type VariableContext = Record<string, unknown>;

export type Formatter =
  | "currency"
  | "date"
  | "datetime"
  | "time"
  | "uppercase"
  | "lowercase"
  | "capitalize"
  | "number"
  | "percent";

const FORMATTERS = new Set<Formatter>([
  "currency", "date", "datetime", "time",
  "uppercase", "lowercase", "capitalize", "number", "percent",
]);

const VAR_RE = /\{\{([^}]+)\}\}/g;

/** Replace every {{path|formatter|'default'}} with its value from context. */
export function interpolate(template: string, context: VariableContext): string {
  if (!template) return "";
  return template.replace(VAR_RE, (_m, expr: string) => {
    try {
      const { segments, formatter, defaultValue } = parseExpr(expr.trim());
      const value = resolve(segments, context);
      return format(value, formatter, defaultValue);
    } catch {
      return "";
    }
  });
}

/** All variable paths referenced in a template (for UI hints / validation). */
export function extractVariables(template: string): string[] {
  if (!template) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_RE);
  while ((m = re.exec(template)) !== null) {
    const path = (m[1] ?? "").trim().split("|")[0]?.trim();
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

interface Parsed {
  segments: string[];
  formatter?: Formatter;
  defaultValue?: string;
}

function parseExpr(expression: string): Parsed {
  const parts = expression.split("|").map((p) => p.trim());
  const path = parts[0] ?? "";
  const segments = path.split(".").filter(Boolean);
  let formatter: Formatter | undefined;
  let defaultValue: string | undefined;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (isQuoted(part)) defaultValue = part.slice(1, -1);
    else if (FORMATTERS.has(part as Formatter)) formatter = part as Formatter;
  }
  return { segments, formatter, defaultValue };
}

function isQuoted(v: string): boolean {
  return (
    v.length >= 2 &&
    ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))
  );
}

// Walk dot-path segments; arrays auto-index to their first element unless the
// segment is a number. Never throws.
function resolve(segments: string[], context: VariableContext): unknown {
  if (segments.length === 0) return undefined;
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number.parseInt(segment, 10);
      if (!Number.isNaN(idx)) current = current[idx];
      else {
        const first = current[0];
        if (first === null || first === undefined) return undefined;
        current = (first as Record<string, unknown>)[segment];
      }
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function format(value: unknown, formatter?: Formatter, defaultValue?: string): string {
  if (value === null || value === undefined) return defaultValue ?? "";
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(", ") || defaultValue || "";
  }
  const result = formatter ? applyFormatter(value, formatter) : String(value);
  if (result === "" && defaultValue !== undefined) return defaultValue;
  return result;
}

function applyFormatter(value: unknown, formatter: Formatter): string {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value));
  switch (formatter) {
    case "currency":
      return Number.isNaN(num)
        ? String(value)
        : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
    case "number":
      return Number.isNaN(num) ? String(value) : new Intl.NumberFormat("en-US").format(num);
    case "percent":
      return Number.isNaN(num)
        ? String(value)
        : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(num / 100);
    case "uppercase":
      return String(value).toUpperCase();
    case "lowercase":
      return String(value).toLowerCase();
    case "capitalize": {
      const s = String(value);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }
    case "date":
    case "datetime":
    case "time": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      if (formatter === "time") return d.toLocaleTimeString("en-US");
      if (formatter === "datetime") return d.toLocaleString("en-US");
      return d.toLocaleDateString("en-US");
    }
    default:
      return String(value);
  }
}
