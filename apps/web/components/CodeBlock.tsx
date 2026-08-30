import type { CSSProperties } from "react";

// Renders a `.code` block. The code is passed as a STRING child in an expression
// container ({code}), which preserves newlines + indentation exactly — unlike JSX text,
// where literal newlines collapse to spaces. Use this for any multi-line snippet.
export function CodeBlock({ code, style }: { code: string; style?: CSSProperties }) {
  return (
    <pre className="code" style={style}>
      {code}
    </pre>
  );
}
