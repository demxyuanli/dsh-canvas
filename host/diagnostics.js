/** Canvas diagnostic codes. One structure serves the tool, the error card, and the host log. */

// Emitted today: E_PARSE, E_PARSE_IMPORT, E_NO_DEFAULT, E_SIDE_EFFECT,
// E_DYNAMIC, E_EXTERNAL, E_DATA_NOT_LITERAL, E_TOO_LARGE, W_NO_DATA,
// W_LARGE_FILE, W_REMOTE_URL  (all by the compile-time scanner).
// Reserved, carried here so the registry and the docs agree on names:
// W_UNKNOWN_PROP (needs a per-component prop table in the checker),
// W_MANY_ROWS (a render-time condition, never a compile diagnostic),
// W_DEPRECATED (a client-runtime kit signal, not a host diagnostic),
// W_NO_METADATA (discovery reports metadata inline instead).
export const CODES = {
  E_PARSE:            { severity: "error",   hint: "Fix the syntax at the reported line; sucrase could not transform the file." },
  E_PARSE_IMPORT:     { severity: "error",   hint: "A canvas may import only \"dsh/canvas\". React and the kit are injected by the host." },
  E_NO_DEFAULT:       { severity: "error",   hint: "Add export default function MyCanvas() { ... }." },
  E_SIDE_EFFECT:      { severity: "error",   hint: "Move work out of the module body: a canvas must be a pure render." },
  E_DYNAMIC:          { severity: "error",   hint: "eval, new Function and dynamic import() are not available in a canvas." },
  E_EXTERNAL:         { severity: "error",   hint: "Remove iframes; a canvas renders only host components and inline SVG." },
  E_DATA_NOT_LITERAL: { severity: "error",   hint: "export const DATA must be a plain literal: no function calls, spreads of non-literals, or template strings." },
  E_TOO_LARGE:        { severity: "error",   hint: "Split the canvas into several files, or move history out of the inline data." },
  W_NO_DATA:          { severity: "warning", hint: "Add export const DATA = { ... } as const so canvas_read can slice it instead of reading the whole file." },
  W_LARGE_FILE:       { severity: "warning", hint: "A canvas this size is heading back towards hand-maintained markdown; consider splitting it." },
  W_MANY_ROWS:        { severity: "warning", hint: "Render fewer rows by filtering, or split the canvas." },
  W_UNKNOWN_PROP:     { severity: "warning", hint: "Check the prop name against skills/canvas/references/kit.md." },
  W_REMOTE_URL:       { severity: "warning", hint: "A canvas cannot fetch remote content; embed the data instead." },
  W_NO_METADATA:      { severity: "warning", hint: "Add a /** @canvas title: ... */ header so the canvas directory can label it." },
};

/**
 * Build one diagnostic.
 * @param code - a key of CODES.
 * @param message - human sentence; must be actionable on its own.
 * @param extra - optional { line, col, hint, severity } overrides.
 * @returns the diagnostic record.
 */
export function mk(code, message, extra) {
  const base = CODES[code] ?? { severity: "error", hint: undefined };
  const d = { code, severity: base.severity, message };
  const hint = extra && extra.hint !== undefined ? extra.hint : base.hint;
  if (hint !== undefined) d.hint = hint;
  if (extra && extra.severity !== undefined) d.severity = extra.severity;
  if (extra && extra.line !== undefined) d.line = extra.line;
  if (extra && extra.col !== undefined) d.col = extra.col;
  return d;
}

/** Offset -> 1-based { line, col } for source text. */
export function lineColOf(text, offset) {
  const upto = text.slice(0, Math.max(0, offset));
  const line = upto.split("\n").length;
  const lastBreak = upto.lastIndexOf("\n");
  const col = upto.length - lastBreak;
  return { line, col };
}

/** Human summary for tool output and cards. */
export function summarize(diagnostics) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  return errors + " error(s), " + warnings + " warning(s)";
}
