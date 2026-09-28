/**
 * Browser-half smoke test: no browser. Stubs window.__ModuleLoader__ and React,
 * loads lib/client.js, runs the factory, applies the plugin to a stub context,
 * and renders the tab body once. This is the half that decides whether the
 * "Canvases" entry and the *.canvas.tsx tab type exist in the page at all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let captured = null;
globalThis.window = { __ModuleLoader__: { load(options) { captured = options; } } };

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
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

let pass = 0; let fail = 0;
function t(label, fn) {
  try { fn(); pass++; console.log("ok   " + label); }
  catch (error) { fail++; console.log("FAIL " + label + "\n     " + (error && error.message ? error.message : error)); }
}

await import("../lib/client.js");

t("registers one module under the package name", () => {
  assert.ok(captured, "client.js never called __ModuleLoader__.load");
  assert.equal(captured.id, "@local/dsh-canvas");
  assert.equal(typeof captured.factory, "function");
});

const plugin = captured.factory(requireStub);

t("exports a plugin that injects the sidebar services", () => {
  assert.equal(typeof plugin.apply, "function");
  assert.ok(plugin.inject.includes("sidebarRightTabs"), "inject: " + JSON.stringify(plugin.inject));
  // Reading an uninjected service throws "cannot get property ... without inject".
  assert.ok(plugin.inject.includes("sidebarRight"), "the navigation controller must be injected");
  assert.ok(plugin.inject.includes("slots"));
});

t("publishes the kit for compiled canvases", () => {
  const kit = globalThis.__DSH_CANVAS__;
  assert.equal(typeof kit.h, "function");
  for (const name of ["Stack", "Row", "Grid", "Divider", "CollapsibleSection", "H1", "H2", "Text", "Code", "Card", "CardHeader", "CardBody", "Callout", "Stat", "Table", "BarChart", "TodoList", "Button", "Pill"]) {
    assert.ok(kit[name] !== undefined, "kit is missing component " + name);
  }
  for (const name of ["useCanvasState", "useCanvasOverlay", "useCanvasAction", "useHostTheme", "useCanvasResource", "useMemo", "useState", "useEffect"]) {
    assert.ok(kit[name] !== undefined, "kit is missing hook " + name);
  }
});

const seen = { types: [], slots: [] };
const ctx = {
  effect: (fn) => fn(),
  slots: { register: (spec, component) => { seen.slots.push({ spec, component }); return () => {}; } },
  sidebarRightTabs: { register: (definition) => { seen.types.push(definition); return () => {}; } },
};

t("apply() registers the tab type and the panel body", () => {
  plugin.apply(ctx);
  assert.equal(seen.types.length, 1, "expected exactly one tab type");
  assert.equal(seen.slots.length, 1, "expected exactly one slot registration");
});

t("the tab type claims *.canvas.tsx and carries a guide entry", () => {
  const type = seen.types[0];
  assert.equal(type.kind, "canvas");
  assert.deepEqual(type.patterns, ["*.canvas.tsx"]);
  assert.equal(type.priority, "extension");
  assert.equal(typeof type.title, "function");
  assert.equal(type.title("dsh-resource://file/session/s1/tools/dsh-canvas/examples/selfcheck.canvas.tsx"), "selfcheck");
  assert.ok(Array.isArray(type.guide) && type.guide.length === 1, "the guide entry is how the user discovers canvases");
  // The guide body calls entry.title() and entry.description?.(); strings crash it.
  assert.equal(typeof type.guide[0].title, "function", "guide[].title must be a thunk");
  assert.equal(typeof type.guide[0].description, "function", "guide[].description must be a thunk");
  assert.ok(type.guide[0].title().length > 0, "guide[].title() must return copy");
  assert.ok(type.guide[0].description().length > 0, "guide[].description() must return copy");
  assert.equal(typeof type.guide[0].id, "string");
});

t("the body registers under the tab type key", () => {
  assert.equal(seen.slots[0].spec.name, "sidebar.right.pane.tab");
  assert.equal(seen.slots[0].spec.key, seen.types[0].id);
});

t("the body renders the directory page when opened as a page", () => {
  const Body = seen.slots[0].component;
  const tree = Body({ useTabInfo: () => ({ tab: null }), useResource: () => null, sessionId: "sess-1", useSessions: (select) => select({ byId: { "sess-1": { cwd: "D:/ws" } } }) });
  assert.ok(tree !== undefined && tree !== null, "body returned nothing");
  assert.equal(tree.type, globalThis.__DSH_CANVAS__.Stack, "expected the outer Stack");
});

t("the body survives a resource tab with no readable source", () => {
  const Body = seen.slots[0].component;
  const tree = Body({
    useTabInfo: () => ({ tab: { contentId: "dsh-resource://file/session/s1/tools/x.canvas.tsx" } }),
    useResource: () => null,
    sessionId: "s1",
    useSessions: (select) => select({ byId: { s1: { cwd: "D:/ws" } } }),
  });
  assert.ok(tree !== undefined && tree !== null);
});


t("the open path declares every helper it calls", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  for (const name of ["encodeSegment", "sessionFileAddress", "currentSessionId", "openAddress"]) {
    assert.ok(src.includes("function " + name + "("), name + " must be declared");
  }
  assert.ok(!src.includes("fileAddressOf"), "the replaced helper must be gone, not left dangling");
});
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);