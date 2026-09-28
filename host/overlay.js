/** Sidecar overlay: human edits that must stay visible to the agent. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const OVERLAY_VERSION = 1;

/** Sidecar path for a canvas: <dir>/.canvas/<stem>.state.json */
export function overlayPathFor(canvasPath) {
  const dir = path.dirname(canvasPath);
  const stem = path.basename(canvasPath).replace(/\.canvas\.tsx$/, "").replace(/\.tsx$/, "");
  return path.join(dir, ".canvas", stem + ".state.json");
}

export function sha1(text) {
  return createHash("sha1").update(String(text)).digest("hex").slice(0, 16);
}

function emptyDoc(canvasPath) {
  return { version: OVERLAY_VERSION, canvas: canvasPath, sourceSha1: null, updatedAt: null, overlays: {} };
}

/** Read a sidecar; a missing or unreadable file yields an empty document, never a throw. */
export async function readOverlay(canvasPath) {
  try {
    const raw = await fs.readFile(overlayPathFor(canvasPath), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || typeof parsed.overlays !== "object" || parsed.overlays === null) {
      return emptyDoc(canvasPath);
    }
    return {
      version: OVERLAY_VERSION,
      canvas: canvasPath,
      sourceSha1: typeof parsed.sourceSha1 === "string" ? parsed.sourceSha1 : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      overlays: parsed.overlays,
    };
  } catch {
    return emptyDoc(canvasPath);
  }
}

/** Apply one patch or clear one/no id, then persist atomically. */
export async function writeOverlay(canvasPath, change) {
  const doc = await readOverlay(canvasPath);
  const key = String(change.key);
  const bucket = doc.overlays[key] === undefined ? {} : doc.overlays[key];
  const now = new Date().toISOString();
  if (change.clear === true) {
    if (change.id === undefined) delete doc.overlays[key];
    else {
      delete bucket[String(change.id)];
      if (Object.keys(bucket).length === 0) delete doc.overlays[key];
      else doc.overlays[key] = bucket;
    }
  } else {
    if (change.id === undefined) throw new Error("overlaySet requires an id");
    const id = String(change.id);
    const patch = change.patch && typeof change.patch === "object" ? change.patch : {};
    bucket[id] = Object.assign({}, bucket[id], patch, { at: now, by: "user" });
    doc.overlays[key] = bucket;
  }
  doc.sourceSha1 = typeof change.sourceSha1 === "string" ? change.sourceSha1 : doc.sourceSha1;
  doc.updatedAt = now;
  const target = overlayPathFor(canvasPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = target + ".tmp-" + process.pid + "-" + Date.now();
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
  await fs.rename(tmp, target);
  return doc;
}

/**
 * Merge sidecar patches into inline rows, marking stale and orphan entries.
 * @param rows - the DATA rows for one key.
 * @param bucket - overlays[key].
 * @param sourceSha1 - current source hash, for the stale flag.
 * @param docSha1 - the hash recorded when the overlay was written.
 * @returns { items, orphanIds, stale }.
 */
export function mergeRows(rows, bucket, sourceSha1, docSha1) {
  const list = Array.isArray(rows) ? rows : [];
  const patches = bucket && typeof bucket === "object" ? bucket : {};
  const seen = new Set();
  const items = list.map((row) => {
    if (row === null || typeof row !== "object" || typeof row.id !== "string") return row;
    seen.add(row.id);
    const patch = patches[row.id];
    if (patch === undefined) return row;
    const merged = Object.assign({}, row);
    for (const k of Object.keys(patch)) { if (k !== "at" && k !== "by") merged[k] = patch[k]; }
    merged.__overlay = { at: patch.at ?? null, by: patch.by ?? null };
    return merged;
  });
  const orphanIds = Object.keys(patches).filter((id) => !seen.has(id));
  const stale = Boolean(docSha1) && Boolean(sourceSha1) && docSha1 !== sourceSha1;
  return { items, orphanIds, stale };
}
