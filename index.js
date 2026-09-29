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
import { readOverlay, writeOverlay, overlayPathFor, sha1, mergeRows, removeOverlayEntries } from "./host/overlay.js";
import { discoverCanvases, readMetadata } from "./host/discovery.js";
import { mergeOverlaysIntoSource } from "./host/merge.js";
import { briefDigest } from "./host/brief.js";
import { createCanvasIntentListener } from "./host/intent.js";
import { mk } from "./host/diagnostics.js";

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
    intentHook: c.intentHook === undefined ? true : c.intentHook === true,
    intentKeywords: Array.isArray(c.intentKeywords) ? c.intentKeywords.filter((keyword) => typeof keyword === "string" && keyword !== "") : [],
    intentGuide: typeof c.intentGuide === "string" && c.intentGuide !== "" ? c.intentGuide : null,
  };
}

function numberOr(value, fallback) {
  return typeof value === "number" && isFinite(value) && value > 0 ? value : fallback;
}

/** First argument that is a non-empty string; undefined when none is. */
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
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
/**
 * The working directory inside a Session-ish value, however it is nested.
 *
 * The harness reads it as \`agent.session.header.cwd\` (see dsh-tools' own tool
 * implementations), the record \`ctx.sessions.get(id)\` hands back nests it the same
 * way (see dsh-acp: \`record.agent.session\`), and some call sites carry it flat.
 * Reading only the flat shape made BOTH the session rung and the exec rung return
 * nothing, so every relative write fell through to the policy root - the app data
 * directory - which is exactly where an accidental canvas_new landed.
 * @param value - an exec context, a session record, an agent, or a session.
 * @returns the cwd, or undefined when this value carries none.
 */
function cwdFrom(value) {
  if (value === undefined || value === null) return undefined;
  const agent = value.agent;
  const session = value.session;
  const header = value.header;
  const sessionHeader = session !== undefined && session !== null ? session.header : undefined;
  const agentSession = agent !== undefined && agent !== null ? agent.session : undefined;
  const agentSessionHeader = agentSession !== undefined && agentSession !== null ? agentSession.header : undefined;
  return firstString(
    sessionHeader !== undefined && sessionHeader !== null ? sessionHeader.cwd : undefined,
    agentSessionHeader !== undefined && agentSessionHeader !== null ? agentSessionHeader.cwd : undefined,
    agentSession !== undefined && agentSession !== null ? agentSession.cwd : undefined,
    header !== undefined && header !== null ? header.cwd : undefined,
    value.cwd,
  );
}

export function makeRootResolver(ctx, config, memory) {
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
      for (const method of ["get", "find", "resolve", "resolveAgent", "byId"]) {
        if (typeof service[method] !== "function") continue;
        try {
          const session = service[method](sessionId);
          const cwd = cwdFrom(session);
          if (typeof cwd === "string" && cwd !== "") found = cwd;
        } catch (error) { /* not this accessor */ }
        if (found !== null) break;
      }
      if (found !== null) break;
    }
    cache.set(sessionId, found);
    // Remember the last session root this plugin ever saw. The Desktop app runs
    // with its profile directory as cwd, so a tool call whose exec context
    // carries no session would otherwise resolve canvas paths there.
    if (memory !== undefined && memory !== null && found !== null) memory.lastSessionRoot = found;
    return found;
  }
  /**
   * The same ladder as `rootFor`, plus which rung answered. Writes need the rung:
   * "cwd" means nobody knows a workspace, and trusting it is how a file once
   * landed in the Desktop app's profile directory.
   * @returns { root, source }, in precedence order: config | session | memory | policy | cwd.
   */
  function describe(sessionId) {
    if (config.workspaceRoot !== null) return { root: config.workspaceRoot, source: "config" };
    const fromSession = sessionRoot(sessionId);
    if (fromSession !== null) return { root: fromSession, source: "session" };
    // The remembered Session root outranks the policy root on purpose. In the
    // Desktop app ctx.sandboxPolicy.workspaceRoot is the *application data*
    // directory (verified: profiles/desktop), so trusting it over a workspace we
    // have actually seen would point session-less writes at the app's own folder.
    if (memory !== undefined && memory !== null && typeof memory.lastSessionRoot === "string") return { root: memory.lastSessionRoot, source: "memory" };
    const fromPolicy = policyRoot();
    if (fromPolicy !== null) return { root: fromPolicy, source: "policy" };
    return { root: process.cwd(), source: "cwd" };
  }
  function rootFor(sessionId) { return describe(sessionId).root; }
  rootFor.describe = describe;
  return rootFor;
}

