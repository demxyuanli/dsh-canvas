/** @canvas
 * title: Task board
 * description: 任务跟踪看板：加权进度 + 风险派生 + 分组待办 + 富字段详情 + 活动时间线
 * icon: board
 * hidden: true
 */
// 模板不是活画布：canvas_new 复制时会剥掉上面那行 hidden，新建的画布照常可见。
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
//   dependsOn                              -> 谁必须先完成（可省）
// 这张画布只保留"当前窗口"（在办 + 最近完成）；更早的历史属于另一个文件。
type Task = {
  id: string; lane: string; title: string; status: Status; priority: string;
  owner: string; progress: number; estimate: number; actual: number;
  startedAt: string; updatedAt: string; completedAt: string; blocker: string;
  goal: string; next: string; acceptance: string; evidence: string;
  write: string; ref: string; note: string;
  dependsOn?: readonly string[];
};

// 跟踪之外的三块"上下文锚点"：会话被截断、或换一个 agent 接手时，靠它们在一屏内
// 重建项目状态——既不用重读整份文件，也不会重开已经定过的事（见 canvas_read brief）。
//   constraints -> 红线：必须成立的前提，以及违反了会得到什么后果
//   decisions   -> 已定：选了什么、否了什么、为什么（防重新讨论）
//   nextAction  -> 全局唯一的下一个动作（每任务的 next 只是局部视角）
type Constraint = { rule: string; because: string; violation: string };
type Decision = { id: string; at: string; chose: string; rejected: readonly string[]; why: string; ref: string };
type NextAction = { taskId: string; action: string; why: string };

