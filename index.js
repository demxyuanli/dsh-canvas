/**
 * Canvas host half.
 *
 * Compiles agent-authored *.canvas.tsx files, serves them as content-addressed
 * ES modules, persists the human-edit sidecar, bridges canvas actions back to
 * the agent, and exposes canvas_check / canvas_new / canvas_read to the model.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCanvas, moduleUrl, DEFAULT_LIMITS, ROUTE_PREFIX } from "./host/compile.js";
import { ModuleStore } from "./host/store.js";
import { readOverlay, writeOverlay, overlayPathFor, sha1, mergeRows } from "./host/overlay.js";
import { discoverCanvases, readMetadata } from "./host/discovery.js";

export const name = "canvas";

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Defaults; the row's config overrides them. */
function resolveConfig(raw) {
  const c = raw === null || typeof raw !== "object" ? {} : raw;
  return {
    limits: {
      maxSourceBytes: numberOr(c.maxSourceBytes, DEFAULT_LIMITS.maxSourceBytes),
      warnSourceBytes: DEFAULT_LIMITS.warnSourceBytes,
      maxLines: numberOr(c.maxLines, DEFAULT_LIMITS.maxLines),
      warnLines: DEFAULT_LIMITS.warnLines,
      maxDataBytes: numberOr(c.maxDataBytes, DEFAULT_LIMITS.maxDataBytes),
      maxRenderRows: numberOr(c.maxRenderRows, DEFAULT_LIMITS.maxRenderRows),
      compileTimeoutMs: numberOr(c.compileTimeoutMs, DEFAULT_LIMITS.compileTimeoutMs),
    },
    commandWhitelist: Array.isArray(c.commandWhitelist) ? c.commandWhitelist : [],
    startTurnCooldownMs: numberOr(c.startTurnCooldownMs, 30000),
    workspaceRoot: typeof c.workspaceRoot === "string" ? c.workspaceRoot : null,
    maxListDepth: numberOr(c.maxListDepth, 6),
  };
}

function numberOr(value, fallback) {
  return typeof value === "number" && isFinite(value) && value > 0 ? value : fallback;
}

function serviceOf(ctx, name) {
  try { return ctx.get(name); } catch (error) { return undefined; }
}

/**
 * Build the workspace-root resolver.
 *
 * The root of a Session is `session.cwd`, and the composition-wide fallback is
 * `ctx.sandboxPolicy.workspaceRoot` - the same pair the workspace-files service
 * uses. Config wins, then the Session, then the policy, then the process cwd.
 * @returns (sessionId) => root.
 */
function makeRootResolver(ctx, config) {
  const cache = new Map();
  function policyRoot() {
    const policy = serviceOf(ctx, "sandboxPolicy");
    if (policy !== undefined && policy !== null && typeof policy.workspaceRoot === "string") return policy.workspaceRoot;
    return null;
  }
  function sessionRoot(sessionId) {
    if (typeof sessionId !== "string" || sessionId === "") return null;
    if (cache.has(sessionId)) return cache.get(sessionId);
    let found = null;
    for (const name of ["sessions", "sessionManager", "agents", "sessionController"]) {
      const service = serviceOf(ctx, name);
      if (service === undefined || service === null) continue;
      for (const method of ["get", "find", "resolve", "byId"]) {
        if (typeof service[method] !== "function") continue;
        try {
          const session = service[method](sessionId);
          const cwd = session === undefined || session === null ? undefined : (session.cwd ?? (session.header === undefined ? undefined : session.header.cwd));
          if (typeof cwd === "string" && cwd !== "") found = cwd;
        } catch (error) { /* not this accessor */ }
        if (found !== null) break;
      }
      if (found !== null) break;
    }
    cache.set(sessionId, found);
    return found;
  }
  return function rootFor(sessionId) {
    if (config.workspaceRoot !== null) return config.workspaceRoot;
    return sessionRoot(sessionId) ?? policyRoot() ?? process.cwd();
  };
}

