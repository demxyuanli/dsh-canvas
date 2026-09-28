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

function parseValue(text, i) {
  i = skipSpace(text, i);
  const ch = text[i];
  if (ch === "{") {
    const obj = {};
    i = skipSpace(text, i + 1);
    if (text[i] === "}") return { value: obj, end: i + 1 };
    for (;;) {
      i = skipSpace(text, i);
      let key;
      if (text[i] === "\"" || text[i] === "'") { const s = parseString(text, i); key = s.value; i = s.end; }
      else {
        const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
        if (m === null) throw new Error("expected a property name");
        key = m[0];
        i += key.length;
      }
      i = skipSpace(text, i);
      if (text[i] !== ":") throw new Error("expected \":\" after property " + key);
      const v = parseValue(text, i + 1);
      obj[key] = v.value;
      i = skipSpace(text, v.end);
      if (text[i] === ",") { i = skipSpace(text, i + 1); if (text[i] === "}") return { value: obj, end: i + 1 }; continue; }
      if (text[i] === "}") return { value: obj, end: i + 1 };
      throw new Error("expected \",\" or \"}\" in object");
    }
  }
  if (ch === "[") {
    const arr = [];
    i = skipSpace(text, i + 1);
    if (text[i] === "]") return { value: arr, end: i + 1 };
    for (;;) {
      const v = parseValue(text, i);
      arr.push(v.value);
      i = skipSpace(text, v.end);
      if (text[i] === ",") { i = skipSpace(text, i + 1); if (text[i] === "]") return { value: arr, end: i + 1 }; continue; }
      if (text[i] === "]") return { value: arr, end: i + 1 };
      throw new Error("expected \",\" or \"]\" in array");
    }
  }
  if (ch === "\"" || ch === "'") return parseString(text, i);
  if (ch === "`") throw new Error("template strings are not allowed in DATA");
  const num = /^-?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/.exec(text.slice(i));
  if (num !== null) return { value: Number(num[0]), end: i + num[0].length };
  const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
  if (word !== null) {
    const w = word[0];
    if (w === "true") return { value: true, end: i + 4 };
    if (w === "false") return { value: false, end: i + 5 };
    if (w === "null") return { value: null, end: i + 4 };
    if (w === "undefined") return { value: null, end: i + 9 };
    if (w === "NaN") return { value: null, end: i + 3 };
    throw new Error("DATA may not reference the identifier " + w);
  }
  throw new Error("unexpected character " + JSON.stringify(ch ?? "end of input"));
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
