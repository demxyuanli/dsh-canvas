/**
 * Resume-digest tests.
 *
 * The digest exists so a truncated context (or a fresh agent) can re-hydrate a
 * project from a couple of KB instead of the whole canvas. That claim is only
 * worth anything if (a) the digest is actually small, (b) it is honest about
 * what is missing, and (c) the shipped boards carry anchors that resolve. All
 * three are asserted here.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { briefDigest } from "../host/brief.js";
import { compileCanvas, DEFAULT_LIMITS } from "../host/compile.js";
import { toolDefinitions } from "../index.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { writeOverlay } from "../host/overlay.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (error) { fail++; console.log("FAIL " + name + ": " + (error && error.message ? error.message : error)); }
}

// --- unit: the digest composition -------------------------------------------
const FULL = {
  goal: "ship it", asOf: "2026-09-20", revision: "r3", staleDays: 7,
  constraints: [{ rule: "no fetch", because: "compile fails", violation: "E_EXTERNAL" }],
  decisions: [{ id: "D1", at: "2026-09-01", chose: "a", rejected: ["b"], why: "cheaper", ref: "docs/adr-1.md" }],
  nextAction: { taskId: "t1", action: "freeze the interface", why: "blocks t2" },
  tasks: [
    { id: "t1", title: "first", status: "in_progress", next: "do it", acceptance: "tests pass" },
    { id: "t2", title: "second", status: "pending", dependsOn: ["t1"] },
    { id: "t3", title: "third", status: "completed" },
    { id: "t4", title: "dropped", status: "cancelled" },
  ],
  activity: [
    { id: "a1", at: "2026-09-19", title: "one", tone: "info" },
    { id: "a2", at: "2026-09-18", title: "two", tone: "success" },
    { id: "a3", at: "2026-09-17", title: "three", tone: "neutral" },
    { id: "a4", at: "2026-09-16", title: "four", tone: "neutral" },
  ],
};
const digest = briefDigest(FULL, { now: new Date("2026-09-29T00:00:00Z") });

check("digest carries the four anchors and the snapshot age", () => {
  assert.equal(digest.goal, "ship it");
  assert.equal(digest.revision, "r3");
  assert.equal(digest.asOfAgeDays, 9, "age must be computed from asOf");
  assert.equal(digest.nextAction.action, "freeze the interface");
  assert.equal(digest.constraints.length, 1);
  assert.equal(digest.decisions.length, 1);
});

check("focus keeps only rows someone still has to act on", () => {
  assert.deepEqual(digest.focus.map((row) => row.id), ["t1", "t2"]);
  assert.deepEqual(digest.counts, { tasks: 4, focus: 2, closed: 2 });
});

check("recent activity is capped, not dumped", () => {
  assert.deepEqual(digest.recentActivity.map((row) => row.id), ["a1", "a2", "a3"]);
});

check("a canvas with every anchor and resolvable ids has no notes", () => {
  assert.deepEqual(digest.notes, []);
});

check("a missing nextAction is reported, not silently absent", () => {
  const bare = briefDigest({ goal: "g", tasks: [{ id: "t1", status: "pending" }] });
  assert.ok(bare.notes.some((note) => note.includes("no nextAction")), "expected a nextAction note");
  assert.ok(bare.notes.some((note) => note.includes("no constraints")), "expected a constraints note");
  assert.ok(bare.notes.some((note) => note.includes("no decisions")), "expected a decisions note");
});

check("dangling anchors are reported", () => {
  const broken = briefDigest({
    goal: "g",
    nextAction: { taskId: "t9", action: "do", why: "w" },
    constraints: [], decisions: [],
    tasks: [{ id: "t1", status: "in_progress", dependsOn: ["t8"] }],
  });
  assert.ok(broken.notes.some((note) => note.includes("t9")), "unknown nextAction.taskId must be flagged");
  assert.ok(broken.notes.some((note) => note.includes("t8")), "unknown dependsOn must be flagged");
});

check("an empty nextAction.action is reported", () => {
  const empty = briefDigest({ goal: "g", nextAction: { action: "" }, constraints: [], decisions: [], tasks: [{ id: "t1", status: "pending" }] });
  assert.ok(empty.notes.some((note) => note.includes("nextAction.action is empty")));
});

// --- tool level: brief ignores dataPath and sees human overlay edits --------
const CANVAS = [
  "/** @canvas",
  " * title: Brief fixture",
  " */",
  'import { Stack } from "dsh/canvas";',
  "",
  "export const DATA = {",
  '  goal: "ship the fixture",',
  '  asOf: "2026-09-20",',
  '  revision: "r1",',
  "  constraints: [{ rule: \"r\", because: \"b\", violation: \"v\" }],",
  "  decisions: [{ id: \"D1\", at: \"2026-09-01\", chose: \"a\", rejected: [\"b\"], why: \"w\", ref: \"ref\" }],",
  '  nextAction: { taskId: "t1", action: "freeze", why: "blocks t2" },',
  "  tasks: [",
  '    { id: "t1", title: "first", status: "in_progress", next: "do", acceptance: "ok" },',
  '    { id: "t2", title: "second", status: "pending", dependsOn: ["t1"] },',
  '    { id: "t3", title: "third", status: "completed" },',
  "  ],",
  "  activity: [{ id: \"a1\", at: \"2026-09-19\", title: \"one\", tone: \"info\" }],",
  "} as const;",
  "",
  "export default function Fixture() {",
  "  return <Stack />;",
  "}",
  "",
].join("\n");

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-brief-"));
const canvasPath = path.join(dir, "brief.canvas.tsx");
await fs.writeFile(canvasPath, CANVAS, "utf8");

