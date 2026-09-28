/**
 * Merge a canvas sidecar back into its inline DATA, in place.
 *
 * The promise is "minimal field replacement": only the value spans of the
 * patched fields are rewritten, and a field the row does not have yet is
 * inserted after the last one. The render code, comments, ordering, and every
 * untouched row stay byte-identical, so the human still recognises the file
 * they reviewed.
 */

import { parseValueSpanned } from "./literal.js";
import { blankNonCode } from "./scan.js";

const DATA_DECL = /(?:^|[\s;])const\s+DATA\s*=\s*/;

/**
 * Locate export const DATA in the ORIGINAL source and keep per-field spans.
 * blankNonCode preserves offsets, so the declaration is found without being
 * fooled by the words "const DATA" inside a string or comment.
 * @param source - canvas source text.
 * @returns { ok: true, node } or { ok: false, reason }.
 */
export function findDataNode(source) {
  let match;
  try {
    match = DATA_DECL.exec(blankNonCode(source));
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error) };
  }
  if (match === null) return { ok: false, reason: "no export const DATA declaration" };
  const start = match.index + match[0].length;
  try {
    const node = parseValueSpanned(source, start);
    if (node.kind !== "object") return { ok: false, reason: "DATA is not an object literal" };
    return { ok: true, node };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error) };
  }
}

/** Serialize a sidecar value as a pure DATA literal (the overlay only holds JSON). */
export function literalText(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(literalText).join(", ") + "]";
  if (typeof value === "object") {
    return "{ " + Object.keys(value).map((key) => key + ": " + literalText(value[key])).join(", ") + " }";
  }
  return "null";
}

/** The indentation of the line a key sits on, or "" when it is not line-leading. */
function indentOf(source, keyStart) {
  const lineStart = source.lastIndexOf("\n", keyStart) + 1;
  const prefix = source.slice(lineStart, keyStart);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

/**
 * Apply every (or the selected) sidecar patches to the source text.
 * @param source - current canvas source.
 * @param doc - a sidecar document as returned by readOverlay.
 * @param options - { key?: string, ids?: string[] } to narrow the merge.
 * @returns { ok, source, applied, skipped, changed, reason? }.
 */
export function mergeOverlaysIntoSource(source, doc, options) {
  const settings = options === undefined || options === null ? {} : options;
  const found = findDataNode(source);
  if (!found.ok) return { ok: false, reason: found.reason, source, applied: [], skipped: [], changed: false };
  const overlays = doc !== null && typeof doc === "object" && typeof doc.overlays === "object" && doc.overlays !== null ? doc.overlays : {};
  const onlyKey = typeof settings.key === "string" && settings.key !== "" ? settings.key : null;
  const onlyIds = Array.isArray(settings.ids) ? new Set(settings.ids.map(String)) : null;
  const edits = [];
  const applied = [];
  const skipped = [];

  for (const key of Object.keys(overlays)) {
    if (onlyKey !== null && key !== onlyKey) continue;
    const span = found.node.fields[key];
    if (span === undefined || span.node === undefined || span.node.kind !== "array") {
      skipped.push({ key, reason: "DATA." + key + " is missing or not an array" });
      continue;
    }
    const rows = new Map();
    for (const row of span.node.items) {
      if (row.kind !== "object") continue;
      const idField = row.fields.id;
      if (idField !== undefined) rows.set(String(idField.value), row);
    }
    const bucket = overlays[key];
    for (const id of Object.keys(bucket === null || typeof bucket !== "object" ? {} : bucket)) {
      if (onlyIds !== null && !onlyIds.has(id)) continue;
      const row = rows.get(id);
      if (row === undefined) { skipped.push({ key, id, reason: "no row with this id" }); continue; }
      const patch = bucket[id];
      const changed = [];
      const added = [];
      for (const name of Object.keys(patch === null || typeof patch !== "object" ? {} : patch)) {
        if (name === "at" || name === "by") continue;
        const existing = row.fields[name];
        if (existing !== undefined) {
          edits.push({ start: existing.valueStart, end: existing.valueEnd, text: literalText(patch[name]) });
          changed.push(name);
        } else {
          added.push([name, patch[name]]);
        }
      }
      if (added.length > 0) {
        const lastKey = row.fieldOrder.length === 0 ? null : row.fieldOrder[row.fieldOrder.length - 1];
        const anchor = lastKey === null ? null : row.fields[lastKey];
        const at = anchor === null ? row.start + 1 : anchor.valueEnd;
        const serialized = added.map((pair) => pair[0] + ": " + literalText(pair[1]));
        // Two formatting facts the source owns, not us: the row's own layout and
        // its line ending. A one-line row stays on one line, and a CRLF file must
        // not gain a bare LF - both would be valid JS and both would look like
        // damage to the human who reviewed the file.
        const inline = !source.slice(row.start, row.end).includes("\n");
        let text;
        if (inline) {
          text = at === row.start + 1 ? serialized.join(", ") : ", " + serialized.join(", ");
        } else {
          const eol = source.includes("\r\n") ? "\r\n" : "\n";
          const indent = anchor === null ? indentOf(source, row.start) + "  " : indentOf(source, anchor.keyStart);
          text = (anchor === null ? eol + indent : "," + eol + indent) + serialized.join("," + eol + indent);
        }
        edits.push({ start: at, end: at, text });
        for (const pair of added) changed.push(pair[0]);
      }
      if (changed.length > 0) applied.push({ key, id, fields: changed });
      else skipped.push({ key, id, reason: "no mergeable fields in this patch" });
    }
  }

  let out = source;
  for (const edit of edits.slice().sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { ok: true, source: out, applied, skipped, changed: applied.length > 0 };
}