/** The session a request names: body first, then query. Undefined when it names none. */
function requestSessionId(url, body) {
  if (body !== null && body !== undefined && typeof body.sessionId === "string" && body.sessionId !== "") return body.sessionId;
  if (url !== null && url !== undefined) {
    const fromQuery = url.searchParams.get("session");
    if (typeof fromQuery === "string" && fromQuery !== "") return fromQuery;
  }
  return undefined;
}

/** Per-request root: an explicit override, else the calling Session, else the policy. */
function requestRoot(state, url, body) {
  const explicit = (body !== null && body !== undefined && typeof body.root === "string" && body.root !== "")
    ? body.root
    : (url !== null && url !== undefined ? url.searchParams.get("root") : null);
  if (typeof explicit === "string" && explicit !== "") return explicit;
  return state.rootFor(requestSessionId(url, body));
}

/** Same directory, case-insensitively on Windows. */
function sameDir(a, b) {
  const fold = process.platform === "win32" ? (value) => value.toLowerCase() : (value) => value;
  return fold(path.resolve(a)) === fold(path.resolve(b));
}

/** Root itself, or something under it, at a path-segment boundary. */
function isInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const fold = process.platform === "win32" ? (value) => value.toLowerCase() : (value) => value;
  const a = fold(base);
  const b = fold(target);
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

/**
 * Resolve a path a WRITE is about to touch.
 *
 * Reads may look anywhere; writes are pinned to a workspace root somebody
 * actually knows. The "cwd" rung is refused on purpose - in the Desktop app it is
 * the profile directory, which is where an accidental canvas_new once landed.
 * Symlinks inside the root are not resolved, so a link pointing outside is a
 * known, documented limit of this check rather than a silent allowance.
 * @param state - plugin state (needs rootFor.describe).
 * @param sessionId - the calling session, when the call has one.
 * @param reference - the canvas reference from the caller.
 * @param explicitRoot - a cwd the exec context supplied directly, authoritative.
 * @returns { path, root } or { error }.
 */
