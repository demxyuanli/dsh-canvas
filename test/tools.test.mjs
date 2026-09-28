/** Every tool definition must survive the real defineTool schema compiler. */
import assert from "node:assert/strict";
import { toolDefinitions } from "../index.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { DEFAULT_LIMITS } from "../host/compile.js";

const state = { config: { limits: DEFAULT_LIMITS }, rootFor: () => process.cwd() };
const options = toolDefinitions(state);
assert.equal(options.length, 3, "expected three tools");

let pass = 0; let fail = 0;
for (const option of options) {
  try {
    const tool = defineTool(option);
    const params = Object.keys((tool.parameters && tool.parameters.properties) || {}).join(",");
    const outProps = Object.keys((tool.output && tool.output.schema && tool.output.schema.properties) || {}).join(",");
    assert.equal(typeof tool.execute, "function");
    need(option, "description");
    need(option, "parameters");
    assert.equal(typeof option.output.render, "function", option.name + " needs output.render");
    pass++;
    console.log("ok   " + option.name + "  params={" + params + "}  output={" + outProps + "}");
  } catch (error) {
    fail++;
    console.log("FAIL " + option.name + ": " + (error && error.message ? error.message : error));
  }
}
function need(option, key) {
  assert.ok(option[key] !== undefined, option.name + " is missing " + key);
}
console.log("\n" + pass + " compiled, " + fail + " rejected");
process.exit(fail === 0 ? 0 : 1);