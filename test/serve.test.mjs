/**
 * End-to-end host test: no browser, no React. Boots the plugin's real request
 * handler over node:http, compiles a canvas, serves the module, imports it,
 * calls the component, and checks the action bridge and sidecar on disk.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { apply, name } from "../index.js";

let pass = 0; let fail = 0;
async function t(label, fn) {
  try { await fn(); pass++; console.log("ok   " + label); }
  catch (e) { fail++; console.log("FAIL " + label + "\n     " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n     ") : e)); }
}

const CANVAS = [
  "/** @canvas",
  " * title: Demo board",
  " * description: host test fixture",
  " */",
  'import { H1, Stack, Text, useCanvasState } from "dsh/canvas";',
  "",
  "export const DATA = {",
  '  tasks: [',
  '    { id: "t1", title: "first", status: "pending" },',
  '    { id: "t2", title: "second", status: "completed" },',
  "  ],",
  "} as const;",
  "",
  "export default function Demo() {",
  '  const [filter] = useCanvasState("filter", "open");',
  "  return (",
  "    <Stack gap={8}>",
  "      <H1>Demo board</H1>",
  "      {DATA.tasks.map((task) => (",
  '        <Text key={task.id} tone="secondary">{task.title + " " + filter}</Text>',
  "      ))}",
  "    </Stack>",
  "  );",
  "}",
  "",
].join("\n");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-root-"));
const canvasPath = path.join(root, "specs", "demo.canvas.tsx");
await fs.mkdir(path.dirname(canvasPath), { recursive: true });
await fs.writeFile(canvasPath, CANVAS, "utf8");

// --- a ctx shim that behaves like the parts of the host the plugin uses ------
const services = {
  webServer: { register(route) { services._route = route; return function () {}; } },
};
function makeCtx(scope) {
  // Cordis exposes injected services as properties on the scoped context AND
  // through ctx.get(name); the shim must do both or it is not the same API.
  const scoped = {
    get(k) { return scope[k]; },
    inject(names, cb) { if (names.every((n) => scope[n] !== undefined)) cb(makeCtx(scope)); },
    effect(fn) { return fn(); },
  };
  return Object.assign(scoped, scope);
}
const ctx = makeCtx(services);
apply(ctx, { workspaceRoot: root });

assert.equal(name, "canvas");
const route = services._route;
assert.equal(route.kind, "prefix");
assert.equal(route.path, "/canvas");

const server = http.createServer(route.handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;

async function getJson(url, init) {
  const res = await fetch(origin + url, init);
  return { status: res.status, headers: res.headers, body: await res.json() };
}
async function postJson(url, value) {
  return getJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}

let compiledUrl = null;

await t("GET /canvas/api describes the surface", async () => {
  const r = await getJson("/canvas/api");
  assert.equal(r.status, 200);
  assert.equal(r.body.version, "1");
  assert.ok(r.body.actions.includes("startTurn"));
});

await t("GET /canvas/list discovers the canvas with its metadata", async () => {
  const r = await getJson("/canvas/list");
  assert.equal(r.status, 200);
  assert.equal(r.body.canvases.length, 1);
  assert.equal(r.body.canvases[0].title, "Demo board");
  assert.equal(r.body.canvases[0].description, "host test fixture");
});

await t("POST /canvas/compile returns a content-addressed module URL", async () => {
  const r = await postJson("/canvas/compile", { path: canvasPath, source: CANVAS });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body.diagnostics));
  assert.deepEqual(r.body.diagnostics, []);
  assert.match(r.body.url, /^\/canvas\/module\/[0-9a-f]{12}\/[0-9a-f]{16}\.js$/);
  compiledUrl = r.body.url;
});

await t("compile is cache-honest: the same source yields the same URL", async () => {
  const a = await postJson("/canvas/compile", { path: canvasPath, source: CANVAS });
  const b = await postJson("/canvas/compile", { path: canvasPath, source: CANVAS.replace("Demo board", "Demo board 2") });
  assert.equal(a.body.url, compiledUrl);
  assert.notEqual(b.body.url, compiledUrl);
});

