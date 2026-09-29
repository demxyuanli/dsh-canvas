/** @canvas
 * title: @local/dsh-canvas 项目看板
 * description: 发布收口看板：真实环境验收 + 剩余缺口；进度与风险从 DATA 现算
 * icon: board
 */
import {
  H1, H2, Text, Code, Stack, Grid, Row, Divider, Card, CardBody, CardHeader,
  Callout, Stat, Table, TodoList, Pill, Button, Progress, KeyValue, Timeline,
  CollapsibleSection, useMemo, useCanvasState, useCanvasOverlay, useCanvasAction,
} from "dsh/canvas";

type Status = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

// 每个条目带的是"跟踪所需的字段"，不是只有标题与状态：
//   status / progress / estimate / actual  -> 到哪一步、还要多少
//   startedAt / updatedAt / completedAt    -> 停了多久、多久没动过
//   blocker / next / acceptance            -> 卡在哪、下一步、怎样算完成
//   evidence / write / ref                 -> 结论的证据、改动位置、参考
// 这张画布只保留"当前窗口"（在办 + 最近完成）；更早的历史属于另一个文件。
type Task = {
  id: string; lane: string; title: string; status: Status; priority: string;
  owner: string; progress: number; estimate: number; actual: number;
  startedAt: string; updatedAt: string; completedAt: string; blocker: string;
  goal: string; next: string; acceptance: string; evidence: string;
  write: string; ref: string; note: string;
};

