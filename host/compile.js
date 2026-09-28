/** Canvas compiler: source -> static diagnostics -> sucrase -> content-addressed ESM module. */

import { createHash } from "node:crypto";
import { transform } from "sucrase";
import { mk } from "./diagnostics.js";
import { scanSource } from "./scan.js";
import { extractData } from "./literal.js";

/** Bump when the transform changes; it is part of every module URL. */
export const COMPILER_VERSION = "c1";
/** Bump when the kit surface changes; it is part of every module URL. */
export const KIT_VERSION = "k2";

export const DEFAULT_LIMITS = {
  maxSourceBytes: 1048576,
  warnSourceBytes: 131072,
  maxLines: 8000,
  warnLines: 1500,
  maxDataBytes: 4194304,
  maxRenderRows: 5000,
  compileTimeoutMs: 2000,
};

export const ROUTE_PREFIX = "/canvas";

export function pathHash(absPath) {
  return createHash("sha1").update(String(absPath)).digest("hex").slice(0, 12);
}

export function contentSha(source) {
  return createHash("sha1")
    .update(source)
    .update("|" + COMPILER_VERSION + "|" + KIT_VERSION)
    .digest("hex")
    .slice(0, 16);
}

export function moduleUrl(absPath, sha) {
  return ROUTE_PREFIX + "/module/" + pathHash(absPath) + "/" + sha + ".js";
}

function locationOf(error, source) {
  const loc = error && error.loc;
  if (loc && typeof loc.line === "number") return { line: loc.line, col: typeof loc.column === "number" ? loc.column + 1 : undefined };
  const m = /\(?(\d+):(\d+)\)?\s*$/.exec(String((error && error.message) || ""));
  if (m !== null) return { line: Number(m[1]), col: Number(m[2]) + 1 };
  return {};
}

function wrap(code) {
  return [
    "const __C = globalThis.__DSH_CANVAS__;",
    "if (!__C) { throw new Error(\"DSH canvas runtime is not installed\"); }",
    "const __require = function (id) {",
    "  if (id === \"dsh/canvas\") return __C;",
    "  if (id === \"react\") return __C.React;",
    "  throw new Error(\"canvas may not require \" + id);",
    "};",
    "const __module = { exports: {} };",
    "(function (require, exports, module, __DSH_CANVAS__) {",
    code,
    "})(__require, __module.exports, __module, __C);",
    "export default __module.exports.default;",
    "export const DATA = __module.exports.DATA;",
    "export const __canvas = { compiler: \"" + COMPILER_VERSION + "\", kit: \"" + KIT_VERSION + "\" };",
  ].join("\n");
}

/**
 * Compile one canvas.
 * @param request - { path, source, limits }.
 * @returns { ok, diagnostics, sha, url, data, code } - ok:false carries at least one error diagnostic.
 */
export function compileCanvas(request) {
  const absPath = request.path;
  const source = String(request.source ?? "");
  const limits = Object.assign({}, DEFAULT_LIMITS, request.limits || {});
  const diagnostics = [];
  const bytes = Buffer.byteLength(source, "utf8");
  const lines = source.split("\n").length;

  if (bytes > limits.maxSourceBytes || lines > limits.maxLines) {
    diagnostics.push(mk("E_TOO_LARGE", "Canvas is " + bytes + " bytes / " + lines + " lines, above the hard limit of " + limits.maxSourceBytes + " bytes / " + limits.maxLines + " lines."));
    return { ok: false, diagnostics };
  }
  if (bytes > limits.warnSourceBytes || lines > limits.warnLines) {
    diagnostics.push(mk("W_LARGE_FILE", "Canvas is " + bytes + " bytes / " + lines + " lines; consider splitting it."));
  }
  for (const d of scanSource(source)) diagnostics.push(d);
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };

  let code;
  try {
    code = transform(source, {
      transforms: ["typescript", "jsx", "imports"],
      jsxRuntime: "classic",
      jsxPragma: "__DSH_CANVAS__.h",
      jsxFragmentPragma: "__DSH_CANVAS__.Fragment",
      production: true,
      filePath: absPath,
    }).code;
  } catch (error) {
    diagnostics.push(mk("E_PARSE", String((error && error.message) || error), locationOf(error, source)));
    return { ok: false, diagnostics };
  }

  if (!/\bexports\.default\s*=/.test(code)) {
    diagnostics.push(mk("E_NO_DEFAULT", "This canvas has no default export, so there is nothing to render.", {}));
    return { ok: false, diagnostics };
  }

  const data = extractData(code);
  if (data.ok) {
    const dataBytes = Buffer.byteLength(JSON.stringify(data.value), "utf8");
    if (dataBytes > limits.maxDataBytes) {
      diagnostics.push(mk("E_DATA_NOT_LITERAL", "export const DATA is " + dataBytes + " bytes, above the hard limit of " + limits.maxDataBytes + ".", { hint: "Move history out of DATA, or split the canvas." }));
      return { ok: false, diagnostics };
    }
  } else if (data.missing) {
    diagnostics.push(mk("W_NO_DATA", "No export const DATA found; canvas_read will have to read the whole file."));
  } else {
    diagnostics.push(data.diagnostic);
    return { ok: false, diagnostics };
  }

  const sha = contentSha(source);
  return {
    ok: true,
    diagnostics,
    sha,
    url: moduleUrl(absPath, sha),
    data: data.ok ? data.value : undefined,
    bytes,
    lines,
    code: wrap(code),
  };
}
