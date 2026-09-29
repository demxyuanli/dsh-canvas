#!/usr/bin/env node
/**
 * Render a *.canvas.tsx to a standalone HTML preview, then let a headless
 * browser turn it into the README screenshot.
 *
 * Why this exists: the README should show what the plugin actually renders.
 * Rather than mock a board, this runs the REAL pipeline - host/compile.js
 * compiles the canvas, lib/client.js supplies the kit - and serialises the
 * resulting element tree to HTML. React is stubbed (the kit only needs its
 * hooks and createElement), so the only thing approximated is the surrounding
 * harness chrome, which is absent on purpose: these are panel bodies.
 *
 * The kit renders with the harness CSS variables, so the theme token CSS is
 * lifted from the harness checkout. Point DSH_CHECKOUT at it, or let the script
 * discover the npx cache.
 *
 * Usage:  node docs/preview/render.mjs board.canvas.tsx examples/selfcheck.canvas.tsx
 * Output: docs/preview/<stem>[-dark].html   (open it, or screenshot it)
 *
 * The stem is the canvas path relative to the repo root, separators folded to
 * dashes: examples/selfcheck.canvas.tsx -> examples-selfcheck. Naming by basename
 * alone let two same-named canvases in different directories overwrite each
 * other's preview and screenshot, silently.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compileCanvas } from "../../host/compile.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** Panel width in CSS px; the right sidebar is resizable and has a fullscreen mode. */
const WIDTH = Number(process.env.PREVIEW_WIDTH || 720);
/**
 * The harness flips its whole token set with `body[data-ds-dark-theme]`, and both
 * palettes live in the same theme sheets, so the dark variant needs no separate
 * CSS - only the attribute (plus `color-scheme` so scrollbars/controls follow).
 */
const DARK = (process.env.THEME || "light") === "dark";
const CSS_LITERAL = /=\s*"((?:[^"\\]|\\.)*)"/g;
const UNITLESS = new Set(["flex", "flexGrow", "flexShrink", "opacity", "fontWeight", "zIndex", "lineHeight", "order", "gridColumn", "gridRow", "zoom", "aspectRatio"]);
const SVG_TAGS = new Set(["svg", "g", "rect", "line", "text", "circle", "path", "polyline", "polygon"]);
const SVG_ATTRS = new Set(["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "viewBox", "width", "height", "fill", "stroke", "strokeWidth", "textAnchor", "fontSize", "fontFamily", "role", "aria-hidden"]);

function cssName(key) {
  return key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

function styleText(style) {
  const parts = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value === undefined || value === null || value === false) continue;
    parts.push(cssName(key) + ":" + (typeof value === "number" && !UNITLESS.has(key) ? value + "px" : String(value)));
  }
  return parts.join(";");
}

function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Serialise one stub element (or a whole tree) to HTML. */
function toHtml(node) {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (Array.isArray(node)) return node.map(toHtml).join("");
  if (typeof node === "string" || typeof node === "number") return esc(node);
  if (typeof node !== "object" || node.type === undefined) return "";
  if (typeof node.type === "function") return toHtml(node.type(node.props));
  const tag = node.type;
  const props = node.props || {};
  const svg = SVG_TAGS.has(tag);
  const attrs = [];
  const styles = [];
  if (props.style) { const text = styleText(props.style); if (text) styles.push(text); }
  for (const key of Object.keys(props)) {
    if (key === "children" || key === "style" || key === "key" || key.indexOf("on") === 0) continue;
    const value = props[key];
    if (value === undefined || value === null || value === false) continue;
    if (key === "disabled") { attrs.push("disabled"); continue; }
    if (svg && SVG_ATTRS.has(key)) {
      // Paint goes through style so var(--token) resolves; geometry stays an attribute.
      if (key === "fill" || key === "stroke") styles.push(cssName(key) + ":" + String(value));
      else attrs.push(cssName(key) + '="' + esc(value) + '"');
      continue;
    }
    if (typeof value === "string" || typeof value === "number") attrs.push(cssName(key) + '="' + esc(value) + '"');
  }
  if (styles.length > 0) attrs.push('style="' + esc(styles.join(";")) + '"');
  return "<" + tag + (attrs.length > 0 ? " " + attrs.join(" ") : "") + ">" + toHtml(props.children) + "</" + tag + ">";
}

/** Every CSS chunk that defines harness variables, decoded from its JS literal. */
async function readThemeCss() {
  const candidates = [];
  if (process.env.DSH_CHECKOUT) {
    candidates.push(path.join(process.env.DSH_CHECKOUT, "node_modules", "@deepseek-ai", "dsh-client-ui-theme", "lib", "client.js"));
  }
  const npx = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm-cache", "_npx") : null;
  if (npx) {
    try {
      for (const dir of await fs.readdir(npx)) candidates.push(path.join(npx, dir, "node_modules", "@deepseek-ai", "dsh-client-ui-theme", "lib", "client.js"));
    } catch { /* no npx cache */ }
  }
  for (const candidate of candidates) {
    let source;
    try { source = await fs.readFile(candidate, "utf8"); } catch { continue; }
    const chunks = [];
    CSS_LITERAL.lastIndex = 0;
    let match;
    while ((match = CSS_LITERAL.exec(source)) !== null) {
      let text;
      try { text = JSON.parse('"' + match[1] + '"'); }
      catch { text = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\").replace(/\\"/g, '"'); }
      if (text.indexOf("--dsw-") !== -1 && text.indexOf("{") !== -1) chunks.push(text);
    }
    const css = chunks.join("\n");
    if (css.indexOf("--dsw-alias-label-primary") === -1) throw new Error("theme CSS without --dsw-alias-label-primary: " + candidate);
    return { css, source: candidate };
  }
  throw new Error("could not find the harness theme; set DSH_CHECKOUT to the harness checkout directory");
}