export const DATA = {
  goal: "把 @local/dsh-canvas 推到可发布：真实环境验收 + 剩余缺口收口",
  asOf: "2026-09-29",
  revision: "r21",
  wipLimit: 2,
  staleDays: 7,
  lanes: ["verify", "host", "docs", "release"],
  // 红线：违反其中任何一条，插件或画布会以特定方式失效——写清后果，接手的人不需要猜。
  constraints: [
    { rule: "画布只能 import \"dsh/canvas\"", because: "编译管线在 sucrase 之前就拒掉其他模块", violation: "E_PARSE_IMPORT（import React 也归这条）" },
    { rule: "DATA 必须是纯字面量，不能有计算或引用", because: "host 用字面量抽取，不执行画布代码", violation: "E_DATA_NOT_LITERAL；canvas_read 与 overlay 全部失效" },
    { rule: "runCommand 只能跑 Config 白名单里的命令", because: "命令串只能从白名单选，不能拼接", violation: "unsupported，任意命令一律拒绝" },
    { rule: "人的状态改动必须走 overlay sidecar", because: "要保留谁改的、改了什么，并且能回写", violation: "直接改 DATA 会被 agent 下一轮写入覆盖" },
    { rule: "client 半边零依赖，只能 require(\"react\")", because: "浏览器半边不打包，由 dsh-app:// 直接提供", violation: "引入依赖会让画布 tab 起不来" },
  ],
  // 已定：包含被否决的方案。截断后先读这里，避免把定过的事重新讨论一遍。
  decisions: [
    { id: "D1", at: "2026-09-28", chose: "概览卡并排，承载句子的内容一律纵向", rejected: ["一律单列", "全部并排"], why: "右栏窄且可调宽，长内容分栏必然挤碎", ref: "skills/canvas/references/patterns.md" },
    { id: "D2", at: "2026-09-28", chose: "深色不另写 CSS，用 body[data-ds-dark-theme] 切 token", rejected: ["prefers-color-scheme 媒体查询", "维护第二套样式表"], why: "harness 的 light/dark 已在同一批主题表里", ref: "docs/preview/render.mjs" },
    { id: "D3", at: "2026-09-28", chose: "人的裁决落 overlay，由 canvas_state_merge 回写源文件", rejected: ["直接改 DATA", "另存一份状态文件"], why: "保留来源、可回滚，agent 下一轮可见", ref: "INTERFACE.md §3" },
    { id: "D4", at: "2026-09-29", chose: "desktop profile 按安装器产物复现安装（manifest + junction + pnpm）", rejected: ["改 profile 名绕过 CLI", "等官方开放 CLI"], why: "该 profile 由 Electron 应用独占，CLI 是硬编码拒绝，UI 才是官方入口", ref: "skills/canvas/references/troubleshooting.md" },
    { id: "D5", at: "2026-09-28", chose: "startTurn 用 mode=queue + AbortSignal", rejected: ["mode=steer", "省略 signal"], why: "契约必填 signal；队列语义不抢占当前轮", ref: "DESIGN.md §27" },
  ],
  // 全局唯一的下一个动作。每任务的 next 是局部视角，两者不互相替代。
  nextAction: { taskId: "V-04", action: "把 permission preset 调到 read-only，跑一条只读命令看 runCommand 的落点", why: "它是 V-05 的输入，而 V-05 是唯一阻塞发布的开放决策" },
  tasks: [
    {
      id: "V-01", lane: "verify", title: "重启后目视三张画布",
      status: "completed", priority: "P0", owner: "human",
      progress: 100, estimate: 1, actual: 0,
      startedAt: "2026-09-28", updatedAt: "2026-09-29", completedAt: "2026-09-29", blocker: "",
      goal: "确认套件在真实页面里渲染正确（含滚动、边距与排版修复）",
      next: "",
      acceptance: "三张画布都渲染；控制台无 slot entry crashed",
      evidence: "人眼：Desktop 打开 board.canvas.tsx 渲染为画布；进程 code cache 含 dsh-app://app/plugins/@local/dsh-canvas/client.js", write: "lib/client.js",
      ref: "DESIGN.md §25 §26", note: "host 与 client 两个半边都已在 Desktop 实测通过",
    },
    {
      id: "V-02", lane: "verify", title: "画布意图入口真实触发",
      status: "completed", priority: "P0", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "用户说「建个看板」时 host 注入 intake，而不是直接开写",
      next: "-",
      acceptance: "会话里出现 dsh-canvas 来源的 intake 指引",
      evidence: "host/intent.js:124 + 本会话", write: "host/intent.js",
      ref: "DESIGN.md §24", note: "这张画布就是这样被建出来的",
    },
    {
      id: "V-03", lane: "verify", title: "runCommand 在真实 ctx.shell 上跑通",
      status: "completed", priority: "P1", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "门禁按钮执行真实命令，并把 exitCode 带回面板",
      next: "-",
      acceptance: "面板 notify 显示真实 exit=0",
      evidence: "真实 host：gate:tests exit=0 / gate:templates exit=0", write: "cordis.patch.yml + gates.canvas.tsx",
      ref: "INTERFACE.md §4.1", note: "白名单登记在 profile patch；会话策略解得 danger-full-access",
    },
    {
      id: "V-05", lane: "verify", title: "无 Session 时 runCommand 的兜底",
      status: "pending", priority: "P2", owner: "-",
      progress: 0, estimate: 1, actual: 0,
      startedAt: "", updatedAt: "2026-09-28", completedAt: "", blocker: "",
      dependsOn: ["V-04"],
      goal: "没有调用方 Session 时，沙箱策略与工作区根应该怎么取",
      next: "裁决：拒绝执行（要求 session）还是显式回落；写进 INTERFACE §4.1",
      acceptance: "行为有明确文档与用例",
      evidence: "真实 host：无 session 时 windows-acl-run 拒绝", write: "index.js",
      ref: "INTERFACE.md §4.1", note: "面板总会带 sessionId，所以不影响按钮",
    },
    {
      id: "V-04", lane: "verify", title: "read-only 会话下的沙箱行为",
      status: "pending", priority: "P1", owner: "-",
      progress: 0, estimate: 1, actual: 0,
      startedAt: "", updatedAt: "2026-09-28", completedAt: "", blocker: "",
      goal: "read-only 会话里点 Run，命令以只读沙箱执行而不是被跳过",
      next: "把 permission preset 调到 read-only，跑一条只读命令",
      acceptance: "返回的 sandbox.mode 为 read-only",
      evidence: "-", write: "index.js:371",
      ref: "dsh-sandbox-policy", note: "审批与沙箱是两件事，这里只验沙箱",
    },
    {
      id: "F-01", lane: "host", title: "startTurn 的真实 prompt 形状",
      status: "completed", priority: "P1", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "画布上的「开始」必须真的把任务交给 agent",
      next: "-",
      acceptance: "serve 断言 mode=queue、传入 AbortSignal、content 原样",
      evidence: "test/serve.test.mjs + dsh-api-session-controller", write: "index.js",
      ref: "DESIGN.md §27", note: "原来漏了必填 mode 与 signal，prompt() 第一行就抛 TypeError",
    },
    {
      id: "F-02", lane: "host", title: "action 信封：客户端与 host 对不上",
      status: "completed", priority: "P0", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "四条 host 侧动作（startTurn / runCommand / overlaySet / overlayClear）真的到达 host",
      next: "-",
      acceptance: "客户端断言请求体为 { canvas, sessionId, action }；host 兼容扁平形状",
      evidence: "test/client.test.mjs + test/serve.test.mjs", write: "lib/client.js",
      ref: "DESIGN.md §28 + INTERFACE.md §3", note: "客户端平铺、host 读 body.action —— 四条动作此前全不可用",
    },
    {
      id: "F-03", lane: "host", title: "意图入口被画布自己的提交再次触发",
      status: "completed", priority: "P1", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "点「开始」提交的任务不应再被当成新的建板请求",
      next: "-",
      acceptance: "带 canvas-* rpcId 的 user 消息被 userPlainText 忽略",
      evidence: "test/intent.test.mjs（15 断言）", write: "host/intent.js",
      ref: "DESIGN.md §29", note: "source.rpcId 前缀是可靠信号，消息文本是自由格式",
    },
    {
      id: "H-01", lane: "host", title: "canvas_state_merge 的缩进边界",
      status: "completed", priority: "P2", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "往已有行插新字段时，缩进与逗号在任何排版下都合法",
      next: "-",
      acceptance: "合并后的 DATA 仍能被宽容解析器读回",
      evidence: "test/merge.test.mjs（13 断言）", write: "host/merge.js",
      ref: "DESIGN.md §23", note: "已覆盖 tab 缩进 / CRLF / 单行对象 / 无 id 行",
    },
    {
      id: "D-01", lane: "docs", title: "诊断码口径收敛",
      status: "completed", priority: "P2", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "W_UNKNOWN_PROP / W_DEPRECATED / E_REACT_IMPORT 三者归位",
      next: "-",
      acceptance: "文档与 CODES 不再互相矛盾",
      evidence: "troubleshooting.md + host/diagnostics.js + README.md", write: "skills/canvas/references/troubleshooting.md",
      ref: "DESIGN.md §21", note: "死引用已删；reserved 码不再写成会产出",
    },
    {
      id: "D-02", lane: "docs", title: "README 的已知限制与未验证项已过时",
      status: "completed", priority: "P2", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "README 反映 runCommand / intent hook / 滚动与排版都已完成",
      next: "-",
      acceptance: "不再有已实现却被列为未实现或未验证的条目",
      evidence: "README.md", write: "README.md",
      ref: "README.md", note: "P0 两个阻塞项标记为闭环；登记意图入口的启发式限制",
    },
    {
      id: "R-01", lane: "release", title: "发布准备：版本与文档一致性",
      status: "completed", priority: "P1", owner: "agent",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-28", updatedAt: "2026-09-28", completedAt: "2026-09-28", blocker: "",
      goal: "package.json 版本、四个工具、kit v1.1、intent hook 在四份文档里一致",
      next: "-",
      acceptance: "版本号与导出面一致，无悬挂引用",
      evidence: "package.json 0.2.0 + npm test（8 文件）", write: "package.json",
      ref: "INTERFACE.md §5", note: "补了 npm test 脚本；移除不存在的 client/ 目录",
    },
    {
      id: "R-02", lane: "release", title: "P5：把 _board.md 迁成画布",
      status: "cancelled", priority: "P2", owner: "-",
      progress: 0, estimate: 2, actual: 0,
      startedAt: "", updatedAt: "2026-09-28", completedAt: "", blocker: "",
      goal: "只记录为何不做，避免下一轮重新讨论",
      next: "-",
      acceptance: "-",
      evidence: "-", write: "board.canvas.tsx",
      ref: "DESIGN.md §17 P5", note: "这张画布已经是那张看板；本仓没有 _board.md",
    },
  ],
  activity: [
    { id: "a1", at: "2026-09-28", title: "意图入口在真实会话里触发", tone: "success", detail: "用户发「给我建个项目看板」→ host 注入 intake", ref: "host/intent.js" },
    { id: "a2", at: "2026-09-28", title: "画布 tab 拿到滚动容器与边距", tone: "success", detail: "tabBody 会裁剪，改由 tab body 自己滚", ref: "lib/client.js" },
    { id: "a3", at: "2026-09-28", title: "排版映射到 harness 刻度", tone: "success", detail: "13px 基线；--dsw-font-mono 不存在，改用 --ds-font-family-code", ref: "lib/client.js" },
    { id: "a4", at: "2026-09-28", title: "runCommand 与 canvas_state_merge 落地", tone: "success", detail: "四个模型工具；白名单执行 + 最小字段合并", ref: "index.js" },
    { id: "a5", at: "2026-09-28", title: "全量测试 94 断言 / 8 个文件", tone: "info", detail: "4 个画布 canvas_check 0 诊断", ref: "test/" },
    { id: "a6", at: "2026-09-28", title: "merge 排版边界收口", tone: "success", detail: "tab 缩进 / CRLF / 单行对象 / 无 id 行各一条断言", ref: "test/merge.test.mjs" },
    { id: "a7", at: "2026-09-28", title: "诊断码口径收敛", tone: "success", detail: "E_REACT_IMPORT 删除；reserved 码不再写成会产出", ref: "troubleshooting.md" },
    { id: "a8", at: "2026-09-28", title: "README 限制与未验证项更新", tone: "success", detail: "P0 两个阻塞项闭环；登记意图入口的启发式限制", ref: "README.md" },
    { id: "a9", at: "2026-09-28", title: "版本 0.2.0 + npm test", tone: "success", detail: "8 个测试文件；移除不存在的 client/ 目录", ref: "package.json" },
    { id: "a10", at: "2026-09-28", title: "「开始」按钮点了没反应", tone: "danger", detail: "startTurn 漏了必填 mode 与 AbortSignal，prompt() 抛 TypeError", ref: "index.js" },
    { id: "a11", at: "2026-09-28", title: "startTurn 按契约补齐并加成功反馈", tone: "success", detail: "mode=queue + signal；成功也弹一条 info 通知", ref: "DESIGN.md §27" },
    { id: "a12", at: "2026-09-28", title: "点击报 unsupported action undefined", tone: "danger", detail: "客户端把 action 平铺进 body，host 读的是 body.action", ref: "lib/client.js" },
    { id: "a13", at: "2026-09-28", title: "action 信封两端对齐 + host 兼容扁平形状", tone: "success", detail: "四条 host 动作恢复；接缝补上双向断言", ref: "DESIGN.md §28" },
    { id: "a14", at: "2026-09-28", title: "runCommand 在真实 ctx.shell 上 exit=0", tone: "success", detail: "profile 登记 gate:tests / gate:templates；新建 gates.canvas.tsx", ref: "cordis.patch.yml" },
    { id: "a15", at: "2026-09-28", title: "意图入口不再被任务提交触发", tone: "success", detail: "按 source.rpcId 的 canvas-* 前缀过滤", ref: "host/intent.js" },
    { id: "a16", at: "2026-09-28", title: "画布改为单列纵向排列", tone: "success", detail: "模板 / 本仓画布 / patterns 与 kit 约定同步；不再左右分栏", ref: "skills/canvas/references/patterns.md" },
    { id: "a17", at: "2026-09-29", title: "插件在 DSH Desktop 上激活", tone: "success", detail: "装入 desktop profile 后重启：host 半边 200，四个工具可用，门禁 exit=0", ref: "profiles/desktop/package.json" },
    { id: "a18", at: "2026-09-29", title: "client 半边确认渲染", tone: "success", detail: "board.canvas.tsx 在 Desktop 打开为画布；client bundle 走 dsh-app://app/plugins/<pkg>/client.js，不经 HTTP", ref: "skills/canvas/references/troubleshooting.md" },
    { id: "a19", at: "2026-09-29", title: "画布加入上下文锚点", tone: "success", detail: "constraints / decisions / nextAction / dependsOn：模板、本仓看板、resume.md、canvas_read brief", ref: "skills/canvas/references/resume.md" },
  ],
} as const;

