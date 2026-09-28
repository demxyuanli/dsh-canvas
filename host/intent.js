/**
 * Canvas intent entry.
 *
 * A user asking for "a board / 看板 / 画布 / 画板 / project canvas" is not asking
 * for prose: they want the project's audit and engineering situation organised
 * into a persistent, drillable, write-back-able surface. The harness event
 * `agent/pre-step` is where that reading gets attached to the step, so this
 * module owns the matcher, the intake contract, and the one listener.
 */

/** Nouns specific enough to fire without a creation verb. */
const STRONG_NOUNS = ["看板", "画布", "画板", "仪表盘", "驾驶舱", "kanban", "dashboard"];

/**
 * Nouns that only mean "make me a canvas" next to a creation verb: "board" is a
 * game, "canvas" is a web API, "项目文档" is often just a doc request.
 */
const WEAK_NOUNS = [
  "canvas", "board", "status board", "progress board", "tracking board", "review board",
  "项目文档", "工程文档", "项目面板", "项目进度", "项目现状", "工程现状", "工程情况",
  "审计报告", "复查报告", "评审报告", "现状分析", "进展报告",
];

/** Imperatives that turn a weak noun into a build request. */
const VERBS = [
  "建", "创建", "新建", "做", "生成", "写", "弄", "搭", "来一个", "来个", "给我", "帮我",
  "整理", "梳理", "汇总", "编制", "列一下", "看一下",
  "create", "make", "build", "generate", "write", "add", "draft", "set up", "give me", "produce", "put together",
];

/**
 * Does this text ask for a canvas-shaped artifact?
 * @param text - the user's own message text (see {@link userPlainText}).
 * @param extraKeywords - deployment-specific weak nouns from Config.
 * @returns { matched, signals, hasVerb }.
 */
export function matchesCanvasIntent(text, extraKeywords) {
  const hay = String(text === undefined || text === null ? "" : text).toLowerCase();
  const strong = [];
  for (const noun of STRONG_NOUNS) if (hay.includes(noun.toLowerCase())) strong.push(noun);
  const weak = [];
  for (const noun of WEAK_NOUNS) if (hay.includes(noun.toLowerCase())) weak.push(noun);
  for (const noun of Array.isArray(extraKeywords) ? extraKeywords : []) {
    if (typeof noun !== "string" || noun === "") continue;
    if (hay.includes(noun.toLowerCase())) weak.push(noun);
  }
  const hasVerb = VERBS.some((verb) => hay.includes(verb.toLowerCase()));
  return {
    matched: strong.length > 0 || (weak.length > 0 && hasVerb),
    signals: strong.concat(weak),
    hasVerb,
  };
}

/**
 * Request ids this plugin mints in \`startTurn\`. A canvas-submitted task is a
 * user-role message too, but it is a work hand-off, not a request to create a
 * canvas: re-injecting the intake on every "Start in chat" click is noise, and
 * worse it nudges the agent to re-run an intake for an already tracked task.
 * The source rpcId survives into the admitted message, so it is the reliable
 * signal - the text of the hand-off is free-form.
 */
const CANVAS_RPC_PREFIX = "canvas-";

/**
 * The batch's own words: only messages a human produced, never another plugin's
 * injected context (a goal-round prompt must not re-trigger the intake) and
 * never a task this plugin submitted itself.
 * @param messages - the step's user-role messages.
 * @returns the concatenated plain text, or "".
 */
export function userPlainText(messages) {
  const parts = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message === null || typeof message !== "object") continue;
    const source = message.source;
    if (source === undefined || source === null || source.kind !== "user") continue;
    if (typeof source.rpcId === "string" && source.rpcId.indexOf(CANVAS_RPC_PREFIX) === 0) continue;
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/**
 * The intake the model must put in front of the user before writing the file.
 * Deliberately self-contained: the entry point has to work on the first turn,
 * without a tool call to fetch a reference.
 * @param match - the {@link matchesCanvasIntent} result, for the signal line.
 * @returns the guidance text injected as a user-role context message.
 */
