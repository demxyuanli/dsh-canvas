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

/**
 * Imperatives that ask for something to be BUILT. Deliberately excludes "帮我" /
 * "看一下" / "show me": those introduce a request for help with something that
 * already exists, which is not this entry point.
 */
const CREATE_VERBS = [
  "建", "创建", "新建", "做", "生成", "写", "弄", "搭", "来一个", "来个", "给我",
  "整理", "梳理", "汇总", "编制", "列一个",
  "create", "make", "build", "generate", "write", "add", "draft", "set up", "give me", "produce", "put together",
];

/** Signals that the message is talking about something that already exists. */
const EXISTING_MARKERS = [
  "这张", "这个", "这本", "该", "现有", "已有", "上面", "刚才", "那条", "那些",
  "里的", "里面", "其中", "本仓", "当前", "我们的",
];

/** A path or a filename: naming one means talking about a concrete, existing file. */
const PATH_LIKE = /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|\b[A-Za-z0-9_-]+\.(?:canvas\.tsx|md|ts|tsx|json|ya?ml)\b/i;

/**
 * How far in front of a noun a creation verb may sit and still govern it.
 *
 * Chinese is terse - the verb butts against its object ("做个看板") - so a tight
 * window is what keeps "一起做（…模板…本仓看板…）" out. English needs room for
 * articles and prepositions ("create a project canvas"), hence the second value.
 */
const GOVERN_WINDOW = 12;
const GOVERN_WINDOW_ASCII = 24;

/**
 * Does this text ask for a canvas-shaped artifact?
 * @param text - the user's own message text (see {@link userPlainText}).
 * @param extraKeywords - deployment-specific weak nouns from Config.
 * @returns { matched, signals, hasVerb }.
 */
export function matchesCanvasIntent(text, extraKeywords) {
  const raw = String(text === undefined || text === null ? "" : text);
  const hay = raw.toLowerCase();
  const lower = (list) => list.filter((noun) => typeof noun === "string" && noun !== "" && hay.includes(noun.toLowerCase()));
  const strong = lower(STRONG_NOUNS);
  const weak = Array.from(new Set(lower(WEAK_NOUNS).concat(lower(Array.isArray(extraKeywords) ? extraKeywords : []))));
  const signals = strong.concat(weak);
  if (signals.length === 0) return { matched: false, signals: [], hasVerb: false };

  const hasVerb = CREATE_VERBS.some((verb) => hay.includes(verb.toLowerCase()));
  const aboutExisting = EXISTING_MARKERS.some((marker) => hay.includes(marker.toLowerCase())) || PATH_LIKE.test(raw);

  // A creation verb has to sit in front of the noun it governs: "做个看板" is a
  // request; "一起做（…模板…本仓看板…）" is a discussion that happens to contain
  // both words. Proximity is what separates them, not the word list.
  const governed = signals.some((noun) => {
    const at = hay.indexOf(noun.toLowerCase());
    if (at < 0) return false;
    const window = /[\u4e00-\u9fff]/.test(noun) ? GOVERN_WINDOW : GOVERN_WINDOW_ASCII;
    const before = hay.slice(Math.max(0, at - window), at);
    return CREATE_VERBS.some((verb) => before.includes(verb.toLowerCase()));
  });

  // A bare strong noun is a real request in Chinese ("项目看板"), so a short
  // message with nothing referring to an existing canvas still fires.
  const bare = strong.length > 0 && !aboutExisting && raw.trim().length <= GOVERN_WINDOW;

  return { matched: governed || bare, signals, hasVerb };
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
 *
 * Carries only what has to happen NOW - the 7 questions that become the receipt
 * the user approves. The order of work and the quality gates live in
 * references/intake.md and are pointed at rather than copied: a second copy of a
 * contract drifts, and this one already had (the anchor block was added to
 * intake.md and not here).
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
    "三、口径确认后：canvas_new(path, kind) → 只填 export const DATA → canvas_check 自检 → 把文件路径与「人机怎么共用这份状态」告诉用户。",
    "",
    "产出顺序、质量门槛、以及必须写进 DATA 的锚点三块（constraints / decisions / nextAction），",
    "完整契约见 canvas skill 的 references/intake.md —— 动手写文件前先读它。",
    "套件 API 见 references/kit.md，范式见 references/patterns.md。",
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
