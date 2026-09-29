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

t("强名词在有创建动词时触发", () => {
  const match = matchesCanvasIntent("给我建个项目看板");
  assert.equal(match.matched, true);
  assert.ok(match.signals.includes("看板"));
});

t("光杆强名词（短消息）也算请求", () => {
  assert.equal(matchesCanvasIntent("项目看板").matched, true);
  assert.equal(matchesCanvasIntent("看板").matched, true);
});

t("英文强名词：要的是「做」不是「看」", () => {
  assert.equal(matchesCanvasIntent("build me a dashboard").matched, true);
  assert.equal(matchesCanvasIntent("show me the dashboard").matched, false, "看一眼不是建一个");
});

t("提到既有画布时不再误触发（本会话真实踩过）", () => {
  const shouldFire = [
    "建个项目的看板", "给我建个项目看板", "项目看板", "做个看板",
    "整理一份工程现状审计报告", "build me a dashboard",
  ];
  const shouldStayQuiet = [
    "②③ 一起做（schema 三块 + 模板 + 本仓看板 + resume.md）",
    "把这张看板里的 T-3 标成完成",
    "看板里那条门禁红了，帮我看看",
    "这张画布的排版有点挤",
    "更新一下 board.canvas.tsx 的进度",
    "把这个 dashboard 的截图发我",
    "现有看板再加一列负责人",
    "今天的测试跑了吗",
    "show me the dashboard",
    "帮我修一个空指针",
  ];
  for (const text of shouldFire) assert.equal(matchesCanvasIntent(text).matched, true, "should fire: " + text);
  for (const text of shouldStayQuiet) assert.equal(matchesCanvasIntent(text).matched, false, "should stay quiet: " + text);
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

t("guidance 只带 7 问与指针，质量门槛留在 intake.md（单一事实来源）", () => {
  const text = buildCanvasIntakeGuidance(matchesCanvasIntent("建个看板"));
  for (const needle of ["意图入口", "7 条摆给用户", "references/intake.md", "constraints / decisions / nextAction"]) {
    assert.ok(text.includes(needle), "guidance is missing " + needle);
  }
  assert.ok(!text.includes("四、质量门槛"), "the gates must live in intake.md only, not in a second copy that drifts");
  assert.ok(text.length < 1000, "guidance grew to " + text.length + " chars");
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
