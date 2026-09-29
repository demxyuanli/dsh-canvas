/** Every tool definition must survive the real defineTool schema compiler, and
 *  canvas_state_merge must actually move a sidecar into the source. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeRootResolver, toolDefinitions } from "../index.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { DEFAULT_LIMITS } from "../host/compile.js";
import { writeOverlay, readOverlay } from "../host/overlay.js";
import { readMetadata } from "../host/discovery.js";

const state = { config: { limits: DEFAULT_LIMITS }, rootFor: () => process.cwd() };
const options = toolDefinitions(state);
assert.equal(options.length, 4, "expected four tools");

let pass = 0; let fail = 0;
const built = new Map();
for (const option of options) {
  try {
    const tool = defineTool(option);
    const params = Object.keys((tool.parameters && tool.parameters.properties) || {}).join(",");
    const outProps = Object.keys((tool.output && tool.output.schema && tool.output.schema.properties) || {}).join(",");
    assert.equal(typeof tool.execute, "function");
    need(option, "description");
    need(option, "parameters");
    assert.equal(typeof option.output.render, "function", option.name + " needs output.render");
    built.set(option.name, tool);
    pass++;
    console.log("ok   " + option.name + "  params={" + params + "}  output={" + outProps + "}");
  } catch (error) {
    fail++;
    console.log("FAIL " + option.name + ": " + (error && error.message ? error.message : error));
  }
}
function need(option, key) {
  assert.ok(option[key] !== undefined, option.name + " is missing " + key);
}

// --- canvas_state_merge: the sidecar must reach the source, minimally -------
const CANVAS = [
  "/** @canvas",
  " * title: Merge fixture",
  " */",
  'import { Stack } from "dsh/canvas";',
  "",
  "export const DATA = {",
  '  goal: "keep me",',
  "  tasks: [",
  "    {",
  '      id: "t1",',
  '      title: "first",',
  '      status: "pending",',
  "    },",
  '    { id: "t2", title: "second", status: "completed" },',
  "  ],",
  "} as const;",
  "",
  "export default function Fixture() {",
  "  return <Stack />;",
  "}",
  "",
].join("\n");

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-merge-"));
// Writes are pinned to an authoritative root, so the shim exposes the real
// resolver: the config root is this temp dir, with the session/policy rungs behind.
state.rootFor = makeRootResolver({ get: () => undefined }, { workspaceRoot: dir }, {});
const canvasPath = path.join(dir, "merge.canvas.tsx");
await fs.writeFile(canvasPath, CANVAS, "utf8");
await writeOverlay(canvasPath, { key: "tasks", id: "t1", patch: { status: "in_progress", owner: "worker-a" }, sourceSha1: null });

const mergeTool = built.get("canvas_state_merge");
if (mergeTool !== undefined) {
  try {
    const out = await mergeTool.execute({ path: canvasPath }, {});
    assert.equal(out.ok, true, out.summary);
    assert.deepEqual(out.applied, [{ key: "tasks", id: "t1", fields: ["status", "owner"] }]);
    assert.deepEqual(out.skipped, []);
    const source = await fs.readFile(canvasPath, "utf8");
    assert.ok(source.includes('status: "in_progress"'), "patched value missing");
    assert.ok(source.includes('owner: "worker-a"'), "added field missing");
    assert.ok(source.includes('{ id: "t2", title: "second", status: "completed" },'), "untouched row moved");
    assert.ok(source.includes("  return <Stack />;"), "render code moved");
    const doc = await readOverlay(canvasPath);
    assert.equal(doc.overlays.tasks, undefined, "the merged entry must leave the sidecar");
    pass++;
    console.log("ok   canvas_state_merge lands the sidecar in DATA and clears it");
  } catch (error) {
    fail++;
    console.log("FAIL canvas_state_merge: " + (error && error.message ? error.message : error));
  }

  // A dry run must report without writing either side.
  await writeOverlay(canvasPath, { key: "tasks", id: "t2", patch: { status: "pending" }, sourceSha1: null });
  try {
    const before = await fs.readFile(canvasPath, "utf8");
    const out = await mergeTool.execute({ path: canvasPath, dryRun: true }, {});
    const after = await fs.readFile(canvasPath, "utf8");
    assert.equal(after, before, "dryRun must not write the source");
    assert.match(out.summary, /would merge/);
    assert.ok((await readOverlay(canvasPath)).overlays.tasks !== undefined, "dryRun must not clear the sidecar");
    pass++;
    console.log("ok   canvas_state_merge dryRun reports without writing");
  } catch (error) {
    fail++;
    console.log("FAIL canvas_state_merge dryRun: " + (error && error.message ? error.message : error));
  }
} else {
  fail++;
  console.log("FAIL canvas_state_merge is not registered");
}