export function buildCanvasIntakeGuidance(match) {
  const signals = match !== null && match !== undefined && Array.isArray(match.signals) && match.signals.length > 0
    ? match.signals.slice(0, 4).join(" / ")
    : "canvas";
  return [
    "[dsh-canvas] 意图入口：这次要的是「用画布承载的审计与工程分析」，不是一篇散文。",
    "识别到的信号：" + signals + "。请先做下面的 intake 与用户对齐口径，再动手写文件。",
    "",
    "一、先把 intent 说清楚",
    "用户要建的是 .canvas.tsx：项目的审计结论与工程现状要被结构化、可下钻、可回写。",
    "直接产出一个只有标题和状态的薄看板，等于没有接住这个入口。",
    "",
    "二、intake（把这 7 条摆给用户，等他确认或改口径；用户已经说清楚的照抄即可）",
    "1. 这张画布要支撑的决定是什么（一句话目标）；",
    "2. 行的单位：任务 / 门禁 / 模块 / 迁移单元 / 轮次；",
    "3. 状态模型与分组：状态枚举、lane、谁认领；",
    "4. 每行必须具备的字段：状态、进度 + 估算与实际、开始/更新/完成日期、阻塞（在等谁）、下一步、验收条件、证据（文件:行 / 测试名 / 运行号）、改动位置、参考；",
    "5. 要派生的分析（一律从 DATA 现算，禁止手抄）：加权进度、WIP 超限、陈旧（快照日 − 更新日）、超估算、按分组的完成度、下一步 3 条、风险清单；",
    "6. 人要在面板上做的动作：标记进行中 / 完成 / 阻塞、认领、豁免、打开文件、把决定交回 agent；",
    "7. 更新与归档节奏：谁在什么时候更新 DATA；什么时候把条目移出当前窗口。",
    "",
    "三、产出顺序（不要跳步）",
    "intake 确认 → canvas_new(path, kind) → 只填 export const DATA → canvas_check 自检 → 把文件路径与「人机怎么共用这份状态」告诉用户。",
    "",
    "四、质量门槛（不满足就不算交付）",
    "- 只内联当前窗口（在办 + 最近完成），历史外置；",
    "- 每个数字都能追溯到 DATA 字段或真实运行输出，禁止手抄断言；",
    "- 结论性文字用引用（文件:行 / 见 T-3），不粘贴长段落；",
    "- 人的改动必须走 useCanvasOverlay（落 sidecar，agent 下一轮 canvas_read 可见）；",
    "- 明细表要有证据列；看板要有派生风险与「下一步」。",
    "",
    "完整契约见 canvas skill 的 references/intake.md；套件 API 见 references/kit.md，范式见 references/patterns.md。",
  ].join("\n");
}

/**
 * Build the `agent/pre-step` listener.
 *
 * Same shape as every other consumer of this waterfall: call `next()` first, and
 * only fold our message into an `enter` decision, so later listeners can still
 * reject or rewrite. Our own failure never breaks the step.
 * @param options - { getCreateUserMessage, keywords?, guide?, onError? }.
 * @returns an async (payload, next) => PreStepDecision.
 */
export function createCanvasIntentListener(options) {
  const settings = options === null || options === undefined ? {} : options;
  const guide = typeof settings.guide === "function" ? settings.guide : buildCanvasIntakeGuidance;
  return async function canvasIntentPreStep(payload, next) {
    const downstream = await next();
    try {
      if (downstream === null || downstream === undefined || downstream.kind !== "enter") return downstream;
      const batch = payload === null || payload === undefined ? [] : payload.messages;
      if (!Array.isArray(batch) || batch.length === 0) return downstream;
      const text = userPlainText(batch);
      if (text === "") return downstream;
      const match = matchesCanvasIntent(text, settings.keywords);
      if (!match.matched) return downstream;
      const createUserMessage = typeof settings.getCreateUserMessage === "function" ? await settings.getCreateUserMessage() : null;
      if (typeof createUserMessage !== "function") return downstream;
      const message = createUserMessage({
        content: [{ type: "text", text: guide(match) }],
        source: { kind: "dsh-canvas", form: "instructions" },
      });
      return Object.assign({}, downstream, { messages: downstream.messages.concat([message]) });
    } catch (error) {
      if (typeof settings.onError === "function") settings.onError(error);
      return downstream;
    }
  };
}
