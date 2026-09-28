/** Static, pre-execution checks over the canvas source. */

import { mk } from "./diagnostics.js";

// Only the kit. `react` resolves to the host instance through the module wrapper,
// but the documented surface stays single-entry so canvases cannot drift into a
// second style; the wrapper keeps a react fallback for defence in depth.
const ALLOWED = new Set(["dsh/canvas"]);

/**
 * Blank out string literals, template literals and comments while preserving
 * every offset and newline, so code-pattern scans cannot trip over prose or
 * paths that merely look like calls.
 * @param source - canvas source text.
 * @returns text of the same length where non-code characters became spaces.
 */
export function blankNonCode(source) {
  const chars = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") { chars[i] = " "; i++; }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) { if (source[i] !== "\n") chars[i] = " "; i++; }
      if (i < source.length) { chars[i] = " "; chars[i + 1] = " "; i += 2; }
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      const quote = ch;
      chars[i] = " ";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") { chars[i] = " "; if (i + 1 < source.length && source[i + 1] !== "\n") chars[i + 1] = " "; i += 2; continue; }
        if (source[i] !== "\n") chars[i] = " ";
        i++;
      }
      if (i < source.length) { chars[i] = " "; i++; }
      continue;
    }
    i++;
  }
  return chars.join("");
}

function eachMatch(text, re, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) fn(m);
}

/**
 * @param source - canvas source.
 * @returns diagnostics from the source-level rules (imports, side effects, dynamic code, external embeds).
 */
export function scanSource(source) {
  const diagnostics = [];
  const code = blankNonCode(source);
  const at = (offset) => {
    const upto = source.slice(0, offset);
    return { line: upto.split("\n").length, col: upto.length - upto.lastIndexOf("\n") };
  };

  eachMatch(source, /\bfrom\s*[\"\']([^\"\']+)[\"\']/g, (m) => {
    if (!ALLOWED.has(m[1])) diagnostics.push(mk("E_PARSE_IMPORT", "A canvas may not import \"" + m[1] + "\".", at(m.index)));
  });
  eachMatch(code, /\brequire\s*\(\s*[\"\']([^\"\']+)[\"\']\s*\)/g, (m) => {
    if (!ALLOWED.has(m[1])) diagnostics.push(mk("E_PARSE_IMPORT", "A canvas may not require \"" + m[1] + "\".", at(m.index)));
  });
  eachMatch(code, /\bimport\s*\(/g, (m) => diagnostics.push(mk("E_DYNAMIC", "dynamic import() is not allowed in a canvas.", at(m.index))));
  eachMatch(code, /\beval\s*\(/g, (m) => diagnostics.push(mk("E_DYNAMIC", "eval is not allowed in a canvas.", at(m.index))));
  eachMatch(code, /new\s+Function\s*\(/g, (m) => diagnostics.push(mk("E_DYNAMIC", "new Function is not allowed in a canvas.", at(m.index))));
  const sideEffects = [
    [/\bfetch\s*\(/g, "fetch"],
    [/\bXMLHttpRequest\b/g, "XMLHttpRequest"],
    [/\bWebSocket\b/g, "WebSocket"],
    [/\blocalStorage\b/g, "localStorage (use useCanvasState/useCanvasOverlay)"],
    [/\bsessionStorage\b/g, "sessionStorage (use useCanvasState/useCanvasOverlay)"],
    [/\bindexedDB\b/g, "indexedDB"],
    [/\bdocument\s*\./g, "document"],
    [/\bwindow\s*\./g, "window"],
    [/\bsetTimeout\s*\(/g, "setTimeout"],
    [/\bsetInterval\s*\(/g, "setInterval"],
    [/\brequestAnimationFrame\s*\(/g, "requestAnimationFrame"],
  ];
  for (const pair of sideEffects) {
    eachMatch(code, pair[0], (m) => diagnostics.push(mk("E_SIDE_EFFECT", "A canvas may not use " + pair[1] + ".", at(m.index))));
  }
  eachMatch(code, /<iframe\b/g, (m) => diagnostics.push(mk("E_EXTERNAL", "A canvas may not embed an iframe.", at(m.index))));
  eachMatch(code, /<img\b[^>]*\bsrc\s*=/g, (m) => diagnostics.push(mk("E_EXTERNAL", "A canvas may not load remote images.", at(m.index))));
  eachMatch(source, /https?:\/\//g, (m) => diagnostics.push(mk("W_REMOTE_URL", "Remote URL in a canvas is not fetchable; embed the data.", at(m.index))));
  eachMatch(code, /console\s*\./g, (m) => diagnostics.push(mk("E_SIDE_EFFECT", "console is not available in a canvas; surface it through the UI.", at(m.index))));

  return diagnostics;
}