function resolveWritePath(state, sessionId, reference, explicitRoot) {
  if (typeof reference !== "string" || reference === "") return { error: "a canvas path is required" };
  const detail = typeof explicitRoot === "string" && explicitRoot !== ""
    ? { root: explicitRoot, source: "exec" }
    : state.rootFor.describe(sessionId);
  if (detail === undefined || detail === null || detail.source === "cwd") {
    return { error: "cannot resolve the workspace root for this write (no session and no known workspace); pass sessionId or set workspaceRoot" };
  }
  // The sandbox policy root says where the sandbox DEFAULTS, not where the user's
  // project is: in the Desktop app it is the application data directory, and two
  // separate bugs have now written canvases into it. A write needs a root somebody
  // actually knows (config / session / remembered workspace / a real exec cwd).
  if (detail.source === "policy") {
    return { error: "cannot resolve the workspace root for this write: the only root on offer is the sandbox policy root (" + detail.root + "), which in the Desktop app is the application data directory; pass sessionId or set workspaceRoot" };
  }
  if (detail.source === "exec" && sameDir(detail.root, process.cwd())) {
    return { error: "cannot resolve the workspace root for this write: the exec context only offered the process working directory (" + detail.root + ")" };
  }
  const abs = resolvePath(detail.root, reference);
  if (abs === null) return { error: "a canvas path is required" };
  if (!isInside(detail.root, abs)) {
    return { error: "writes are limited to the workspace root: " + abs + " is outside " + detail.root };
  }
  return { path: abs, root: detail.root };
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
      const canvases = await discoverCanvases(requestRoot(state, url, null), {
        maxDepth: state.config.maxListDepth,
        includeHidden: url.searchParams.get("includeHidden") === "1",
      });
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
    const target = resolveWritePath(state, requestSessionId(null, body), body.canvas);
    if (target.error !== undefined) { sendJson(res, 200, { ok: false, code: "unsupported", message: target.error }); return; }
    const abs = target.path;
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
    // The frozen shape is { canvas, sessionId?, root?, action }. A client that
    // spread the action flat into the body used to read here as "unsupported
    // action undefined"; accept that shape too, so a page already loaded with
    // the old bundle keeps working across a host-only reload.
    const action = body !== null && typeof body === "object" && body.action !== null && typeof body.action === "object" ? body.action : body;
    if (action === null || typeof action !== "object" || typeof action.type !== "string" || action.type === "") {
      sendJson(res, 200, {
        ok: false,
        code: "unsupported",
        message: "an action body must be { action: { type } }; received keys: " + Object.keys(body === null || typeof body !== "object" ? {} : body).join(", "),
      });
      return;
    }
    if (action.type === "overlaySet" || action.type === "overlayClear") {
      const target = resolveWritePath(state, requestSessionId(null, body), body.canvas);
      if (target.error !== undefined) { sendJson(res, 200, { ok: false, code: "unsupported", message: target.error }); return; }
      const abs = target.path;
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
      sendJson(res, 200, await runCommand(ctx, state, body, action));
      return;
    }
    sendJson(res, 200, { ok: false, code: "unsupported", message: "unsupported action " + String(action.type) });
  }

  return async function handle(req, res) {
    let url;
    try { url = new URL(req.url, "http://canvas.invalid"); }
    catch (error) { sendJson(res, 400, { ok: false, message: "bad url" }); return; }
    const pathname = url.pathname;
    // POSTs carry prompts, commands and file writes, so they are gated harder
    // than the reads. A browser cannot set application/json cross-site without a
    // preflight, and this server answers no preflight - so requiring JSON closes
    // that path. Local callers set it trivially, and the shipped client already
    // does (lib/client.js postAction).
    if (req.method === "POST" && !/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) {
      sendJson(res, 403, { ok: false, code: "unsupported", message: "POST " + pathname + " requires content-type: application/json" });
      return;
    }
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
 *
 * The request shape is the contract of `SessionController.prompt`: `mode` is a
 * required field, and the method dereferences its AbortSignal before doing
 * anything (`signal.throwIfAborted()`), so the signal is not optional in
 * practice even where the client wrapper marks it so. Both omissions once made
 * every "Start in chat" click land in the catch below as
 * `{ ok:false, code:"failed" }` - a thrown TypeError, not a refusal.
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
  // A fresh controller: this signal bounds prompt admission only, and the turn
  // itself has to outlive the HTTP response.
  const abort = new AbortController();
  try {
    await controller.prompt({
      requestId: requestId,
      sessionId: sessionId,
      mode: "queue",
      content: [{ type: "text", text: prompt }],
    }, abort.signal);
    console.log("[dsh-canvas] startTurn accepted session=" + sessionId + " canvas=" + String(body.canvas) + " requestId=" + requestId);
    return { ok: true, detail: "queued" };
  } catch (error) {
    // A failed hand-off must not consume the dedupe window: the cooldown is
    // set before the call so a double click cannot queue twice, and released
    // here so a genuine failure stays retryable.
    state.cooldown.delete(key);
    return { ok: false, code: "failed", message: String(error && error.message ? error.message : error) };
  }
}

/** Resolve a Session object for policy lookups; undefined when no accessor knows it. */
function sessionById(ctx, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  for (const name of ["sessions", "sessionManager", "agents", "sessionController"]) {
    const service = serviceOf(ctx, name);
    if (service === undefined || service === null) continue;
    for (const method of ["get", "find", "resolve", "byId"]) {
      if (typeof service[method] !== "function") continue;
      try {
        const session = service[method](sessionId);
        if (session !== undefined && session !== null) return session;
      } catch (error) { /* not this accessor */ }
    }
  }
  return undefined;
}

/** Bounded output tail: an action response crosses to the browser. */
function tail(text, limit) {
  const value = String(text === undefined || text === null ? "" : text);
  return value.length <= limit ? value : value.slice(value.length - limit);
}

/**
 * Run one whitelisted command through ctx.shell.
 *
 * Security shape: a request may only SELECT a config entry - the command string
 * always comes from commandWhitelist, never from the canvas. Confinement comes
 * from ctx.sandboxPolicy for the calling Session, so a read-only session runs a
 * gate read-only rather than skipping the check.
 * @returns the action result the browser renders: exit code plus a bounded tail.
 */
