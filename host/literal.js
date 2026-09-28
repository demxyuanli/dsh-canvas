/**
 * Tolerant parser for the JSON-compatible literal behind export const DATA.
 *
 * Deliberately NOT eval/vm: canvas_read must stay safe when the source is hostile.
 * Accepts trailing commas, single quotes, unquoted keys, comments, and the
 * keywords true/false/null/undefined. Rejects calls, template strings, spreads
 * of non-literals and any identifier reference.
 */

import { mk } from "./diagnostics.js";

function skipSpace(text, i) {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    return i;
  }
}

function parseString(text, i) {
  const quote = text[i];
  i++;
  let out = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === "u") { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 4; }
      else out += next;
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, end: i + 1 };
    if (ch === "\n") throw new Error("unterminated string");
    out += ch;
    i++;
  }
  throw new Error("unterminated string");
}

/**
 * Parse one value while recording the source spans a merge-back needs.
 * The plain parser below is this parser minus the bookkeeping, so
 * canvas_read and canvas_state_merge can never disagree about what DATA is.
 * @param text - source text.
 * @param i - index of the value's first character.
 * @returns { kind, value, start, end, fields?, fieldOrder?, items? }; object
 *   fields map name -> { value, valueStart, valueEnd, keyStart, node }.
 */
export function parseValueSpanned(text, i) {
  const start = skipSpace(text, i);
  const ch = text[start];
  if (ch === "{") {
    const obj = {};
    const fields = {};
    const fieldOrder = [];
    let cursor = skipSpace(text, start + 1);
    if (text[cursor] === "}") return { kind: "object", value: obj, start, end: cursor + 1, fields, fieldOrder };
    for (;;) {
      cursor = skipSpace(text, cursor);
      const keyStart = cursor;
      let key;
      if (text[cursor] === "\"" || text[cursor] === "'") { const s = parseString(text, cursor); key = s.value; cursor = s.end; }
      else {
        const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(cursor));
        if (m === null) throw new Error("expected a property name");
        key = m[0];
        cursor += key.length;
      }
      cursor = skipSpace(text, cursor);
      if (text[cursor] !== ":") throw new Error("expected \":\" after property " + key);
      const v = parseValueSpanned(text, cursor + 1);
      obj[key] = v.value;
      fields[key] = { value: v.value, valueStart: v.start, valueEnd: v.end, keyStart, node: v };
      fieldOrder.push(key);
      cursor = skipSpace(text, v.end);
      if (text[cursor] === ",") { cursor = skipSpace(text, cursor + 1); if (text[cursor] === "}") return { kind: "object", value: obj, start, end: cursor + 1, fields, fieldOrder }; continue; }
      if (text[cursor] === "}") return { kind: "object", value: obj, start, end: cursor + 1, fields, fieldOrder };
      throw new Error("expected \",\" or \"}\" in object");
    }
  }
  if (ch === "[") {
    const arr = [];
    const items = [];
    let cursor = skipSpace(text, start + 1);
    if (text[cursor] === "]") return { kind: "array", value: arr, start, end: cursor + 1, items };
    for (;;) {
      const v = parseValueSpanned(text, cursor);
      arr.push(v.value);
      items.push(v);
      cursor = skipSpace(text, v.end);
      if (text[cursor] === ",") { cursor = skipSpace(text, cursor + 1); if (text[cursor] === "]") return { kind: "array", value: arr, start, end: cursor + 1, items }; continue; }
      if (text[cursor] === "]") return { kind: "array", value: arr, start, end: cursor + 1, items };
      throw new Error("expected \",\" or \"]\" in array");
    }
  }
  if (ch === "\"" || ch === "'") { const s = parseString(text, start); return { kind: "scalar", value: s.value, start, end: s.end }; }
  if (ch === "`") throw new Error("template strings are not allowed in DATA");
  const num = /^-?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/.exec(text.slice(start));
  if (num !== null) return { kind: "scalar", value: Number(num[0]), start, end: start + num[0].length };
  const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(start));
  if (word !== null) {
    const w = word[0];
    if (w === "true") return { kind: "scalar", value: true, start, end: start + 4 };
    if (w === "false") return { kind: "scalar", value: false, start, end: start + 5 };
    if (w === "null") return { kind: "scalar", value: null, start, end: start + 4 };
    if (w === "undefined") return { kind: "scalar", value: null, start, end: start + 9 };
    if (w === "NaN") return { kind: "scalar", value: null, start, end: start + 3 };
    throw new Error("DATA may not reference the identifier " + w);
  }
  throw new Error("unexpected character " + JSON.stringify(ch ?? "end of input"));
}

function parseValue(text, i) {
  const node = parseValueSpanned(text, i);
  return { value: node.value, end: node.end };
}

/**
 * Find and parse the DATA literal in transformed (plain JS) source.
 * @param js - sucrase output.
 * @returns { ok: true, value, start, end } or { ok: false, diagnostic }.
 */
export function extractData(js) {
  const m = /(?:^|[\s;])const\s+DATA\s*=\s*/.exec(js);
  if (m === null) return { ok: false, missing: true };
  const start = m.index + m[0].length;
  try {
    const parsed = parseValue(js, start);
    return { ok: true, value: parsed.value, start, end: parsed.end };
  } catch (error) {
    return { ok: false, diagnostic: mk("E_DATA_NOT_LITERAL", "export const DATA is not a plain literal: " + error.message) };
  }
}
