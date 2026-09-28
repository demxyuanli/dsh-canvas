import assert from "node:assert/strict";
import { compileCanvas, pathHash, contentSha } from "../host/compile.js";
import { blankNonCode } from "../host/scan.js";

let pass = 0; let fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); }
}
const codes = (r) => r.diagnostics.map((d) => d.code);
const P = "D:/ws/demo.canvas.tsx";

const GOOD = [
  'import { H1, Text, Stack, useCanvasState } from "dsh/canvas";',
  'type Status = "a" | "b";',
  'export const DATA = {',
  '  tasks: [',
  '    { id: "t1", status: "a" as Status, note: \'single quoted\' },',
  '    { id: "t2", status: "b" },',
  '  ],',
  '  nested: { xs: [1, 2.5, -3, true, false, null] },',
  '} as const;',
  'export default function Board() {',
  '  const [f] = useCanvasState("f", "open");',
  '  return <Stack gap={8}><H1>{f}</H1><Text tone="secondary">hi</Text></Stack>;',
  '}',
].join("\n");

t("valid canvas compiles", () => {
  const r = compileCanvas({ path: P, source: GOOD });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.equal(r.diagnostics.length, 0);
  assert.equal(r.url, "/canvas/module/" + pathHash(P) + "/" + contentSha(GOOD) + ".js");
  assert.match(r.code, /export default __module\.exports\.default;/);
  assert.match(r.code, /globalThis\.__DSH_CANVAS__/);
  assert.match(r.code, /__DSH_CANVAS__\.h\(/);
});

t("DATA is extracted exactly (trailing commas, single quotes, as const)", () => {
  const r = compileCanvas({ path: P, source: GOOD });
  assert.deepEqual(r.data, {
    tasks: [{ id: "t1", status: "a", note: "single quoted" }, { id: "t2", status: "b" }],
    nested: { xs: [1, 2.5, -3, true, false, null] },
  });
});

t("same source gives the same sha; different source does not", () => {
  const a = compileCanvas({ path: P, source: GOOD });
  const b = compileCanvas({ path: P, source: GOOD });
  const c = compileCanvas({ path: P, source: GOOD.replace("hi", "ho") });
  assert.equal(a.sha, b.sha);
  assert.notEqual(a.sha, c.sha);
});

t("illegal import is rejected", () => {
  const r = compileCanvas({ path: P, source: "import fs from \"node:fs\";\nexport default function X(){ return null; }" });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["E_PARSE_IMPORT"]);
});

t("react import is rejected (host injects it)", () => {
  const r = compileCanvas({ path: P, source: "import React from \"react\";\nexport default function X(){ return null; }" });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["E_PARSE_IMPORT"]);
});

t("missing default export is rejected", () => {
  const r = compileCanvas({ path: P, source: "export const DATA = { a: 1 };" });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["E_NO_DEFAULT"]);
});

t("side-effect APIs are rejected and located", () => {
  const r = compileCanvas({ path: P, source: "export default function X(){ fetch(\"/x\"); return null; }" });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("E_SIDE_EFFECT"));
  const d = r.diagnostics.find((x) => x.code === "E_SIDE_EFFECT");
  assert.equal(d.line, 1);
});

t("syntax error becomes E_PARSE with a line", () => {
  const r = compileCanvas({ path: P, source: "export default function X(){\n  return <Stack>\n}\n" });
  assert.equal(r.ok, false);
  const d = r.diagnostics.find((x) => x.code === "E_PARSE");
  assert.ok(d, JSON.stringify(r.diagnostics));
  console.log("     E_PARSE loc -> line=" + d.line + " col=" + d.col + " msg=" + d.message.slice(0, 90));
});

t("non-literal DATA is rejected", () => {
  const r = compileCanvas({ path: P, source: "const BASE = 1;\nexport const DATA = { a: BASE };\nexport default function X(){ return null; }" });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["E_DATA_NOT_LITERAL"]);
  assert.match(r.diagnostics[0].message, /identifier BASE/);
});

t("template string in DATA is rejected", () => {
  const r = compileCanvas({ path: P, source: "export const DATA = { a: \u0060x\u0060 };\nexport default function X(){ return null; }" });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["E_DATA_NOT_LITERAL"]);
});

t("missing DATA only warns", () => {
  const r = compileCanvas({ path: P, source: "export default function X(){ return null; }" });
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r), ["W_NO_DATA"]);
  assert.equal(r.data, undefined);
});

t("blankNonCode keeps offsets and spares prose", () => {
  const s = "const a = \"document. and fetch( live here\";\n// document. too\nfetch(1);";
  const b = blankNonCode(s);
  assert.equal(b.length, s.length);
  assert.equal(b.split("\n").length, s.split("\n").length);
  assert.equal(b.indexOf("document."), -1);
  assert.equal(b.indexOf("fetch(") >= 0, true);
});

t("a side-effect word inside a string is not a false positive", () => {
  const r = compileCanvas({ path: P, source: "export const DATA = { note: \"call fetch(document) here\" };\nexport default function X(){ return null; }" });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
});

t("oversized source is rejected", () => {
  const big = "export default function X(){ return null; }\n" + "// pad\n".repeat(9000);
  const r = compileCanvas({ path: P, source: big });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["E_TOO_LARGE"]);
});

t("large-but-allowed source warns", () => {
  const pad = "// pad pad pad pad pad pad pad pad pad pad pad\n".repeat(1600);
  const r = compileCanvas({ path: P, source: "export default function X(){ return null; }\n" + pad });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.ok(codes(r).includes("W_LARGE_FILE"));
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