// --- canvas_read: a scalar dataPath must survive the read -------------------
const readTool = built.get("canvas_read");
if (readTool !== undefined) {
  try {
    const read = await readTool.execute({ path: canvasPath, dataPath: "goal" }, {});
    const parsed = JSON.parse(read.json);
    assert.equal(parsed.goal, "keep me", "a scalar dataPath was replaced instead of returned");
    pass++;
    console.log("ok   canvas_read returns a scalar dataPath unchanged");
  } catch (error) {
    fail++;
    console.log("FAIL canvas_read scalar dataPath: " + (error && error.message ? error.message : error));
  }
} else {
  fail++;
  console.log("FAIL canvas_read is not registered");
}

// --- writes are pinned to the workspace root ---------------------------------
// Reads may look anywhere; writes must land inside a root somebody actually
// knows, and the process cwd is not such a root.
const newTool = built.get("canvas_new");
if (newTool !== undefined) {
  try {
    const out = await newTool.execute({ path: "../escape.canvas.tsx", kind: "blank" }, {});
    assert.match(out.summary, /^refused:/, out.summary);
    const escaped = await fs.stat(path.join(path.dirname(dir), "escape.canvas.tsx")).then(() => true, () => false);
    assert.equal(escaped, false, "a write outside the root must leave nothing behind");
    const merge = built.get("canvas_state_merge");
    const mergeEscape = await merge.execute({ path: "../escape.canvas.tsx" }, {});
    assert.match(mergeEscape.summary, /^refused:/, mergeEscape.summary);
    const inside = await newTool.execute({ path: "inside.canvas.tsx", kind: "blank" }, {});
    assert.equal(inside.path, path.join(dir, "inside.canvas.tsx"));
    assert.ok(inside.summary.startsWith("created "), inside.summary);
    const createdSource = await fs.readFile(path.join(dir, "inside.canvas.tsx"), "utf8");
    assert.equal(readMetadata(createdSource).meta.hidden, undefined, "a new canvas must not inherit the template's hidden marker");
    pass++;
    console.log("ok   canvas_new and canvas_state_merge stay inside the root");
  } catch (error) {
    fail++;
    console.log("FAIL write containment: " + (error && error.message ? error.message : error));
  }

  try {
    // No config root, no session, nothing remembered: the cwd rung is refused.
    const bare = { config: { limits: DEFAULT_LIMITS }, rootFor: makeRootResolver({ get: () => undefined }, { workspaceRoot: null }, {}) };
    const bareTool = defineTool(toolDefinitions(bare).find((candidate) => candidate.name === "canvas_new"));
    const out = await bareTool.execute({ path: "x.canvas.tsx", kind: "blank" }, {});
    assert.match(out.summary, /cannot resolve the workspace root/, out.summary);
    pass++;
    console.log("ok   a write refuses the process-cwd rung");
  } catch (error) {
    fail++;
    console.log("FAIL cwd rung: " + (error && error.message ? error.message : error));
  }
} else {
  fail++;
  console.log("FAIL canvas_new is not registered");
}

// --- tool root: a canvas tool must never resolve into the app's cwd ----------
// The Desktop app launches with its profile directory as cwd. A tool call whose
// exec context carries no session used to resolve relative canvas paths there,
// so canvas_new wrote outside the workspace and canvas_check then could not find
// the file it had just been told about.
const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-session-"));
const sessionCanvas = path.join(sessionDir, "rel.canvas.tsx");
await fs.writeFile(sessionCanvas, CANVAS, "utf8");

if (readTool !== undefined) {
  try {
    const out = await readTool.execute({ path: "rel.canvas.tsx" }, { agent: { session: { id: "s-1", cwd: sessionDir } } });
    assert.equal(out.ok, true, "the exec context's session cwd must win: " + out.summary);
    assert.equal(out.path, sessionCanvas, "resolved against the exec cwd, not the process cwd");
    pass++;
    console.log("ok   a canvas tool resolves relative paths against the exec session cwd");
  } catch (error) {
    fail++;
    console.log("FAIL canvas tool exec cwd: " + (error && error.message ? error.message : error));
  }

  try {
    // No exec context at all: the plugin's own resolver decides.
    const configured = { config: { limits: DEFAULT_LIMITS }, rootFor: () => sessionDir };
    const option = toolDefinitions(configured).find((candidate) => candidate.name === "canvas_read");
    const tool = defineTool(option);
    const out = await tool.execute({ path: "rel.canvas.tsx" }, {});
    assert.equal(out.ok, true, "the plugin root resolver must be consulted: " + out.summary);
    assert.equal(out.path, sessionCanvas);
    pass++;
    console.log("ok   without an exec session the tool falls back to the plugin root resolver");
  } catch (error) {
    fail++;
    console.log("FAIL canvas tool without exec: " + (error && error.message ? error.message : error));
  }
}