async function runCommand(ctx, state, body, action) {
  const whitelist = state.config.commandWhitelist;
  if (whitelist.length === 0) {
    return { ok: false, code: "unsupported", message: "runCommand has no whitelisted commands in this profile" };
  }
  const wantedId = typeof action.id === "string" && action.id !== "" ? action.id : null;
  const wantedCommand = typeof action.command === "string" && action.command !== "" ? action.command : null;
  const entry = whitelist.find((item) => item !== null && typeof item === "object" &&
    ((wantedId !== null && item.id === wantedId) || (wantedCommand !== null && item.command === wantedCommand)));
  if (entry === undefined) {
    return {
      ok: false,
      code: "denied",
      message: wantedId !== null
        ? "no commandWhitelist entry has id " + JSON.stringify(wantedId)
        : "that exact command is not in commandWhitelist",
    };
  }
  if (typeof entry.command !== "string" || entry.command.trim() === "") {
    return { ok: false, code: "denied", message: "the matched whitelist entry has no command string" };
  }
  const shell = serviceOf(ctx, "shell");
  if (shell === undefined || shell === null || typeof shell.resolve !== "function" || typeof shell.execute !== "function") {
    return { ok: false, code: "unsupported", message: "ctx.shell is not available in this composition" };
  }
  const sessionId = typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : (typeof action.sessionId === "string" ? action.sessionId : "");
  // Where the confinement comes from is part of the result, not a footnote. A
  // request with no resolvable session runs under the *deployment* default, and
  // a panel that only sees sandbox.mode would read that as the caller's own
  // policy - so the provenance travels back with the run.
  let sandboxPolicy;
  let policySource = "deployment";
  let policyReason = sessionId === ""
    ? "the request carried no sessionId"
    : "session " + sessionId + " is not known to this host";
  try {
    const policyService = serviceOf(ctx, "sandboxPolicy");
    if (policyService !== undefined && policyService !== null && typeof policyService.resolve === "function") {
      const session = sessionById(ctx, sessionId);
      if (session === undefined) {
        sandboxPolicy = policyService.resolve();
      } else {
        sandboxPolicy = policyService.resolve({ session: session });
        policySource = "session";
        policyReason = "resolved from the calling session";
      }
    } else {
      policyReason = "this composition has no sandboxPolicy service";
    }
  } catch (error) {
    sandboxPolicy = undefined;
    policyReason = "sandbox policy resolution failed: " + String(error && error.message ? error.message : error);
  }
  const policy = { source: policySource, sessionId: sessionId === "" ? null : sessionId, reason: policyReason };
  const workdir = typeof entry.cwd === "string" && entry.cwd !== "" ? entry.cwd : requestRoot(state, null, body);
  const timeoutMs = numberOr(entry.timeoutMs, 120000);
  try {
    const spec = shell.resolve({ command: entry.command, workdir: workdir, timeoutMs: timeoutMs, sandboxPolicy: sandboxPolicy });
    const execution = await shell.execute(spec);
    const result = await execution.result();
    const label = typeof entry.title === "string" && entry.title !== "" ? entry.title : (entry.id === undefined ? entry.command : entry.id);
    return {
      ok: true,
      code: "ran",
      exitCode: result.exitCode,
      signal: result.signal === undefined ? null : result.signal,
      timedOut: result.timedOut === true,
      sandbox: result.sandbox,
      policy: policy,
      detail: label + " exit=" + String(result.exitCode) + (result.timedOut === true ? " (timed out)" : "") + (policySource === "session" ? "" : " (deployment sandbox policy: " + policyReason + ")"),
      stdout: tail(result.stdout === undefined ? "" : result.stdout.text, 8000),
      stderr: tail(result.stderr === undefined ? "" : result.stderr.text, 4000),
    };
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

/**
 * Drop a `hidden: ...` line from a canvas metadata header.
 *
 * Only header lines match (the leading `*`), so a `hidden:` key inside DATA is
 * untouched. Used by canvas_new: a new canvas is live by definition, so a marker
 * inherited from a template must not make it invisible to the picker.
 * @param source - canvas source, usually a template body.
 * @returns the source without that line.
 */
function stripHiddenMarker(source) {
  return String(source).replace(/^([ \t]*\*[ \t]*)hidden[ \t]*:[^\n]*\n/m, "");
}

function cwdOf(exec) {
  const context = exec === null || exec === undefined ? {} : exec;
  try {
    // exec.agent.session.header.cwd is the field the harness itself reads.
    return cwdFrom(context);
  } catch (error) { return undefined; }
}

function sessionIdOf(exec) {
  const context = exec === null || exec === undefined ? {} : exec;
  try {
    const agent = context.agent;
    const session = context.session;
    return firstString(
      agent && agent.session ? agent.session.id : undefined,
      session ? session.id : undefined,
      agent ? agent.id : undefined,
      context.sessionId,
    );
  } catch (error) { return undefined; }
}

/**
 * The workspace root for one tool call.
 *
 * Precedence: a cwd carried directly by the exec context, then the calling
 * Session resolved through the host services, then this plugin's config/policy,
 * then the last Session root it has seen. @link{process.cwd} is the final resort
 * only: in the Desktop app that is the profile directory, and resolving canvas
 * paths there silently creates files outside the workspace.
 */
function toolRoot(state, exec) {
  const cwd = cwdOf(exec);
  if (cwd !== undefined) return cwd;
  return state.rootFor(sessionIdOf(exec));
}

/** The path a write tool may use: exec cwd when given, else the authoritative ladder. */
function toolWritePath(state, exec, reference) {
  return resolveWritePath(state, sessionIdOf(exec), reference, cwdOf(exec));
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
      const target = toolWritePath(state, exec, args.path);
      if (target.error !== undefined) {
        return { path: typeof args.path === "string" ? args.path : "", summary: "refused: " + target.error, diagnostics: [] };
      }
      const abs = target.path;
      // A new canvas is live by definition, so a `hidden: true` inherited from the
      // template header must not survive the copy - otherwise every board created
      // from a hidden template would be born invisible to the picker.
      const body = stripHiddenMarker(await templateFor(args.kind));
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
    description: "Read a slice of a canvas's inline export const DATA, merged with the human sidecar, instead of reading the whole file. Also reports diagnostics.\n\nPass brief: true to get the cold-start digest instead of a slice -- use it when resuming after a context truncation, or when a fresh agent picks the project up.",
    parameters: {
      path: { type: "string", required: true, description: "Canvas path, absolute or relative to the workspace root." },
      brief: { type: "boolean", description: "Return only the resume digest: goal, asOf/revision, nextAction, constraints, decisions, the rows still in flight and the last few activity entries. Ignores dataPath/filter/ids." },
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
      // brief is a view over the whole merged DATA, so it deliberately ignores
      // dataPath: the point is one call that re-hydrates the project.
      const key = args.brief === true ? null : (typeof args.dataPath === "string" ? args.dataPath : null);
      // Merge only array buckets. A scalar dataPath (e.g. "goal") must survive
      // the read unchanged: mergeRows would otherwise replace it with [].
      if (value !== undefined && key !== null && Array.isArray(value[key])) {
        const bucket = doc.overlays[key];
        const merged = mergeRows(value[key], bucket, sha1(source), doc.sourceSha1);
        value = Object.assign({}, value);
        value[key] = merged.items;
        stale = merged.stale;
        orphans = merged.orphanIds;
      } else if (value !== undefined && key === null) {
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
      if (args.brief === true && value !== undefined) {
        const digest = briefDigest(value);
        return {
          ok: true,
          summary: "brief " + abs + ": " + digest.focus.length + " in flight, " + digest.constraints.length + " constraints, "
            + digest.decisions.length + " decisions, next=" + (digest.nextAction === null || digest.nextAction === undefined || !digest.nextAction.action ? "(unset)" : digest.nextAction.action)
            + (digest.notes.length === 0 ? "" : " - " + digest.notes.length + " note(s)"),
          path: abs,
          json: JSON.stringify(digest, null, 2),
          staleOverlay: stale,
          orphanIds: Array.from(new Set(orphans)),
          diagnostics: result.diagnostics,
        };
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

  {
    name: "canvas_state_merge",
    description: "Write the human sidecar edits back into a canvas's inline DATA with minimal field replacement, then clear the merged entries. Use it when the human's decisions on a board should become source truth.",
    parameters: {
      path: { type: "string", required: true, description: "Canvas path, absolute or relative to the workspace root." },
      key: { type: "string", description: "Only merge this DATA array key, for example tasks." },
      ids: { type: "array", items: { type: "string" }, description: "Only merge these row ids." },
      dryRun: { type: "boolean", description: "Report what would change without writing the file or the sidecar." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          summary: { type: "string", required: true },
          path: { type: "string", required: true },
          applied: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string", required: true },
                id: { type: "string", required: true },
                fields: { type: "array", required: true, items: { type: "string" } },
              },
            },
          },
          skipped: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string", required: true },
                id: { type: "string" },
                reason: { type: "string", required: true },
              },
            },
          },
          diagnostics: { type: "array", required: true, items: DIAGNOSTIC_ITEM_SCHEMA },
        },
      },
      render: function (args, value) {
        const lines = value.applied.map(function (a) { return "merge " + a.key + "/" + a.id + " -> " + a.fields.join(", "); });
        const skipped = value.skipped.map(function (s) { return "skip " + s.key + (s.id === undefined ? "" : "/" + s.id) + ": " + s.reason; });
        const body = lines.concat(skipped);
        return [{ type: "text", text: value.summary + (body.length === 0 ? "" : "\n" + body.join("\n")) }];
      },
    },
    presentCall: function (args) { return { card: "generic", title: "Merge canvas state", kind: "other", rawInput: args.path }; },
    async execute(args, exec) {
      const target = toolWritePath(state, exec, args.path);
      if (target.error !== undefined) {
        return { ok: false, summary: "refused: " + target.error, path: typeof args.path === "string" ? args.path : "", applied: [], skipped: [], diagnostics: [] };
      }
      const abs = target.path;
      const source = await fs.readFile(abs, "utf8");
      const doc = await readOverlay(abs);
      const merged = mergeOverlaysIntoSource(source, doc, { key: args.key, ids: args.ids });
      const diagnostics = [];
      if (!merged.ok) {
        diagnostics.push(mk("E_MERGE", "canvas_state_merge could not read export const DATA: " + merged.reason, {}));
        return { ok: false, summary: "merge failed for " + abs + ": " + merged.reason, path: abs, applied: [], skipped: merged.skipped, diagnostics: diagnostics };
      }
      let compiled = null;
      if (merged.changed && args.dryRun !== true) {
        await fs.writeFile(abs, merged.source, "utf8");
        await removeOverlayEntries(abs, merged.applied);
        compiled = compileCanvas({ path: abs, source: merged.source, limits: state.config.limits });
        for (const d of compiled.diagnostics) diagnostics.push(d);
      }
      const prefix = args.dryRun === true ? "would merge " : "merged ";
      const summary = merged.applied.length === 0
        ? "nothing to merge into " + abs
        : prefix + merged.applied.length + " row(s) into " + abs + (compiled === null || compiled.ok ? "" : " (the canvas now has diagnostics)");
      return {
        ok: compiled === null ? true : compiled.ok === true,
        summary: summary,
        path: abs,
        applied: merged.applied,
        skipped: merged.skipped,
        diagnostics: diagnostics,
      };
    },
  },
  ];
}

