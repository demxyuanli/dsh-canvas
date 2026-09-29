/** Canvas discovery: metadata header parsing plus a bounded workspace walk. */

import { promises as fs } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "out", ".canvas", ".target-gate", "graphify-out", "__pycache__"]);

/** Parse the optional /** @canvas title: ... *\/ header. Never executes the file. */
export function readMetadata(source) {
  const m = /\/\*\*\s*@canvas\b([\s\S]*?)\*\//.exec(source);
  if (m === null) return { ok: true, found: false, meta: {} };
  const meta = {};
  const bad = [];
  for (const line of m[1].split("\n")) {
    const cleaned = line.replace(/^\s*\*?\s?/, "").trim();
    if (cleaned === "") continue;
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/.exec(cleaned);
    if (kv === null) { bad.push(cleaned); continue; }
    meta[kv[1]] = kv[2].trim();
  }
  return { ok: bad.length === 0, found: true, meta, bad };
}

/**
 * Walk a workspace for *.canvas.tsx, bounded by depth and file count.
 * @returns an array of { path, title, description, icon, bytes, lines }.
 */
export async function discoverCanvases(root, options = {}) {
  const maxDepth = options.maxDepth ?? 6;
  const maxFiles = options.maxFiles ?? 200;
  const found = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || found.length >= maxFiles) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".canvas.tsx")) continue;
      let source = "";
      try { source = await fs.readFile(full, "utf8"); } catch { continue; }
      const meta = readMetadata(source);
      // A hidden canvas is a draft or a retired board: it stays in the repo but
      // keeps out of the picker unless the caller asks for everything.
      if (meta.meta.hidden === "true" && options.includeHidden !== true) continue;
      found.push({
        path: full,
        title: typeof meta.meta.title === "string" ? meta.meta.title : path.basename(entry.name, ".canvas.tsx"),
        description: meta.meta.description,
        icon: meta.meta.icon,
        bytes: Buffer.byteLength(source, "utf8"),
        lines: source.split("\n").length,
      });
    }
  }
  await walk(root, 0);
  return found;
}