await t("compile failures stay HTTP 200 with diagnostics", async () => {
  const r = await postJson("/canvas/compile", { path: canvasPath, source: 'import fs from "node:fs";\nexport default function X(){ return null; }' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.diagnostics[0].code, "E_PARSE_IMPORT");
});

await t("GET the module with immutable headers", async () => {
  const res = await fetch(origin + compiledUrl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(res.headers.get("cache-control"), /immutable/);
  const body = await res.text();
  assert.match(body, /export default __module\.exports\.default;/);
  assert.match(body, /globalThis\.__DSH_CANVAS__/);
});

await t("unknown module sha is a clean 404", async () => {
  const res = await fetch(origin + "/canvas/module/deadbeefdead/0123456789abcdef.js");
  assert.equal(res.status, 404);
});

await t("the served module imports and its component renders through the injected kit", async () => {
  const res = await fetch(origin + compiledUrl);
  const body = await res.text();
  const modPath = path.join(root, "served-" + Date.now() + ".mjs");
  await fs.writeFile(modPath, body, "utf8");

  const seen = [];
  const callable = new Proxy(function () { return []; }, {
    get(target, prop) {
      if (prop === "then") return undefined;
      if (prop in target) return target[prop];
      return callable;
    },
    apply() { return []; },
  });
  // The kit is a callable proxy, so a component type is the proxy itself:
  // compare identity rather than stringifying it.
  const h = (type, props) => { seen.push(type); return { type, props }; };
  globalThis.__DSH_CANVAS__ = Object.assign(callable, { h, Fragment: callable, React: { createElement: h }, version: "test" });

  const mod = await import("file://" + modPath.replace(/\\/g, "/"));
  assert.equal(typeof mod.default, "function");
  assert.deepEqual(mod.DATA, { tasks: [{ id: "t1", title: "first", status: "pending" }, { id: "t2", title: "second", status: "completed" }] });

  const tree = mod.default();
  assert.ok(seen.length >= 3, "expected the component to call the JSX factory, saw " + seen.length + " calls");
  assert.equal(tree.type, callable, "the outermost element must be the kit Stack the canvas imported");
  delete globalThis.__DSH_CANVAS__;
});

await t("GET /canvas/source reads by path and by resource address", async () => {
  const byPath = await getJson("/canvas/source?path=" + encodeURIComponent("specs/demo.canvas.tsx"));
  assert.equal(byPath.body.ok, true);
  assert.equal(byPath.body.text, CANVAS);
  const address = "dsh-resource://file/session/s-1/" + encodeURIComponent("specs/demo.canvas.tsx");
  const byAddress = await getJson("/canvas/source?address=" + encodeURIComponent(address));
  assert.equal(byAddress.body.ok, true);
  assert.equal(byAddress.body.text, CANVAS);
});

await t("the sidecar round-trips through /canvas/action and lands on disk", async () => {
  const set = await postJson("/canvas/action", {
    canvas: "specs/demo.canvas.tsx",
    action: { type: "overlaySet", key: "tasks", id: "t1", patch: { status: "in_progress", note: "from a human" } },
  });
  assert.equal(set.body.ok, true);
  assert.equal(set.body.overlays.tasks.t1.status, "in_progress");
  assert.equal(set.body.overlays.tasks.t1.by, "user");

  const doc = await fs.readFile(path.join(root, "specs", ".canvas", "demo.state.json"), "utf8");
  assert.match(doc, /in_progress/);

  const read = await getJson("/canvas/overlay?canvas=" + encodeURIComponent("specs/demo.canvas.tsx"));
  assert.equal(read.body.overlays.tasks.t1.status, "in_progress");

  const cleared = await postJson("/canvas/action", {
    canvas: "specs/demo.canvas.tsx",
    action: { type: "overlayClear", key: "tasks", id: "t1" },
  });
  assert.equal(cleared.body.ok, true);
  assert.equal(cleared.body.overlays.tasks, undefined);
});

await t("startTurn without a session is a clean refusal, not a crash", async () => {
  const r = await postJson("/canvas/action", { action: { type: "startTurn", prompt: "do the thing" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, "unsupported");
});

await t("runCommand refuses while the whitelist is empty", async () => {
  const r = await postJson("/canvas/action", { action: { type: "runCommand", command: "rm -rf /" } });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, "unsupported");
});

await t("an unknown route under the prefix is a clean 404", async () => {
  const r = await getJson("/canvas/nope");
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});

await new Promise((resolve) => server.close(resolve));
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