export const DATA = {
  goal: "把会话令牌迁移到 v2 契约，并保住旧客户端的兼容期",
  asOf: "2026-09-28",
  revision: "r12",
  wipLimit: 2,
  staleDays: 5,
  lanes: ["api", "ui", "infra"],
  // 红线：不是偏好，是必须成立的前提；violation 写"违反了会怎样"。
  constraints: [
    { rule: "v1 令牌在校验路径上必须继续可用", because: "旧客户端无法在本周期内升级", violation: "回滚：老用户全量 401" },
    { rule: "密钥轮换必须可中断", because: "线上已有两把活跃密钥", violation: "轮换中重启会造成双向失效" },
    { rule: "不新增对外接口，只改内部契约", because: "接口冻结窗口已关闭", violation: "版本冻结评审直接否决" },
  ],
  // 已定：写清"选了什么、否了什么、为什么"——这是防止截断后重新讨论的关键。
  decisions: [
    { id: "D1", at: "2026-09-20", chose: "双写 v2，v1 校验保留一个发布周期", rejected: ["一次性切换", "写两套校验器"], why: "一次性切换无法回滚", ref: "docs/adr-07.md" },
    { id: "D2", at: "2026-09-16", chose: "密钥轮换用重叠窗口", rejected: ["停机轮换"], why: "拿不到停机窗口", ref: "docs/rfc-12.md#4" },
    { id: "D3", at: "2026-09-05", chose: "v1 保留代码但不修已知边界问题", rejected: ["继续维护 v1"], why: "投入产出比不成立，边界问题 v2 已修", ref: "docs/adr-07.md" },
  ],
  // 全局唯一的下一个动作；每任务的 next 是局部视角，两者不互相替代。
  nextAction: { taskId: "T-02", action: "推动接口冻结，拿到校验路径的最终字段表", why: "T-02 是唯一压着 T-01 收尾的前置" },
  tasks: [
    {
      id: "T-01", lane: "api", title: "v2 令牌的签发与校验",
      status: "in_progress", priority: "P0", owner: "worker-a",
      progress: 60, estimate: 3, actual: 2,
      startedAt: "2026-09-22", updatedAt: "2026-09-27", completedAt: "", blocker: "",
      goal: "新旧两种令牌在一个发布周期内都能通过校验",
      next: "补齐 refresh 分支的过期判定",
      acceptance: "契约测试覆盖签发 / 校验 / 刷新三条路径",
      evidence: "test/api/session.test.ts:88", write: "src/api/session.ts",
      ref: "docs/rfc-12.md#3", note: "接口冻结后 T-02 才能开工",
    },
    {
      id: "T-02", lane: "ui", title: "登录流程接入新的会话状态机",
      status: "pending", priority: "P1", owner: "-",
      progress: 0, estimate: 2, actual: 0,
      startedAt: "", updatedAt: "2026-09-25", completedAt: "", blocker: "等待 T-01 冻结接口",
      dependsOn: ["T-01"],
      goal: "登录 / 登出 / 刷新三条路径都有明确的 UI 状态",
      next: "先按 T-01 的接口草案接状态机，接口冻结后复核",
      acceptance: "三条路径各有一次手动走查记录",
      evidence: "-", write: "src/ui/LoginFlow.tsx",
      ref: "docs/rfc-12.md#5", note: "被阻塞，但可先写不依赖接口的部分",
    },
    {
      id: "T-03", lane: "api", title: "identity 服务的契约对齐",
      status: "blocked", priority: "P0", owner: "worker-b",
      progress: 40, estimate: 5, actual: 4,
      startedAt: "2026-09-15", updatedAt: "2026-09-18", completedAt: "", blocker: "外部 identity 沙箱不可用，等平台组恢复",
      goal: "我们的校验结果与 identity 服务的返回逐字段一致",
      next: "先用契约桩推进单测，沙箱恢复后再跑一遍真实路径",
      acceptance: "契约测试与真实沙箱各跑一遍且都通过",
      evidence: "test/api/identity.contract.test.ts", write: "src/api/identity.ts",
      ref: "docs/rfc-12.md#4", note: "已升级到平台组，不要在本地绕沙箱",
    },
    {
      id: "T-04", lane: "infra", title: "CI 增加令牌单测门禁",
      status: "completed", priority: "P1", owner: "worker-a",
      progress: 100, estimate: 1, actual: 1,
      startedAt: "2026-09-10", updatedAt: "2026-09-12", completedAt: "2026-09-12", blocker: "",
      goal: "令牌相关单测在 CI 上必跑，红了就挡住合并",
      next: "-",
      acceptance: "CI 上有独立的令牌单测 job",
      evidence: "ci://run/4821", write: ".github/workflows/test.yml",
      ref: "docs/rfc-12.md#6", note: "已固化进配置",
    },
    {
      id: "T-05", lane: "ui", title: "错误文案集中到一张表",
      status: "pending", priority: "P2", owner: "-",
      progress: 0, estimate: 1, actual: 0,
      startedAt: "", updatedAt: "2026-09-20", completedAt: "", blocker: "",
      goal: "登录相关文案只有一个来源",
      next: "把散落的文案抽进 messages.ts",
      acceptance: "登录流程里没有内联文案",
      evidence: "-", write: "src/ui/messages.ts",
      ref: "-", note: "低优先，随时可做",
    },
    {
      id: "T-06", lane: "infra", title: "下线 v1 会话表",
      status: "cancelled", priority: "P2", owner: "-",
      progress: 0, estimate: 2, actual: 0,
      startedAt: "", updatedAt: "2026-09-05", completedAt: "", blocker: "",
      goal: "只记录为什么不做，避免下一轮重新讨论",
      next: "-",
      acceptance: "-",
      evidence: "-", write: "src/legacy/session-v1.ts",
      ref: "docs/adr-7.md", note: "v1 还要再留一个发布周期",
    },
  ],
  activity: [
    { id: "a1", at: "2026-09-27", title: "T-01 推进到 60%", tone: "info", detail: "签发路径完成，校验路径待补", ref: "src/api/session.ts:88" },
    { id: "a2", at: "2026-09-25", title: "T-02 转为待办", tone: "warning", detail: "接口未冻结，先记录阻塞原因", ref: "docs/rfc-12.md#5" },
    { id: "a3", at: "2026-09-18", title: "T-03 升级到平台组", tone: "danger", detail: "identity 沙箱仍不可用", ref: "docs/rfc-12.md#4" },
    { id: "a4", at: "2026-09-12", title: "T-04 完成并通过 CI", tone: "success", detail: "令牌单测进入必跑集合", ref: ".github/workflows/test.yml" },
    { id: "a5", at: "2026-09-05", title: "T-06 关闭", tone: "neutral", detail: "v1 再保留一个发布周期", ref: "docs/adr-07.md" },
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

  // nextAction 为 null 是明确表态「当前没有待办」；缺字段才是没写。两者在渲染上都要
  // 有东西可看，所以这里归一化成一个总能渲染的对象。
  const nextAction = DATA.nextAction ?? {
    taskId: "—",
    action: "没有待办：当前窗口内的条目都已关闭",
    why: "有新任务时补进 tasks，并把 nextAction 指过去",
  };

  const risks: string[] = [];
  if (blocked.length > 0) risks.push(blocked.length + " 条阻塞：" + blocked.map((task) => task.id).join("、"));
  if (wip.length > DATA.wipLimit) risks.push("在办 " + wip.length + " 条，超过 WIP 上限 " + DATA.wipLimit);
  if (stale.length > 0) risks.push(stale.length + " 条超过 " + DATA.staleDays + " 天未更新：" + stale.map((task) => task.id).join("、"));
  if (overrun.length > 0) risks.push(overrun.length + " 条实际已超出估算：" + overrun.map((task) => task.id).join("、"));
  // 锚点自检：截断后 agent 会先信这三块，所以它们指向的东西必须存在
  if (DATA.nextAction !== null && !tasks.some((task) => task.id === DATA.nextAction.taskId)) {
    risks.push("nextAction 指向不存在的任务：" + DATA.nextAction.taskId);
  }
  const premature = wip.filter((task) => (task.dependsOn ?? []).some((id) => {
    const dependency = tasks.find((candidate) => candidate.id === id);
    return dependency === undefined || dependency.status !== "completed";
  }));
  if (premature.length > 0) risks.push(premature.length + " 条在依赖未完成时已开工：" + premature.map((task) => task.id).join("、"));

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
        <H1>Task board</H1>
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
      <Callout tone={DATA.nextAction === null ? "success" : "info"} title={"现在该做：" + nextAction.action}>
        <Text size="small">
          对应 <Code>{nextAction.taskId}</Code>：{nextAction.why}
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
            筛选器与当前选中项只存在本机（<Code>useCanvasState</Code>），刷新后保留，agent 看不到。
          </Text>
          <Text size="small" tone="tertiary">
            这条画布只放当前窗口；已完成超过一个窗口的条目应移出，而不是把历史粘进来。
          </Text>
          <Text size="small">
            <Code>constraints</Code> / <Code>decisions</Code> / <Code>nextAction</Code> 是给"截断后接手"用的：
            换会话时先 <Code>canvas_read brief</Code> 一把拿全，不要重读整份文件，也不要重开已定的事。
          </Text>
        </Stack>
      </CollapsibleSection>

      <Text size="caption" tone="tertiary">
        快照 {DATA.asOf} · 修订 {DATA.revision} · 由 agent 更新，人只改状态。
      </Text>
    </Stack>
  );
}
