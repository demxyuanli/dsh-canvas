/**
 * Merge unit tests: the sidecar must land in DATA without reformatting the
 * file. "Minimal field replacement" is the whole promise, so the assertions are
 * about byte-identity of everything the merge did not touch.
 */
import assert from "node:assert/strict";

import { mergeOverlaysIntoSource, findDataNode, literalText } from "../host/merge.js";

const SOURCE = [
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
  "export default function C() {",
  "  return <Stack />;",
  "}",
  "",
].join("\n");

const DOC = {
  overlays: {
    tasks: {
      t1: { status: "in_progress", owner: "worker-a", at: "2026-09-28T00:00:00.000Z", by: "user" },
      t9: { status: "pending" },
    },
  },
};

let pass = 0; let fail = 0;
function t(label, fn) {
  try { fn(); pass++; console.log("ok   " + label); }
  catch (error) { fail++; console.log("FAIL " + label + "\n     " + (error && error.message ? error.message : error)); }
}

let merged = null;
t("merge reports what it applied and what it skipped", () => {
  merged = mergeOverlaysIntoSource(SOURCE, DOC, {});
  assert.equal(merged.ok, true, merged.reason);
  assert.deepEqual(merged.applied, [{ key: "tasks", id: "t1", fields: ["status", "owner"] }]);
  assert.deepEqual(merged.skipped, [{ key: "tasks", id: "t9", reason: "no row with this id" }]);
  assert.equal(merged.changed, true);
});

t("the patched fields land with the human's values", () => {
  assert.ok(merged.source.includes('status: "in_progress"'), "status not replaced");
  assert.ok(merged.source.includes('owner: "worker-a"'), "new field not inserted");
});

t("everything the merge did not touch stays byte-identical", () => {
  assert.ok(merged.source.includes('{ id: "t2", title: "second", status: "completed" },'), "another row moved");
  assert.ok(merged.source.includes('goal: "keep me",'), "a sibling key moved");
  assert.ok(merged.source.includes("  return <Stack />;"), "render code moved");
  assert.ok(merged.source.startsWith("/** @canvas"), "header moved");
  assert.ok(merged.source.endsWith("}\n"), "trailing newline changed");
});

t("the merged DATA re-parses to the expected value", () => {
  const node = findDataNode(merged.source);
  assert.equal(node.ok, true, node.reason);
  assert.deepEqual(node.node.value, {
    goal: "keep me",
    tasks: [
      { id: "t1", title: "first", status: "in_progress", owner: "worker-a" },
      { id: "t2", title: "second", status: "completed" },
    ],
  });
});

t("a key filter narrows the merge", () => {
  const result = mergeOverlaysIntoSource(SOURCE, DOC, { key: "other" });
  assert.equal(result.changed, false);
  assert.equal(result.source, SOURCE, "a filtered-out merge must not rewrite the file");
  assert.deepEqual(result.skipped, [], "keys outside the filter are not considered at all");
});

t("an ids filter narrows the merge", () => {
  const result = mergeOverlaysIntoSource(SOURCE, DOC, { ids: ["t9"] });
  assert.equal(result.changed, false);
  assert.deepEqual(result.skipped, [{ key: "tasks", id: "t9", reason: "no row with this id" }]);
});

t("a patch of only sidecar metadata is not a change", () => {
  const result = mergeOverlaysIntoSource(SOURCE, { overlays: { tasks: { t1: { at: "x", by: "user" } } } }, {});
  assert.equal(result.changed, false);
  assert.equal(result.source, SOURCE);
});

t("a source without DATA fails cleanly", () => {
  const result = mergeOverlaysIntoSource("export default function C() { return null; }\n", DOC, {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /DATA/);
});

t("string values keep quotes the tolerant parser can read back", () => {
  assert.equal(literalText('he said "hi"'), '"he said \\"hi\\""');
  assert.equal(literalText(null), "null");
  assert.equal(literalText(true), "true");
  assert.equal(literalText([1, "a"]), '[1, "a"]');
});

t("a tab-indented row keeps tabs", () => {
  const source = 'export const DATA = {\n\trows: [\n\t\t{\n\t\t\tid: "a",\n\t\t\tstatus: "pending",\n\t\t},\n\t],\n} as const;\n';
  const out = mergeOverlaysIntoSource(source, { overlays: { rows: { a: { owner: "x" } } } }, {});
  assert.equal(out.ok, true, out.reason);
  assert.ok(out.source.includes('\t\t\towner: "x",'), "the inserted field must reuse the row's tab indentation");
  assert.deepEqual(findDataNode(out.source).node.value, { rows: [{ id: "a", status: "pending", owner: "x" }] });
});

t("a CRLF file does not gain a bare LF", () => {
  const source = 'export const DATA = {\r\n  rows: [\r\n    {\r\n      id: "a",\r\n      status: "pending",\r\n    },\r\n  ],\r\n} as const;\r\n';
  const out = mergeOverlaysIntoSource(source, { overlays: { rows: { a: { owner: "x" } } } }, {});
  assert.equal(out.ok, true, out.reason);
  assert.ok(!/[^\r]\n/.test(out.source), "every LF must remain part of a CRLF pair");
  assert.deepEqual(findDataNode(out.source).node.value, { rows: [{ id: "a", status: "pending", owner: "x" }] });
});

t("a one-line row stays on one line", () => {
  const source = 'export const DATA = {\n  rows: [\n    { id: "a", status: "pending" },\n  ],\n} as const;\n';
  const out = mergeOverlaysIntoSource(source, { overlays: { rows: { a: { owner: "x" } } } }, {});
  assert.equal(out.ok, true, out.reason);
  assert.ok(out.source.includes('{ id: "a", status: "pending", owner: "x" },'), "the row must not be broken across lines");
  assert.deepEqual(findDataNode(out.source).node.value, { rows: [{ id: "a", status: "pending", owner: "x" }] });
});

t("a row without an id cannot be addressed, and says so", () => {
  const source = 'export const DATA = {\n  rows: [\n    { status: "pending" },\n  ],\n} as const;\n';
  const out = mergeOverlaysIntoSource(source, { overlays: { rows: { a: { owner: "x" } } } }, {});
  assert.equal(out.changed, false);
  assert.equal(out.source, source);
  assert.deepEqual(out.skipped, [{ key: "rows", id: "a", reason: "no row with this id" }]);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
