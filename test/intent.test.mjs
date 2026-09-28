/**
 * Intent entry tests: the matcher must fire on "make me a board" and stay quiet
 * on incidental uses of the same words, and the listener must add exactly one
 * guidance message without ever breaking the step.
 */
import assert from "node:assert/strict";
import { createUserMessage } from "@deepseek-ai/dsh-llm";

import { matchesCanvasIntent, userPlainText, buildCanvasIntakeGuidance, createCanvasIntentListener } from "../host/intent.js";

let pass = 0; let fail = 0;
function t(label, fn) {
  try { fn(); pass++; console.log("ok   " + label); }
  catch (error) { fail++; console.log("FAIL " + label + "\n     " + (error && error.message ? error.message : error)); }
}
async function ta(label, fn) {
  try { await fn(); pass++; console.log("ok   " + label); }
  catch (error) { fail++; console.log("FAIL " + label + "\n     " + (error && error.message ? error.message : error)); }
}

function userMessage(text, kind, rpcId) {
  const source = { kind: kind === undefined ? "user" : kind };
  if (rpcId !== undefined) source.rpcId = rpcId;
  return createUserMessage({ content: [{ type: "text", text: text }], source: source });
}
function listener(overrides) {
  return createCanvasIntentListener(Object.assign({
    getCreateUserMessage: async () => createUserMessage,
  }, overrides || {}));
}

t("a strong noun fires without a verb", () => {
  const match = matchesCanvasIntent("给我建个项目看板");
  assert.equal(match.matched, true);
  assert.ok(match.signals.includes("看板"));
});

t("英文强名词单独触发", () => {
  assert.equal(matchesCanvasIntent("show me the dashboard").matched, true);
});

t("a weak noun needs a creation verb", () => {
  assert.equal(matchesCanvasIntent("create a project canvas").matched, true);
  assert.equal(matchesCanvasIntent("the canvas plugin tests failed").matched, false);
});

t("中文弱名词 + 动词触发", () => {
  assert.equal(matchesCanvasIntent("帮我整理一份项目现状").matched, true);
  assert.equal(matchesCanvasIntent("项目进度已经同步了").matched, false);
});

t("部署自定义关键词按弱名词处理", () => {
  assert.equal(matchesCanvasIntent("给我一份 risk register", ["risk register"]).matched, true);
  assert.equal(matchesCanvasIntent("risk register 已更新", ["risk register"]).matched, false);
});

t("只能读到人说的内容，读不到别的插件注入的上下文", () => {
  const text = userPlainText([userMessage("我要一个看板"), userMessage("goal round: keep going", "goal-round")]);
  assert.equal(text, "我要一个看板");
});

t("画布自己提交的任务不算新的建板请求", () => {
  const text = userPlainText([userMessage("处理 V-03：runCommand 在真实 ctx.shell 上跑通\n完成后更新这张画布的 DATA", "user", "canvas-abc123")]);
  assert.equal(text, "", "the hand-off carries canvas-* rpcId and must read as empty");
});

await ta("画布提交的任务不会再次触发 intake", async () => {
  const payload = { messages: [userMessage("处理 V-03：把这张画布更新一下", "user", "canvas-abc123")] };
  const downstream = { kind: "enter", messages: payload.messages };
  const out = await listener()(payload, async () => downstream);
  assert.equal(out, downstream, "a work hand-off must pass through untouched");
});

t("guidance 自带 intake 与质量门槛", () => {
  const text = buildCanvasIntakeGuidance(matchesCanvasIntent("建个看板"));
  for (const needle of ["意图入口", "intake", "质量门槛", "useCanvasOverlay", "references/intake.md"]) {
    assert.ok(text.includes(needle), "guidance is missing " + needle);
  }
});

await ta("匹配时恰好追加一条带来源的 user 消息", async () => {
  const payload = { messages: [userMessage("给我建一个项目看板")] };
  const downstream = { kind: "enter", messages: payload.messages };
  const out = await listener()(payload, async () => downstream);
  assert.equal(out.kind, "enter");
  assert.equal(out.messages.length, downstream.messages.length + 1);
  const added = out.messages[out.messages.length - 1];
  assert.equal(added.role, "user");
  assert.equal(added.source.kind, "dsh-canvas");
  assert.ok(added.content[0].text.includes("意图入口"));
});

await ta("不匹配时不改动下游决定", async () => {
  const payload = { messages: [userMessage("帮我修一个空指针")] };
  const downstream = { kind: "enter", messages: payload.messages };
  const out = await listener()(payload, async () => downstream);
  assert.equal(out, downstream);
});

await ta("下游拒绝时保持拒绝", async () => {
  const out = await listener()({ messages: [userMessage("建个画布")] }, async () => ({ kind: "reject" }));
  assert.deepEqual(out, { kind: "reject" });
});

await ta("后续 step 的空批次不会重复注入", async () => {
  const downstream = { kind: "enter", messages: [] };
  const out = await listener()({ messages: [] }, async () => downstream);
  assert.equal(out, downstream);
});

await ta("消息工厂缺席时安静跳过", async () => {
  const payload = { messages: [userMessage("建个画布")] };
  const downstream = { kind: "enter", messages: payload.messages };
  const out = await listener({ getCreateUserMessage: async () => null })(payload, async () => downstream);
  assert.equal(out, downstream);
});

await ta("自身出错时上报并放行，不破坏 step", async () => {
  const seen = [];
  const payload = { messages: [userMessage("建个画布")] };
  const downstream = { kind: "enter", messages: payload.messages };
  const out = await listener({ guide: () => { throw new Error("boom"); }, onError: (error) => seen.push(String(error.message)) })(payload, async () => downstream);
  assert.equal(out, downstream);
  assert.deepEqual(seen, ["boom"]);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
