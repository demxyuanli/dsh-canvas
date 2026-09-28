/**
 * Board render test: compile the shipped board template, execute the real kit
 * (lib/client.js) against a React stub, and render the component tree.
 *
 * canvas_check only proves the file compiles. The complaints that produced this
 * test were about the rendered board, so the assertions are about what the
 * component actually produces: the derived analysis, not just the syntax.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCanvas } from "../host/compile.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// --- React stub -------------------------------------------------------------
// createElement mirrors the real contract: children live in props.children, so
// kit components can be invoked like React would invoke them.
let captured = null;
globalThis.window = { __ModuleLoader__: { load(options) { captured = options; } } };

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: Object.assign({}, props, { children: children.length <= 1 ? children[0] : children }),
  }),
  Fragment: "Fragment",
  Component: class { constructor(props) { this.props = props; this.state = {}; } setState(next) { Object.assign(this.state, next); } },
  createContext: (value) => ({ Provider: "Provider", value }),
  useContext: () => null,
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
};
const requireStub = (id) => {
  if (id === "react") return React;
  throw new Error("the client half must not require " + id);
};

await import("../lib/client.js");
captured.factory(requireStub);
const kit = globalThis.__DSH_CANVAS__;

const boardSource = await fs.readFile(path.join(ROOT, "skills", "canvas", "templates", "board.canvas.tsx"), "utf8");
const compiled = compileCanvas({ path: path.join(ROOT, "skills", "canvas", "templates", "board.canvas.tsx"), source: boardSource });
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));

const tmp = path.join(os.tmpdir(), "canvas-board-" + process.pid + ".mjs");
await fs.writeFile(tmp, compiled.code, "utf8");
const mod = await import("file://" + tmp.replace(/\\/g, "/"));

/** Render a tree of kit elements the way React would: call every function type. */
function render(node) {
  if (node === null || node === undefined || typeof node === "boolean") return node;
  if (Array.isArray(node)) return node.map(render);
  if (typeof node === "object" && node.type !== undefined) {
    if (typeof node.type === "function") return render(node.type(node.props));
    return node;
  }
  return node;
}

/** Every primitive that ended up in the rendered tree. */
function texts(node, out) {
  out = out || [];
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out; }
  if (typeof node === "object") {
    if (node.type !== undefined && typeof node.type !== "function") {
      // A host element: recurse into its children.
      texts(node.props === undefined ? undefined : node.props.children, out);
      return out;
    }
    if (node.type !== undefined) { texts(render(node), out); return out; }
    return out;
  }
  out.push(String(node));
  return out;
}

let pass = 0; let fail = 0;
function t(label, fn) {
  try { fn(); pass++; console.log("ok   " + label); }
  catch (error) { fail++; console.log("FAIL " + label + "\n     " + (error && error.message ? error.message : error)); }
}

let tree = null;
t("the board template renders through the real kit", () => {
  tree = render(mod.default());
  assert.ok(tree !== null && tree !== undefined, "the component returned nothing");
});

const flat = texts(tree);
const joined = flat.join("\n");

t("it renders the tracking surface, not just a list", () => {
  for (const needle of ["Task board", "待办", "下一步", "明细", "活动", "加权进度"]) {
    assert.ok(joined.includes(needle), "missing section: " + needle);
  }
});

t("derived analysis matches the data", () => {
  // counted = 5 tasks, estimates 3+2+5+1+1 = 12; weighted = 180+0+200+100+0 = 480.
  assert.ok(joined.includes("40%"), "expected the weighted progress 40% in:\n" + joined.slice(0, 400));
  assert.ok(joined.includes("2 条阻塞：T-02、T-03"), "blocked analysis missing");
  assert.ok(joined.includes("2 条超过 5 天未更新：T-03、T-05"), "stale analysis missing");
});

t("every task id reaches the rendered board", () => {
  for (const id of ["T-01", "T-02", "T-03", "T-04", "T-05", "T-06"]) {
    assert.ok(joined.includes(id), "missing task " + id);
  }
});

t("the kit publishes the components the board depends on", () => {
  for (const name of ["Progress", "KeyValue", "Timeline"]) {
    assert.equal(typeof kit[name], "function", "kit is missing " + name);
  }
});

await fs.rm(tmp, { force: true });
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