/** Per-request root: an explicit override, else the calling Session, else the policy. */
function requestRoot(state, url, body) {
  const explicit = (body !== null && body !== undefined && typeof body.root === "string" && body.root !== "")
    ? body.root
    : (url !== null && url !== undefined ? url.searchParams.get("root") : null);
  if (typeof explicit === "string" && explicit !== "") return explicit;
  const sessionId = (body !== null && body !== undefined && typeof body.sessionId === "string" && body.sessionId !== "")
    ? body.sessionId
    : (url !== null && url !== undefined ? url.searchParams.get("session") : null);
  return state.rootFor(sessionId);
}

/** Absolute path for a canvas reference; relative references resolve against the root. */
function resolvePath(root, reference) {
  if (typeof reference !== "string" || reference === "") return null;
  const cleaned = reference.replace(/\\/g, "/");
  if (path.isAbsolute(cleaned)) return path.normalize(cleaned);
  return path.join(root, cleaned);
}

function addressToPath(address) {
  const m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(String(address === undefined ? "" : address));
  if (m === null) return null;
  try { return decodeURIComponent(m[2]); } catch (error) { return m[2]; }
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body is larger than " + limit + " bytes"));
        try { req.destroy(); } catch (error) { /* already gone */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, contentType, body, cacheControl) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": cacheControl === undefined ? "no-store" : cacheControl,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Build the request handler. One prefix route owns everything under /canvas.
 * @param ctx - host context.
 * @param state - mutable plugin state (root, config, store, cooldown).
 * @returns Node request handler.
 */
function createHandler(ctx, state) {
  async function compileFrom(payload) {
    return compileCanvas({ path: payload.path, source: payload.source, limits: state.config.limits });
  }

  async function handleCompile(req, res) {
    const body = JSON.parse(await readBody(req, state.config.limits.maxDataBytes));
    const result = await compileFrom({ path: body.path, source: body.source });
    if (result.ok) {
      state.store.put(result.sha, result.code);
    }
    sendJson(res, 200, {
      ok: result.ok === true,
      sha: result.sha,
      url: result.ok ? moduleUrl(body.path, result.sha) : undefined,
      diagnostics: result.diagnostics,
    });
  }

  async function handleModule(req, res, pathname) {
    const target = pathname.slice((ROUTE_PREFIX + "/module/").length);
    const sha = target.slice(target.lastIndexOf("/") + 1).replace(/\.js$/, "");
    const hit = state.store.get(sha);
    if (hit === undefined) {
      sendJson(res, 404, { ok: false, message: "unknown or evicted canvas module " + sha });
      return;
    }
    sendText(res, 200, "text/javascript; charset=utf-8", hit, "public, max-age=31536000, immutable");
  }

  async function handleSource(req, res, url) {
    const reference = url.searchParams.get("path") || addressToPath(url.searchParams.get("address"));
    const abs = resolvePath(requestRoot(state, url, null), reference);
    if (abs === null) { sendJson(res, 200, { ok: false, message: "a path or address parameter is required" }); return; }
    try {
      const text = await fs.readFile(abs, "utf8");
      sendJson(res, 200, { ok: true, text: text, path: abs });
    } catch (error) {
      sendJson(res, 200, { ok: false, message: "cannot read " + abs + ": " + String(error && error.message ? error.message : error) });
    }
  }

  async function handleList(req, res, url) {
    try {
      const canvases = await discoverCanvases(requestRoot(state, url, null), { maxDepth: state.config.maxListDepth });
      sendJson(res, 200, { canvases: canvases });
    } catch (error) {
      sendJson(res, 200, { canvases: [], message: String(error && error.message ? error.message : error) });
    }
  }

  async function handleOverlayGet(req, res, url) {
    const abs = resolvePath(requestRoot(state, url, null), url.searchParams.get("canvas"));
    if (abs === null) { sendJson(res, 200, { ok: false, message: "canvas parameter is required" }); return; }
    const doc = await readOverlay(abs);
    sendJson(res, 200, doc);
  }

  async function handleOverlayPost(req, res) {
    const body = JSON.parse(await readBody(req, 64 * 1024));
    const abs = resolvePath(requestRoot(state, null, body), body.canvas);
    if (abs === null) { sendJson(res, 200, { ok: false, message: "canvas is required" }); return; }
    let sourceSha1 = null;
    try { sourceSha1 = sha1(await fs.readFile(abs, "utf8")); } catch (error) { sourceSha1 = null; }
    const doc = await writeOverlay(abs, {
      key: body.key === undefined ? "rows" : body.key,
      id: body.id,
      patch: body.patch,
      clear: body.clear === true,
      sourceSha1: sourceSha1,
    });
    sendJson(res, 200, { ok: true, overlays: doc.overlays, sourceSha1: doc.sourceSha1 });
  }

  async function handleAction(req, res) {
    const body = JSON.parse(await readBody(req, 64 * 1024));
    const action = body.action || {};
    if (action.type === "overlaySet" || action.type === "overlayClear") {
      const abs = resolvePath(requestRoot(state, null, body), body.canvas);
      if (abs === null) { sendJson(res, 200, { ok: false, code: "unsupported", message: "canvas is required" }); return; }
      let sourceSha1 = null;
      try { sourceSha1 = sha1(await fs.readFile(abs, "utf8")); } catch (error) { sourceSha1 = null; }
      const doc = await writeOverlay(abs, {
        key: action.key === undefined ? "rows" : action.key,
        id: action.id,
        patch: action.patch,
        clear: action.type === "overlayClear",
        sourceSha1: sourceSha1,
      });
      sendJson(res, 200, { ok: true, overlays: doc.overlays, sourceSha1: doc.sourceSha1 });
      return;
    }
    if (action.type === "startTurn") {
      sendJson(res, 200, await startTurn(ctx, state, body, action));
      return;
    }
    if (action.type === "notify") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action.type === "runCommand") {
      sendJson(res, 200, {
        ok: false,
        code: "unsupported",
        message: state.config.commandWhitelist.length === 0
          ? "runCommand has no whitelisted commands in this profile"
          : "runCommand is not implemented yet; use the agent's own tools",
      });
      return;
    }
    sendJson(res, 200, { ok: false, code: "unsupported", message: "unsupported action " + String(action.type) });
  }

  return async function handle(req, res) {
    let url;
    try { url = new URL(req.url, "http://canvas.invalid"); }
    catch (error) { sendJson(res, 400, { ok: false, message: "bad url" }); return; }
    const pathname = url.pathname;
    try {
      if (pathname === ROUTE_PREFIX + "/api") {
        sendJson(res, 200, {
          version: "1",
          root: requestRoot(state, url, null),
          limits: state.config.limits,
          actions: ["openFile", "openResource", "copy", "notify", "startTurn", "overlaySet", "overlayClear", "runCommand"],
        });
        return;
      }
      if (pathname === ROUTE_PREFIX + "/list") { await handleList(req, res, url); return; }
      if (pathname === ROUTE_PREFIX + "/source") { await handleSource(req, res, url); return; }
      if (pathname === ROUTE_PREFIX + "/compile" && req.method === "POST") { await handleCompile(req, res); return; }
      if (pathname === ROUTE_PREFIX + "/overlay") {
        if (req.method === "POST") { await handleOverlayPost(req, res); return; }
        await handleOverlayGet(req, res, url);
        return;
      }
      if (pathname === ROUTE_PREFIX + "/action" && req.method === "POST") { await handleAction(req, res); return; }
      if (pathname.startsWith(ROUTE_PREFIX + "/module/")) { await handleModule(req, res, pathname); return; }
      sendJson(res, 404, { ok: false, message: "no such canvas route: " + pathname });
    } catch (error) {
      sendJson(res, 400, { ok: false, message: String(error && error.message ? error.message : error) });
    }
  };
}