/**
 * Register the canvas-intent entry on the agent step waterfall.
 *
 * Registered eagerly, but the message factory is resolved lazily: a composition
 * without @deepseek-ai/dsh-llm must still load this plugin, and a deployment
 * that turns the hook off must pay nothing.
 * @param ctx - host context.
 * @param config - resolved plugin config.
 */
function registerIntentHook(ctx, config) {
  if (config.intentHook !== true || typeof ctx.on !== "function") return;
  let factoryPromise = null;
  function getCreateUserMessage() {
    if (factoryPromise === null) {
      factoryPromise = import("@deepseek-ai/dsh-llm").then(
        function (llm) { return typeof llm.createUserMessage === "function" ? llm.createUserMessage : null; },
        function () { return null; },
      );
    }
    return factoryPromise;
  }
  ctx.effect(function () {
    let warned = false;
    const guide = config.intentGuide === null
      ? undefined
      : function (match) {
          const signals = match !== null && Array.isArray(match.signals) && match.signals.length > 0 ? match.signals.slice(0, 4).join(" / ") : "";
          return config.intentGuide + (signals === "" ? "" : "\n\n（识别到的信号：" + signals + "）");
        };
    const listener = createCanvasIntentListener({
      getCreateUserMessage: getCreateUserMessage,
      keywords: config.intentKeywords,
      guide: guide,
      onError: function (error) {
        if (warned) return;
        warned = true;
        console.warn("[dsh-canvas] intent hook failed: " + String(error && error.message ? error.message : error));
      },
    });
    return ctx.on("agent/pre-step", listener);
  }, "canvas: intent hook");
}

// --------------------------------------------------------------------- entry

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  // Shared with the root resolver: it records the last Session root so tool
  // calls without a session do not fall back to the app's cwd.
  const memory = {};
  const state = {
    config: config,
    memory: memory,
    rootFor: makeRootResolver(ctx, config, memory),
    store: new ModuleStore(),
    cooldown: new Map(),
  };
  const handler = createHandler(ctx, state);

  registerIntentHook(ctx, config);

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