const state = { config: { limits: DEFAULT_LIMITS }, rootFor: () => dir };
const readOption = toolDefinitions(state).find((option) => option.name === "canvas_read");
assert.ok(readOption !== undefined, "canvas_read must be registered");
const readTool = defineTool(readOption);

try {
  const out = await readTool.execute({ path: canvasPath, brief: true, dataPath: "goal" }, {});
  const parsed = JSON.parse(out.json);
  check("brief returns the digest even when dataPath is also passed", () => {
    assert.match(out.summary, /^brief /, "summary should say brief");
    assert.ok(Array.isArray(parsed.focus), "expected a digest, got a plain slice");
    assert.equal(parsed.nextAction.action, "freeze");
    assert.deepEqual(parsed.focus.map((row) => row.id), ["t1", "t2"]);
    assert.deepEqual(parsed.notes, []);
  });
} catch (error) {
  fail++;
  console.log("FAIL brief through canvas_read: " + (error && error.message ? error.message : error));
}

// The whole point of the digest is that it is cheap: a human edit on the board
// must show up in it without pulling the rest of the canvas into context.
await writeOverlay(canvasPath, { key: "tasks", id: "t3", patch: { status: "in_progress" }, sourceSha1: null });
try {
  const out = await readTool.execute({ path: canvasPath, brief: true }, {});
  const parsed = JSON.parse(out.json);
  check("brief reflects the human sidecar", () => {
    const row = parsed.focus.find((item) => item.id === "t3");
    assert.ok(row !== undefined, "the overlaid row must be in focus");
    assert.equal(row.status, "in_progress");
  });
  check("the digest stays within a couple of KB", () => {
    assert.ok(out.json.length < 4096, "digest grew to " + out.json.length + " bytes");
  });
} catch (error) {
  fail++;
  console.log("FAIL brief with overlay: " + (error && error.message ? error.message : error));
}

// --- the shipped boards must carry anchors that resolve ---------------------
for (const rel of ["skills/canvas/templates/board.canvas.tsx", "board.canvas.tsx"]) {
  const file = path.join(ROOT, rel);
  const source = await fs.readFile(file, "utf8");
  const result = compileCanvas({ path: file, source: source, limits: DEFAULT_LIMITS });
  check(rel + " ships resolvable context anchors", () => {
    assert.equal(result.ok, true, "must compile");
    const data = result.data;
    assert.ok(Array.isArray(data.constraints) && data.constraints.length > 0, "constraints must be non-empty");
    assert.ok(Array.isArray(data.decisions) && data.decisions.length > 0, "decisions must be non-empty");
    assert.ok(data.nextAction !== undefined && typeof data.nextAction.action === "string", "nextAction must be present");
    const ids = new Set(data.tasks.map((task) => task.id));
    assert.ok(ids.has(data.nextAction.taskId), "nextAction.taskId must exist: " + data.nextAction.taskId);
    for (const task of data.tasks) {
      for (const dependency of task.dependsOn ?? []) {
        assert.ok(ids.has(dependency), task.id + " dependsOn unknown task " + dependency);
      }
    }
    const size = JSON.stringify(briefDigest(data)).length;
    assert.ok(size < 6144, rel + " digest is " + size + " bytes; trim it before it stops being cheap");
  });
}

await fs.rm(dir, { recursive: true, force: true });
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