/**
 * Hand a canvas request back to the agent as a real user turn.
 * Wrapped because the prompt request shape is the one integration this plugin
 * cannot verify without a live agent; a mismatch degrades into a clean failure.
 */
async function startTurn(ctx, state, body, action) {
  const prompt = String(action.prompt === undefined ? "" : action.prompt).trim();
  if (prompt === "") return { ok: false, code: "unsupported", message: "startTurn needs a prompt" };
  const sessionId = typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : action.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") {
    return { ok: false, code: "unsupported", message: "startTurn needs the session id of the canvas tab" };
  }
  const key = sessionId + "|" + prompt;
  const now = Date.now();
  const last = state.cooldown.get(key);
  if (last !== undefined && now - last < state.config.startTurnCooldownMs) {
    return { ok: false, code: "denied", message: "the same request was just sent from this canvas; wait a moment" };
  }
  let controller;
  try { controller = ctx.get("sessionController"); } catch (error) { controller = undefined; }
  if (controller === undefined || controller === null || typeof controller.prompt !== "function") {
    return { ok: false, code: "unsupported", message: "sessionController.prompt is not available in this composition" };
  }
  state.cooldown.set(key, now);
  const requestId = "canvas-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  try {
    await controller.prompt({ sessionId: sessionId, content: [{ type: "text", text: prompt }], requestId: requestId });
    console.log("[dsh-canvas] startTurn accepted session=" + sessionId + " canvas=" + String(body.canvas) + " requestId=" + requestId);
    return { ok: true, detail: "queued" };
  } catch (error) {
    return { ok: false, code: "failed", message: String(error && error.message ? error.message : error) };
  }
}

