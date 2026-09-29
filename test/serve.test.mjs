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

import { createUserMessage } from "@deepseek-ai/dsh-llm";

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
// SessionController.prompt(request, signal): `mode` is a required field and the
// signal is dereferenced before admission, so both must be observable here.
const sessionPromptCalls = [];
const services = {
  webServer: { register(route) { services._route = route; return function () {}; } },
  sessionController: {
    prompt(request, signal) { sessionPromptCalls.push({ request, signal }); return Promise.resolve({ accepted: true }); },
  },
};
function makeCtx(scope) {
  // Cordis exposes injected services as properties on the scoped context AND
  // through ctx.get(name); the shim must do both or it is not the same API.
  const scoped = {
    get(k) { return scope[k]; },
    inject(names, cb) { if (names.every((n) => scope[n] !== undefined)) cb(makeCtx(scope)); },
    effect(fn) { return fn(); },
    // The host registers the canvas-intent hook on the agent step waterfall;
    // record it so a composition that silently loses the entry fails the test.
    on(name, listener) { (scope._listeners = scope._listeners || []).push({ name, listener }); return function () {}; },
  };
  return Object.assign(scoped, scope);
}
const ctx = makeCtx(services);
apply(ctx, { workspaceRoot: root });

assert.equal(name, "canvas");
const route = services._route;
assert.equal(route.kind, "prefix");
assert.equal(route.path, "/canvas");
assert.ok((services._listeners || []).some((entry) => entry.name === "agent/pre-step"), "the canvas intent hook must register on agent/pre-step");

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

await t("a POST without application/json is refused (cross-site simple requests)", async () => {
  // A page can send these two content-types cross-site without a preflight; the
  // server answers no preflight either, so requiring JSON is what closes it.
  const plain = await fetch(origin + "/canvas/action", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://evil.example" },
    body: JSON.stringify({ action: { type: "notify", tone: "info", message: "probe" } }),
  });
  assert.equal(plain.status, 403);
  assert.equal((await plain.json()).ok, false);
  const form = await fetch(origin + "/canvas/overlay", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
    body: "canvas=specs/demo.canvas.tsx",
  });
  assert.equal(form.status, 403, "form encoding is the other preflight-free shape");
  const ok = await postJson("/canvas/api", {});
  assert.notEqual(ok.status, 403, "the shipped client sends application/json and must still work");
});