const STATUS_TONE: Record<string, Tone> = {
  pending: "neutral",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待办",
  in_progress: "进行中",
  blocked: "阻塞",
  completed: "完成",
  cancelled: "取消",
};

const PRIORITY_TONE: Record<string, Tone> = { P0: "danger", P1: "warning", P2: "neutral" };

const DAY_MS = 86400000;

function statusOf(row: { status?: string }): Status {
  const s = row.status;
  return s === "pending" || s === "in_progress" || s === "blocked" || s === "completed" || s === "cancelled" ? s : "pending";
}

function isOpen(task: Task): boolean {
  return task.status === "pending" || task.status === "in_progress" || task.status === "blocked";
}

function progressOf(task: Task): number {
  return task.status === "completed" ? 100 : task.progress;
}

function priorityRank(priority: string): number {
  return priority === "P0" ? 0 : priority === "P1" ? 1 : 2;
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

export default function TaskBoard() {
  const dispatch = useCanvasAction();
  // 筛选器与当前选中项是纯 UI 态：agent 不需要知道，刷新后保留即可。
  const [filter, setFilter] = useCanvasState<string>("filter", "open");
  const [activeId, setActiveId] = useCanvasState<string>("active", "T-01");
  // 人的状态改动必须走 overlay：它落在 sidecar 里，agent 下一轮 canvas_read 就能看到。
  const overlay = useCanvasOverlay("tasks", DATA.tasks);

  const tasks = useMemo(
    () => overlay.items.map((row) => ({ ...row, status: statusOf(row) })),
    [overlay.items],
  );

  // —— 派生分析：所有数字都从 DATA 现算，不手抄结论 ————————————————
  const open = tasks.filter(isOpen);
  const closed = tasks.filter((task) => !isOpen(task));
  const wip = tasks.filter((task) => task.status === "in_progress");
  const blocked = tasks.filter((task) => task.status === "blocked" || (task.blocker !== "" && isOpen(task)));
  const done = tasks.filter((task) => task.status === "completed");
  const counted = tasks.filter((task) => task.status !== "cancelled");
  const estTotal = counted.reduce((sum, task) => sum + task.estimate, 0);
  const weighted = counted.reduce((sum, task) => sum + task.estimate * progressOf(task), 0);
  const progressPct = estTotal === 0 ? 0 : Math.round(weighted / estTotal);
  const overrun = counted.filter((task) => task.actual > task.estimate);
  const stale = open.filter((task) => {
    const age = daysBetween(task.updatedAt, DATA.asOf);
    return age !== null && age > DATA.staleDays;
  });
  const recentDone = done.filter((task) => {
    const age = task.completedAt === "" ? null : daysBetween(task.completedAt, DATA.asOf);
    return age !== null && age <= 7;
  });

  const risks: string[] = [];
  if (blocked.length > 0) risks.push(blocked.length + " 条阻塞：" + blocked.map((task) => task.id).join("、"));
  if (wip.length > DATA.wipLimit) risks.push("在办 " + wip.length + " 条，超过 WIP 上限 " + DATA.wipLimit);
  if (stale.length > 0) risks.push(stale.length + " 条超过 " + DATA.staleDays + " 天未更新：" + stale.map((task) => task.id).join("、"));
  if (overrun.length > 0) risks.push(overrun.length + " 条实际已超出估算：" + overrun.map((task) => task.id).join("、"));

  const nextUp = open
    .slice()
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 3);

  const visible =
    filter === "all" ? tasks
      : filter === "closed" ? closed
        : filter === "blocked" ? blocked
          : filter === "open" ? open
            : tasks.filter((task) => task.lane === filter);

  const active = tasks.find((task) => task.id === activeId) ?? nextUp[0] ?? tasks[0];
  const activeAge = active === undefined ? null : daysBetween(active.updatedAt, DATA.asOf);

  const startTurn = (task: Task) => dispatch({
    type: "startTurn",
    prompt:
      "处理 " + task.id + "：" + task.title +
      "\n目标：" + task.goal +
      "\n验收：" + task.acceptance +
      "\n改动位置：" + task.write +
      "\n证据：" + task.evidence +
      "\n参考：" + task.ref +
      "\n当前：" + STATUS_LABEL[task.status] + "，进度 " + progressOf(task) + "%，估算 " + task.estimate + " 人日 / 已用 " + task.actual + " 人日" +
      "\n阻塞：" + (task.blocker === "" ? "无" : task.blocker) +
      "\n下一步：" + task.next +
      "\n只改与本任务相关的代码；完成后更新这张画布的 DATA（进度、更新日期、证据）。",
  });

  return (
    <Stack gap={24}>
      <Stack gap={10}>
        <H1>@local/dsh-canvas 项目看板</H1>
        <Text tone="secondary">{DATA.goal}</Text>
        <Text size="caption" tone="tertiary">
          快照 {DATA.asOf} · 修订 {DATA.revision} · 快照前 7 天完成 {recentDone.length} 条 · WIP 上限 {DATA.wipLimit}
        </Text>
        <Progress
          value={progressPct}
          showValue
          label={"加权进度（按估算人日，计入 " + counted.length + " 条）"}
          tone={progressPct >= 70 ? "success" : progressPct >= 35 ? "info" : "warning"}
        />
      </Stack>

      {/* 概览卡只有「一个数字 + 一句标签」，允许并排；auto-fit 让窄栏自动折成 2 列 */}
      <Grid columns="repeat(auto-fit, minmax(120px, 1fr))" gap={12}>
        <Stat value={tasks.length} label="跟踪中" hint={"在办 " + open.length + " · 关闭 " + closed.length} />
        <Stat value={wip.length + "/" + DATA.wipLimit} label="在办 / WIP 上限" tone={wip.length > DATA.wipLimit ? "danger" : "info"} />
        <Stat
          value={blocked.length}
          label="阻塞"
          tone={blocked.length > 0 ? "danger" : "neutral"}
          hint={blocked.length > 0 ? blocked.map((task) => task.id).join("、") : "无"}
        />
        <Stat value={progressPct + "%"} label="加权进度" tone={progressPct >= 70 ? "success" : "warning"} hint={Math.round(weighted / 100) + " / " + estTotal + " 人日"} />
      </Grid>

      {risks.length === 0 ? (
        <Callout tone="success" title="没有需要立即处理的风险">
          <Text size="small">无阻塞、无超期未更新、WIP 未超限、无超估算。</Text>
        </Callout>
      ) : (
        <Callout tone={blocked.length > 0 ? "danger" : "warning"} title={risks.length + " 项需要处理"}>
          <Stack gap={4}>
            {risks.map((risk) => <Text key={risk} size="small">{risk}</Text>)}
          </Stack>
        </Callout>
      )}

      {/* 全局唯一的下一个动作：截断后第一眼要看到的就是它 */}
      <Callout tone="info" title={"现在该做：" + DATA.nextAction.action}>
        <Text size="small">
          对应 <Code>{DATA.nextAction.taskId}</Code>：{DATA.nextAction.why}
        </Text>
      </Callout>

      <Row gap={8} wrap>
        <Pill active={filter === "open"} onClick={() => setFilter("open")}>在办 {open.length}</Pill>
        <Pill active={filter === "blocked"} onClick={() => setFilter("blocked")}>阻塞 {blocked.length}</Pill>
        <Pill active={filter === "closed"} onClick={() => setFilter("closed")}>已关闭 {closed.length}</Pill>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>全部 {tasks.length}</Pill>
        <Divider orientation="vertical" />
        {DATA.lanes.map((lane) => (
          <Pill key={lane} active={filter === lane} onClick={() => setFilter(lane)}>{lane}</Pill>
        ))}
      </Row>

      <Stack gap={20}>
        <Stack gap={12}>
          <H2>待办</H2>
          {DATA.lanes.map((lane) => {
            const laneRows = visible.filter((task) => task.lane === lane);
            if (laneRows.length === 0) return null;
            const laneOpen = laneRows.filter(isOpen);
            const laneCounted = laneRows.filter((task) => task.status !== "cancelled");
            const laneEst = laneCounted.reduce((sum, task) => sum + task.estimate, 0);
            const laneWeighted = laneCounted.reduce((sum, task) => sum + task.estimate * progressOf(task), 0);
            const lanePct = laneEst === 0 ? 0 : Math.round(laneWeighted / laneEst);
            const laneBlocked = laneRows.some((task) => task.status === "blocked");
            return (
              <CollapsibleSection
                key={lane}
                title={lane}
                count={laneRows.length}
                defaultOpen
                trailing={<Text size="caption" tone="tertiary">{laneOpen.length} 在办 · {lanePct}%</Text>}
              >
                <Stack gap={8}>
                  <Progress value={lanePct} size="sm" tone={laneBlocked ? "danger" : "info"} />
                  <TodoList
                    todos={laneRows.map((task) => ({ id: task.id, status: task.status, content: task.priority + " · " + task.title }))}
                    onTodoClick={(todo) => setActiveId(todo.id)}
                  />
                </Stack>
              </CollapsibleSection>
            );
          })}
          <CollapsibleSection
            title="已关闭"
            count={closed.length}
            trailing={<Text size="caption" tone="tertiary">历史不进默认视图</Text>}
          >
            <TodoList
              dense
              todos={closed.map((task) => ({ id: task.id, status: task.status, content: task.title }))}
              onTodoClick={(todo) => setActiveId(todo.id)}
            />
          </CollapsibleSection>
        </Stack>

        {active ? (
          <Card>
            <CardHeader trailing={<Pill size="sm" tone={STATUS_TONE[active.status]}>{STATUS_LABEL[active.status]}</Pill>}>
              {active.id + " · " + active.priority}
            </CardHeader>
            <CardBody>
              <Stack gap={12}>
                <Text weight="semibold">{active.title}</Text>
                <Progress
                  value={progressOf(active)}
                  size="sm"
                  showValue
                  label={"进度 · 已用 " + active.actual + " / 估算 " + active.estimate + " 人日"}
                  tone={STATUS_TONE[active.status] === "neutral" ? "info" : STATUS_TONE[active.status]}
                />
                <KeyValue
                  dense
                  items={[
                    { label: "负责人", value: active.owner === "-" ? "未认领" : active.owner },
                    { label: "分组", value: active.lane },
                    { label: "开始", value: active.startedAt === "" ? "—" : active.startedAt },
                    { label: "最近更新", value: active.updatedAt + (activeAge === null ? "" : "（" + activeAge + " 天前）") },
                    { label: "目标", value: active.goal },
                    { label: "验收", value: active.acceptance },
                    { label: "下一步", value: active.next, tone: "info" },
                    { label: "阻塞", value: active.blocker === "" ? "无" : active.blocker, tone: active.blocker === "" ? "neutral" : "danger" },
                    { label: "证据", value: <Code>{active.evidence}</Code> },
                    { label: "改动", value: <Code>{active.write}</Code> },
                    { label: "参考", value: <Code>{active.ref}</Code> },
                    { label: "依赖", value: (active.dependsOn ?? []).length === 0 ? "无" : (active.dependsOn ?? []).join("、"), tone: "warning" },
                    { label: "备注", value: active.note },
                  ]}
                />
                <Divider />
                <Row gap={8} wrap>
                  <Button variant="primary" onClick={() => startTurn(active)}>在会话里开始</Button>
                  <Button disabled={active.status === "in_progress"} onClick={() => overlay.set(active.id, { status: "in_progress" })}>标记进行中</Button>
                  <Button disabled={active.status === "completed"} onClick={() => overlay.set(active.id, { status: "completed" })}>标记完成</Button>
                  <Button disabled={active.status === "blocked"} onClick={() => overlay.set(active.id, { status: "blocked" })}>标记阻塞</Button>
                  <Button variant="ghost" onClick={() => overlay.clear(active.id)}>恢复源数据</Button>
                  <Button variant="ghost" onClick={() => dispatch({ type: "openFile", path: active.write })}>打开文件</Button>
                </Row>
                <Text size="caption" tone="tertiary">
                  人的状态改动落进 sidecar，agent 下一轮用 canvas_read 就能看到。
                </Text>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
      </Stack>

      <H2>下一步</H2>
      <Stack gap={12}>
        {nextUp.map((task) => (
          <Card key={task.id}>
            <CardHeader trailing={<Pill size="sm" tone={PRIORITY_TONE[task.priority]}>{task.priority}</Pill>}>
              {task.id}
            </CardHeader>
            <CardBody>
              <Stack gap={8}>
                <Text size="small" weight="semibold">{task.title}</Text>
                <Text size="caption" tone="secondary">{task.next}</Text>
                <Row gap={6} wrap>
                  <Button size="sm" variant="primary" onClick={() => startTurn(task)}>开始</Button>
                  <Button size="sm" variant="ghost" onClick={() => setActiveId(task.id)}>看详情</Button>
                  {task.blocker === "" ? null : <Pill size="sm" tone="danger">阻塞</Pill>}
                  {(task.dependsOn ?? []).length === 0 ? null : <Text size="caption" tone="warning">{"依赖 " + (task.dependsOn ?? []).join("、")}</Text>}
                </Row>
              </Stack>
            </CardBody>
          </Card>
        ))}
      </Stack>

      <H2>明细</H2>
      <Table
        headers={["ID", "优先", "分组", "标题", "状态", "负责人", "进度", "更新"]}
        columnAlign={["left", "left", "left", "left", "left", "left", "right", "right"]}
        striped
        stickyHeader
        emptyText="没有符合当前筛选的条目"
        onRowClick={(index) => {
          const row = visible[index];
          if (row !== undefined) setActiveId(row.id);
        }}
        rows={visible.map((task) => [
          <Code>{task.id}</Code>,
          <Pill size="sm" tone={PRIORITY_TONE[task.priority]}>{task.priority}</Pill>,
          task.lane,
          task.title,
          <Pill size="sm" tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Pill>,
          task.owner === "-" ? "未认领" : task.owner,
          <Progress value={progressOf(task)} size="sm" showValue tone={STATUS_TONE[task.status] === "neutral" ? "info" : STATUS_TONE[task.status]} />,
          task.updatedAt,
        ])}
        rowTone={visible.map((task) => task.status === "blocked" ? "danger" : task.status === "completed" ? "success" : "neutral")}
      />

      {/* 上下文锚点：截断或换人接手时先读这两节，避免重开已经定过的事 */}
      <CollapsibleSection title="约束与红线" count={DATA.constraints.length}>
        <Table
          headers={["规则", "为什么", "违反了会怎样"]}
          rows={DATA.constraints.map((item) => [item.rule, item.because, item.violation])}
          emptyText="没有登记红线"
        />
      </CollapsibleSection>

      <CollapsibleSection title="已定决策" count={DATA.decisions.length}>
        <Table
          headers={["决策", "选了", "已否决", "理由", "参考"]}
          rows={DATA.decisions.map((item) => [
            <Code>{item.id}</Code>,
            item.chose,
            item.rejected.join("、"),
            item.why,
            <Code>{item.ref}</Code>,
          ])}
          emptyText="没有登记决策"
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="活动"
        count={DATA.activity.length}
        defaultOpen
        trailing={<Text size="caption" tone="tertiary">只留最近 {DATA.activity.length} 条；更早的看提交历史</Text>}
      >
        <Timeline
          events={DATA.activity.map((event) => ({
            id: event.id,
            at: event.at,
            title: event.title,
            tone: event.tone,
            detail: event.detail,
            ref: event.ref,
          }))}
        />
      </CollapsibleSection>

      <CollapsibleSection title="怎么维护这张画布">
        <Stack gap={6}>
          <Text size="small">
            <Code>DATA</Code> 是 agent 写的数据快照：统计、进度、风险都从它现算，不要手抄结论。
          </Text>
          <Text size="small">
            人的状态改动走画布上的按钮，落进 sidecar（<Code>canvas_read</Code> 可见）；确认后由 agent 固化回 <Code>DATA</Code>。
          </Text>
          <Text size="small">
            <Code>constraints</Code> / <Code>decisions</Code> / <Code>nextAction</Code> 是给"截断后接手"用的：
            换会话时先 <Code>canvas_read brief</Code> 一把拿全，不要重读整份文件，也不要重开已定的事。
          </Text>
          <Text size="small">
            筛选器与当前选中项只存在本机（<Code>useCanvasState</Code>），刷新后保留，agent 看不到。
          </Text>
          <Text size="small" tone="tertiary">
            这条画布只放当前窗口；已完成超过一个窗口的条目应移出，而不是把历史粘进来。
          </Text>
        </Stack>
      </CollapsibleSection>

      <Text size="caption" tone="tertiary">
        快照 {DATA.asOf} · 修订 {DATA.revision} · 由 agent 更新，人只改状态。
      </Text>
    </Stack>
  );
}
