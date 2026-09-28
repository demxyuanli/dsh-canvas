/**
 * Template corpus regression: every shipped template must compile clean and
 * expose a literal DATA block, because canvas_new hands them straight to an
 * agent as a starting point. A broken template is a broken first experience.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCanvas } from "../host/compile.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const corpus = [];

for (const dir of ["skills/canvas/templates", "examples"]) {
  let entries = [];
  try { entries = await fs.readdir(path.join(ROOT, dir)); } catch { continue; }
  for (const entry of entries) {
    if (entry.endsWith(".canvas.tsx")) corpus.push(path.join(ROOT, dir, entry));
  }
}

assert.ok(corpus.length >= 4, "expected the templates plus the example, found " + corpus.length);

let pass = 0;
let fail = 0;
for (const file of corpus) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const source = await fs.readFile(file, "utf8");
  const result = compileCanvas({ path: file, source: source });
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");
  if (errors.length > 0) {
    fail++;
    console.log("FAIL " + rel);
    for (const d of errors) console.log("     " + d.code + (d.line === undefined ? "" : " line " + d.line) + ": " + d.message);
    continue;
  }
  // The board is the tracking template: a thin row would silently undo the
  // detail/analysis it exists for, so the shape is part of the contract.
  if (rel.endsWith("board.canvas.tsx")) {
    const tasks = result.data === undefined ? undefined : result.data.tasks;
    assert.ok(Array.isArray(tasks) && tasks.length > 0, "board template must ship tasks");
    for (const field of ["id", "lane", "status", "priority", "owner", "progress", "estimate", "actual", "startedAt", "updatedAt", "blocker", "goal", "next", "acceptance", "evidence", "write"]) {
      for (const task of tasks) assert.ok(task[field] !== undefined, "board task " + task.id + " is missing " + field);
    }
  }
  pass++;
  const dataKeys = result.data === undefined ? "none" : Object.keys(result.data).join(",");
  console.log("ok   " + rel + "  lines=" + result.lines + "  DATA={" + dataKeys + "}" + (warnings.length === 0 ? "" : "  warnings=" + warnings.map((w) => w.code).join(",")));
}

console.log("\n" + pass + " compiled, " + fail + " broken");
process.exit(fail === 0 ? 0 : 1);