await t("an overlay write outside the workspace root is refused", async () => {
  const r = await postJson("/canvas/overlay", { canvas: "../outside.canvas.tsx", key: "tasks", id: "t1", patch: { status: "completed" } });
  assert.equal(r.body.ok, false, JSON.stringify(r.body));
  assert.equal(r.body.code, "unsupported");
  assert.match(r.body.message, /outside/);
  const written = await fs.stat(path.join(path.dirname(root), "outside.canvas.tsx")).then(() => true, () => false);
  assert.equal(written, false, "nothing may be created outside the root");
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

await t("startTurn passes the required mode and an AbortSignal to prompt", async () => {
  sessionPromptCalls.length = 0;
  const r = await postJson("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "s1", action: { type: "startTurn", prompt: "处理 T-1：第一个" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(sessionPromptCalls.length, 1, "prompt must be called exactly once");
  const call = sessionPromptCalls[0];
  assert.equal(call.request.mode, "queue", "mode is a required field of SessionPromptRequest");
  assert.equal(call.request.sessionId, "s1");
  assert.equal(typeof call.request.requestId, "string");
  assert.equal(call.request.content[0].type, "text");
  assert.equal(call.request.content[0].text, "处理 T-1：第一个");
  assert.ok(call.signal, "an AbortSignal must be passed: prompt() dereferences it immediately");
  assert.equal(typeof call.signal.throwIfAborted, "function");
});

await t("a repeated startTurn inside the cooldown is denied before any prompt", async () => {
  sessionPromptCalls.length = 0;
  const r = await postJson("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "s1", action: { type: "startTurn", prompt: "处理 T-1：第一个" } });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, "denied");
  assert.equal(sessionPromptCalls.length, 0, "a throttled click must not reach the agent");
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

await t("a legacy flat action body still works (stale page, reloaded host)", async () => {
  sessionPromptCalls.length = 0;
  const r = await postJson("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "s1", type: "startTurn", prompt: "处理 T-2：扁平形状" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(sessionPromptCalls.length, 1);
  assert.equal(sessionPromptCalls[0].request.mode, "queue");
});

await t("an action body with no type names the envelope in its message", async () => {
  const r = await postJson("/canvas/action", { canvas: "specs/demo.canvas.tsx" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, "unsupported");
  assert.match(r.body.message, /action/);
  assert.match(r.body.message, /canvas/);
});

// --- runCommand through the real ctx.shell seam ------------------------------
// The main server keeps an empty whitelist (refusal path above); this second
// composition configures one entry and a fake executor, so the assertions are
// about what canvas code may and may not reach.
const shellCalls = [];
const policyCalls = [];
// V-04: the executor must receive the *calling session's* resolved policy, and
// that path only runs when the session is findable - so the composition exposes
// one. An unfindable session must fall back to the deployment policy instead.
const SESSION = { id: "s1", cwd: root };
const services2 = {
  webServer: { register(route) { services2._route = route; return function () {}; } },
  shell: {
    resolve(request) {
      shellCalls.push(request);
      return { command: request.command, workdir: request.workdir, timeoutMs: request.timeoutMs, onExpiry: "kill", stdoutMaxBytes: 65536, sandboxPolicy: request.sandboxPolicy };
    },
    async execute(spec) {
      services2._spec = spec;
      // Mirrors dsh-pwsh-sandbox: the mode the spec carries is reported back in
      // result.sandbox, which is what the panel renders.
      return {
        result: async () => ({ exitCode: 0, signal: null, timedOut: false, timeoutMs: spec.timeoutMs, sandbox: spec.sandboxPolicy === undefined ? undefined : { mode: spec.sandboxPolicy.mode, enforcement: "stub" }, stdout: { text: "gate-ok\n", truncated: false }, stderr: { text: "", truncated: false } }),
      };
    },
  },
  sessions: { get: (id) => (id === SESSION.id ? SESSION : undefined) },
  sandboxPolicy: {
    resolve(arg) {
      policyCalls.push(arg);
      const session = arg === undefined ? undefined : arg.session;
      if (session === undefined) return { mode: "workspace-write", workspaceRoot: root };
      return { mode: session.id === SESSION.id ? "read-only" : "workspace-write", workspaceRoot: root };
    },
  },
};
apply(makeCtx(services2), { workspaceRoot: root, commandWhitelist: [{ id: "gate:demo", title: "demo gate", command: "echo gate-ok", timeoutMs: 5000 }] });
const server2 = http.createServer(services2._route.handler);
await new Promise((resolve) => server2.listen(0, "127.0.0.1", resolve));
const origin2 = "http://127.0.0.1:" + server2.address().port;
async function post2(url, value) {
  const res = await fetch(origin2 + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  return { status: res.status, body: await res.json() };
}

await t("runCommand runs a whitelisted entry under the calling session's policy (V-04)", async () => {
  const r = await post2("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "s1", action: { type: "runCommand", id: "gate:demo" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.exitCode, 0);
  assert.match(r.body.stdout, /gate-ok/);
  assert.equal(shellCalls.length, 1, "expected exactly one shell request");
  assert.equal(shellCalls[0].command, "echo gate-ok", "the command must come from the whitelist");
  assert.equal(policyCalls.length, 1, "expected exactly one policy resolution");
  assert.equal(policyCalls[0].session, SESSION, "the calling session must be resolved, not the deployment fallback");
  assert.equal(shellCalls[0].sandboxPolicy.mode, "read-only", "the session policy must reach the executor");
  assert.equal(r.body.sandbox.mode, "read-only", "V-04: a read-only session must report sandbox.mode read-only");
  assert.equal(r.body.policy.source, "session", "V-05: a resolved session must be named as the policy source");
  assert.equal(r.body.policy.sessionId, "s1");
  assert.doesNotMatch(r.body.detail, /deployment sandbox policy/, "a session run needs no fallback footnote");
});

await t("an unknown session falls back to the deployment policy", async () => {
  shellCalls.length = 0;
  policyCalls.length = 0;
  const r = await post2("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "ghost", action: { type: "runCommand", id: "gate:demo" } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.deepEqual(policyCalls, [undefined], "an unknown session must not be passed to resolve");
  assert.equal(shellCalls[0].sandboxPolicy.mode, "workspace-write");
  assert.equal(r.body.sandbox.mode, "workspace-write");
  // V-05: the fallback stays permissive (the button keeps working) but says so,
  // so the panel cannot read the deployment default as the caller's own policy.
  assert.equal(r.body.policy.source, "deployment");
  assert.equal(r.body.policy.sessionId, "ghost");
  assert.match(r.body.policy.reason, /not known to this host/);
  assert.match(r.body.detail, /deployment sandbox policy/);
});

await t("a request with no sessionId reports the deployment policy too", async () => {
  shellCalls.length = 0;
  policyCalls.length = 0;
  const r = await post2("/canvas/action", { canvas: "specs/demo.canvas.tsx", action: { type: "runCommand", id: "gate:demo" } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.policy.source, "deployment");
  assert.equal(r.body.policy.sessionId, null, "no sessionId must be reported as null, not as a phantom id");
  assert.match(r.body.policy.reason, /carried no sessionId/);
});

await t("runCommand refuses an id that no whitelist entry has", async () => {
  const r = await post2("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "s1", action: { type: "runCommand", id: "gate:nope" } });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, "denied");
});

await t("a request-supplied command string cannot displace the whitelist", async () => {
  shellCalls.length = 0;
  const r = await post2("/canvas/action", { canvas: "specs/demo.canvas.tsx", sessionId: "s1", action: { type: "runCommand", id: "gate:demo", command: "rm -rf /" } });
  assert.equal(r.body.ok, true);
  assert.equal(shellCalls[0].command, "echo gate-ok");
});

// --- the canvas intent entry is live in this composition --------------------
async function dispatchIntent(text) {
  const entry = (services._listeners || []).find((item) => item.name === "agent/pre-step");
  assert.ok(entry, "the canvas intent hook is not registered");
  const batch = [createUserMessage({ content: [{ type: "text", text: text }], source: { kind: "user" } })];
  return entry.listener({ messages: batch }, async () => ({ kind: "enter", messages: batch }));
}

await t("the intent hook injects the intake guidance on a canvas request", async () => {
  const out = await dispatchIntent("给我建个项目看板");
  assert.equal(out.kind, "enter");
  assert.equal(out.messages.length, 2, "expected the user message plus one guidance message");
  const added = out.messages[1];
  assert.equal(added.role, "user");
  assert.equal(added.source.kind, "dsh-canvas");
  assert.ok(added.content[0].text.includes("意图入口"), "guidance text missing");
});

await t("the intent hook stays quiet on an unrelated prompt", async () => {
  const out = await dispatchIntent("帮我修一个空指针，别动别的文件");
  assert.equal(out.messages.length, 1);
});

await new Promise((resolve) => server2.close(resolve));
await new Promise((resolve) => server.close(resolve));
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