/** Load lib/client.js behind a React stub and hand back the kit. */
async function loadKit() {
  let captured = null;
  globalThis.window = { __ModuleLoader__: { load(options) { captured = options; } } };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: Object.assign({}, props, { children: children.length <= 1 ? children[0] : children }) }),
    Fragment: "Fragment",
    Component: class { constructor(props) { this.props = props; this.state = {}; } setState(next) { Object.assign(this.state, next); } },
    createContext: () => ({ Provider: "Provider" }),
    useContext: () => null,
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  };
  await import(pathToFileURL(path.join(ROOT, "lib", "client.js")).href);
  if (captured === null) throw new Error("lib/client.js did not register with the module loader");
  captured.factory((id) => { if (id === "react") return React; throw new Error("the client half must not require " + id); });
  return globalThis.__DSH_CANVAS__;
}

/**
 * Output stem for one canvas: repo-relative path, separators folded to dashes.
 * Paths outside the repo fall back to the basename; either way the result is
 * unique per source file, which is what stops the silent overwrite.
 * @param abs - Absolute canvas path.
 * @returns The stem, without the `-dark` suffix and without `.canvas.tsx`.
 */
function stem(abs) {
  const rel = path.relative(ROOT, abs);
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  const reference = inside ? rel : path.basename(abs);
  return reference.replace(/\.canvas\.tsx$/, "").split(/[\\/]+/).filter((part) => part !== "").join("-");
}

async function renderOne(kit, reference, themeCss) {
  const abs = path.resolve(ROOT, reference);
  const source = await fs.readFile(abs, "utf8");
  const compiled = compileCanvas({ path: abs, source });
  if (!compiled.ok) throw new Error("canvas did not compile: " + reference + "\n" + JSON.stringify(compiled.diagnostics, null, 2));
  const name = stem(abs);
  const tmp = path.join(HERE, ".render-" + name + "-" + Date.now() + ".mjs");
  await fs.writeFile(tmp, compiled.code, "utf8");
  const mod = await import(pathToFileURL(tmp).href + "?v=" + Date.now());
  await fs.rm(tmp, { force: true });
  const title = compiled.data !== undefined && typeof compiled.data === "object" && typeof compiled.data.goal === "string"
    ? compiled.data.goal
    : path.basename(abs);
  const html = [
    "<!doctype html>",
    '<html lang="zh"><head><meta charset="utf-8">',
    "<title>" + esc(name) + "</title>",
    "<style>",
    themeCss,
    DARK ? "html{color-scheme:dark;}" : "",
    "html,body{margin:0;padding:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}",
    "#panel{width:" + WIDTH + "px;box-sizing:border-box;}",
    "</style></head>",
    DARK ? "<body data-ds-dark-theme>" : "<body>",
    '<div id="panel">' + toHtml(kit.React.createElement(mod.default, null)) + "</div>",
    "</body></html>",
    "",
  ].join("\n");
  const out = path.join(HERE, name + (DARK ? "-dark" : "") + ".html");
  await fs.writeFile(out, html, "utf8");
  return { out, bytes: html.length, title };
}

const refs = process.argv.slice(2);
if (refs.length === 0) {
  console.error("usage: node docs/preview/render.mjs <file.canvas.tsx> [...]");
  process.exit(2);
}
const { css, source: themeSource } = await readThemeCss();
console.log("theme: " + themeSource + " (" + css.length + " bytes of css)");
const kit = await loadKit();
for (const ref of refs) {
  const result = await renderOne(kit, ref, css);
  console.log("wrote " + path.relative(ROOT, result.out) + " (" + result.bytes + " bytes) - " + result.title);
}