// Resolver precedence, including the sticky last-known session root.
{
  const memory = {};
  const withSession = { get: (name) => (name === "sessions" ? { get: (id) => (id === "s-1" ? { cwd: "/tmp/ws" } : undefined) } : undefined) };
  const rootFor = makeRootResolver(withSession, { workspaceRoot: null }, memory);
  assert.equal(rootFor("s-1"), "/tmp/ws", "a resolvable session wins");
  assert.equal(rootFor(undefined), "/tmp/ws", "the last session root must outrank process.cwd()");
  assert.equal(memory.lastSessionRoot, "/tmp/ws");
  const policyOnly = makeRootResolver({ get: (name) => (name === "sandboxPolicy" ? { workspaceRoot: "/tmp/policy" } : undefined) }, { workspaceRoot: null }, {});
  assert.equal(policyOnly(undefined), "/tmp/policy", "policy answers when no workspace has ever been seen");
  const both = { get: (name) => (name === "sandboxPolicy" ? { workspaceRoot: "/tmp/policy" } : undefined) };
  assert.equal(makeRootResolver(both, { workspaceRoot: null }, { lastSessionRoot: "/tmp/ws" })(undefined), "/tmp/ws",
    "a workspace we have seen outranks the policy root: in Desktop the policy root is the app data directory");
  const configured = makeRootResolver({ get: () => undefined }, { workspaceRoot: "/tmp/config" }, {});
  assert.equal(configured(undefined), "/tmp/config", "config outranks everything");
  pass++;
  console.log("ok   root precedence: config > session > memory > policy > cwd");
}

// The exec and session shapes the harness really produces. Reading only the flat
// `cwd` made both rungs return nothing, so a relative write fell through to the
// policy root - the Desktop app data directory - which is the canvas_new bug again.
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-canvas-root-"));
  const emptyCtx = { get: () => undefined };
  const policyCtx = { get: (name) => (name === "sandboxPolicy" ? { workspaceRoot: path.join(dir, "policy") } : undefined) };
  const recordCtx = { get: (name) => (name === "sessions" ? { get: (id) => (id === "s-1" ? { agent: { session: { header: { cwd: path.join(dir, "by-record") } } } } : undefined) } : undefined) };
  const flatCtx = { get: (name) => (name === "sessions" ? { get: (id) => (id === "s-2" ? { cwd: path.join(dir, "flat") } : undefined) } : undefined) };
  const call = async (rootFor, exec, reference) => {
    state.rootFor = rootFor;
    return built.get("canvas_new").execute({ path: reference, kind: "blank" }, exec);
  };

  const viaExec = await call(makeRootResolver(emptyCtx, { workspaceRoot: null }, {}), { agent: { session: { header: { cwd: dir } } } }, "via-exec.canvas.tsx");
  assert.equal(viaExec.path, path.join(dir, "via-exec.canvas.tsx"), "the exec cwd lives at agent.session.header.cwd");

  const viaRecord = await call(makeRootResolver(recordCtx, { workspaceRoot: null }, {}), { agent: { session: { id: "s-1" } } }, "via-record.canvas.tsx");
  assert.equal(viaRecord.path, path.join(dir, "by-record", "via-record.canvas.tsx"), "ctx.sessions.get(id) nests the cwd under agent.session.header too");

  const viaFlat = await call(makeRootResolver(flatCtx, { workspaceRoot: null }, {}), { agent: { session: { id: "s-2" } } }, "via-flat.canvas.tsx");
  assert.equal(viaFlat.path, path.join(dir, "flat", "via-flat.canvas.tsx"), "a flat session.cwd still resolves");

  const refusedPolicy = await call(makeRootResolver(policyCtx, { workspaceRoot: null }, {}), {}, "refused-policy.canvas.tsx");
  assert.ok(refusedPolicy.summary.startsWith("refused:"), "the policy root is not a workspace: " + refusedPolicy.summary);
  assert.equal(await fs.stat(path.join(dir, "policy", "refused-policy.canvas.tsx")).catch(() => false), false, "nothing may be written under the policy root");

  const refusedCwd = await call(makeRootResolver(emptyCtx, { workspaceRoot: null }, {}), { cwd: process.cwd() }, "refused-cwd.canvas.tsx");
  assert.ok(refusedCwd.summary.startsWith("refused:"), "an exec cwd that is just process.cwd() is refused: " + refusedCwd.summary);

  await fs.rm(dir, { recursive: true, force: true });
  pass++;
  console.log("ok   exec/session cwd shapes, and the refusals that keep the policy root out of writes");
}

await fs.rm(sessionDir, { recursive: true, force: true });
await fs.rm(dir, { recursive: true, force: true });
console.log("\n" + pass + " compiled, " + fail + " rejected");
process.exit(fail === 0 ? 0 : 1);