// --------------------------------------------------------------------- tools

const DIAGNOSTIC_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string", required: true },
    severity: { type: "string", required: true },
    message: { type: "string", required: true },
    line: { type: "integer" },
    col: { type: "integer" },
    hint: { type: "string" },
  },
};

function diagnosticText(d) {
  const where = d.line === undefined ? "" : " line " + d.line + (d.col === undefined ? "" : ":" + d.col);
  return (d.severity === "error" ? "[error]" : "[warn]") + " " + d.code + where + ": " + d.message + (d.hint === undefined ? "" : " | " + d.hint);
}

const FALLBACK_TEMPLATES = {
  blank: [
    "/** @canvas",
    " * title: New canvas",
    " */",
    'import { H1, Stack, Text } from "dsh/canvas";',
    "",
    "export const DATA = {",
    '  notes: [{ id: "n1", text: "edit DATA, then edit the render" }],',
    "} as const;",
    "",
    "export default function Canvas() {",
    "  return (",
    "    <Stack gap={12}>",
    "      <H1>New canvas</H1>",
    "      {DATA.notes.map((note) => <Text key={note.id}>{note.text}</Text>)}",
    "    </Stack>",
    "  );",
    "}",
    "",
  ].join("\n"),
};

async function templateFor(kind) {
  const name = kind === "gates" ? "gates" : kind === "board" ? "board" : "blank";
  try {
    return await fs.readFile(path.join(PACKAGE_ROOT, "skills", "canvas", "templates", name + ".canvas.tsx"), "utf8");
  } catch (error) {
    return FALLBACK_TEMPLATES.blank;
  }
}

/** The workspace root for one tool call: the calling Session when known, else the policy. */
function toolRoot(state, exec) {
  let sessionId;
  try {
    if (exec && exec.agent) sessionId = exec.agent.session ? exec.agent.session.id : exec.agent.id;
  } catch (error) { sessionId = undefined; }
  return state.rootFor(sessionId);
}

async function registerTools(ctx, state) {
  let tools;
  try { tools = await import("@deepseek-ai/dsh-tools"); }
  catch (error) {
    console.warn("[dsh-canvas] model tools are unavailable: " + String(error && error.message ? error.message : error));
    return;
  }
  const defineTool = tools.defineTool;
  if (typeof defineTool !== "function") return;
  for (const options of toolDefinitions(state)) ctx.tools.register(defineTool(options));
}

/**
 * The three model tools as plain defineTool options.
 * Exported so schema strictness can be checked without a running host.
 * @param state - plugin state carrying config.limits and the root resolver.
 * @returns the option objects.
 */
export function toolDefinitions(state) {
  return [
  {
    name: "canvas_check",
    description: "Compile a *.canvas.tsx file and report diagnostics without rendering it. Use after every edit to a canvas.",
    parameters: {
      path: { type: "string", required: true, description: "Canvas path, absolute or relative to the workspace root." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          summary: { type: "string", required: true },
          diagnostics: { type: "array", required: true, items: DIAGNOSTIC_ITEM_SCHEMA },
        },
      },
      render: function (args, value) {
        const lines = value.diagnostics.map(diagnosticText);
        return [{ type: "text", text: value.summary + " - " + args.path + (lines.length === 0 ? "" : "\n" + lines.join("\n")) }];
      },
    },
    presentCall: function (args) { return { card: "generic", title: "Check canvas", kind: "other", rawInput: args.path }; },
    async execute(args, exec) {
      const abs = resolvePath(toolRoot(state, exec), args.path);
      const source = await fs.readFile(abs, "utf8");
      const result = compileCanvas({ path: abs, source: source, limits: state.config.limits });
      return {
        ok: result.ok === true,
        summary: (result.ok ? "canvas OK" : "canvas has errors") + ": " + result.diagnostics.length + " diagnostic(s)",
        diagnostics: result.diagnostics,
      };
    },
  },

  {
    name: "canvas_new",
    description: "Create a new *.canvas.tsx scaffold in this workspace. Prefer this over hand-writing a canvas from scratch.",
    parameters: {
      path: { type: "string", required: true, description: "Where to write it, absolute or relative to the workspace root." },
      kind: { type: "string", description: "blank | board | gates. Defaults to blank." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          summary: { type: "string", required: true },
          diagnostics: { type: "array", required: true, items: DIAGNOSTIC_ITEM_SCHEMA },
        },
      },
      render: function (args, value) { return [{ type: "text", text: value.summary }]; },
    },
    presentCall: function (args) { return { card: "generic", title: "New canvas", kind: "other", rawInput: args.path }; },
    async execute(args, exec) {
      const abs = resolvePath(toolRoot(state, exec), args.path);
      const body = await templateFor(args.kind);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, body, "utf8");
      const result = compileCanvas({ path: abs, source: body, limits: state.config.limits });
      return {
        path: abs,
        summary: "created " + abs + " (" + (result.ok ? "compiles clean" : "has diagnostics") + ", " + result.diagnostics.length + ")",
        diagnostics: result.diagnostics,
      };
    },
  },

  {
    name: "canvas_read",
    description: "Read a slice of a canvas's inline export const DATA, merged with the human sidecar, instead of reading the whole file. Also reports diagnostics.",
    parameters: {
      path: { type: "string", required: true, description: "Canvas path, absolute or relative to the workspace root." },
      dataPath: { type: "string", description: "Key inside DATA, for example tasks. Omit to read all of DATA." },
      filter: { type: "object", additionalProperties: true, description: "Field equality filter applied to rows, for example { status: \"pending\" }." },
      ids: { type: "array", items: { type: "string" }, description: "Only rows with these ids." },
      limit: { type: "integer", description: "Maximum rows returned." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          summary: { type: "string", required: true },
          path: { type: "string", required: true },
          json: { type: "string", required: true },
          staleOverlay: { type: "boolean", required: true },
          orphanIds: { type: "array", required: true, items: { type: "string" } },
          diagnostics: { type: "array", required: true, items: DIAGNOSTIC_ITEM_SCHEMA },
        },
      },
      render: function (args, value) {
        return [{ type: "text", text: value.summary + "\n" + value.json }];
      },
    },
    presentCall: function (args) { return { card: "generic", title: "Read canvas", kind: "other", rawInput: args.path }; },
    async execute(args, exec) {
      const abs = resolvePath(toolRoot(state, exec), args.path);
      const source = await fs.readFile(abs, "utf8");
      const result = compileCanvas({ path: abs, source: source, limits: state.config.limits });
      const doc = await readOverlay(abs);
      let value = result.ok ? result.data : undefined;
      let stale = false;
      let orphans = [];
      const key = typeof args.dataPath === "string" ? args.dataPath : null;
      if (value !== undefined && key !== null) {
        const bucket = doc.overlays[key];
        const merged = mergeRows(value[key], bucket, sha1(source), doc.sourceSha1);
        value = Object.assign({}, value);
        value[key] = merged.items;
        stale = merged.stale;
        orphans = merged.orphanIds;
      } else if (value !== undefined) {
        for (const k of Object.keys(doc.overlays)) {
          if (Array.isArray(value[k])) {
            const merged = mergeRows(value[k], doc.overlays[k], sha1(source), doc.sourceSha1);
            value = Object.assign({}, value);
            value[k] = merged.items;
            stale = stale || merged.stale;
            orphans = orphans.concat(merged.orphanIds);
          }
        }
        value = Object.assign({}, value, { __overlays: doc.overlays });
      }
      if (value !== undefined && key !== null && Array.isArray(value[key])) {
        let rows = value[key];
        if (args.filter !== undefined && args.filter !== null && typeof args.filter === "object") {
          const entries = Object.entries(args.filter);
          rows = rows.filter(function (row) {
            if (row === null || typeof row !== "object") return false;
            return entries.every(function (pair) { return row[pair[0]] === pair[1]; });
          });
        }
        if (Array.isArray(args.ids)) {
          const wanted = new Set(args.ids);
          rows = rows.filter(function (row) { return row !== null && typeof row === "object" && wanted.has(row.id); });
        }
        const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 200;
        const total = rows.length;
        const shown = rows.slice(0, limit);
        value = Object.assign({}, value);
        value[key] = shown;
        value.__counts = { total: total, shown: shown.length, truncated: total > shown.length };
      }
      if (value !== undefined) {
        const bucket = key === null ? null : doc.overlays[key];
        value.__overlays = key === null ? doc.overlays : (bucket === undefined ? {} : bucket);
      }
      return {
        ok: value !== undefined,
        summary: value === undefined
          ? "canvas_read could not extract export const DATA from " + abs
          : "read " + abs + (key === null ? "" : " key=" + key) + (value.__counts === undefined ? "" : " (" + value.__counts.shown + "/" + value.__counts.total + " rows)"),
        path: abs,
        json: JSON.stringify(value === undefined ? null : value, null, 2),
        staleOverlay: stale,
        orphanIds: Array.from(new Set(orphans)),
        diagnostics: result.diagnostics,
      };
    },
  },
  ];
}

// --------------------------------------------------------------------- entry

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const state = {
    config: config,
    rootFor: makeRootResolver(ctx, config),
    store: new ModuleStore(),
    cooldown: new Map(),
  };
  const handler = createHandler(ctx, state);

  ctx.inject(["webServer"], function (webCtx) {
    webCtx.effect(function () {
      return webCtx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: handler });
    }, "canvas: routes");
  });

  ctx.inject(["tools"], function (toolCtx) {
    registerTools(toolCtx, state).catch(function (error) {
      console.warn("[dsh-canvas] tool registration failed: " + String(error && error.message ? error.message : error));
    });
  });

  console.log("[dsh-canvas] ready; workspace root = " + state.rootFor(undefined));
}
