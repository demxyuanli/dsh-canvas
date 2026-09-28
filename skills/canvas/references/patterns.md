# 画布范式

四类覆盖绝大多数需求的画布。**先套范式，再谈自定义**：套范式写出来的画布很短，自定义渲染往往只是把复杂度从数据搬进了 UI。

| 范式 | 回答的问题 | 模板 |
|---|---|---|
| 看板 board | "这一批任务各自到哪一步了？" | [../templates/board.canvas.tsx](../templates/board.canvas.tsx) |
| 门禁 gates | "基线对齐了没有？哪条红了？" | [../templates/gates.canvas.tsx](../templates/gates.canvas.tsx) |
| 时间线 timeline | "这几轮/这几天分别推进了什么？" | 无独立模板，用 Table + 分组 |
| 对比 comparison | "我们这个和参考差在哪、差多少？" | 无独立模板，用 Table + BarChart |

四类共用的骨架顺序都是：**标题 → Stat 概览 → 约束/风险 Callout → 筛选 → 主体 → 明细**。顺序不要乱：人第一眼要看到"总量与红点"，最后才看细节。

---

## 1. 看板 board

**用途**：把一批条目（任务、工单、迁移单元）按状态/分组盯住，并支持点开某条做决定。

**结构**

~~~text
H1 + Text(目标一句话)
Grid columns=3        -> Stat 总数 / 进行中 / 阻塞
Callout (可选)         -> 不可违反的约束
Row wrap              -> Pill 筛选（open / all / 按分组）
Grid 1.1fr : 0.9fr
  左: CollapsibleSection(每个分组) -> TodoList(该组条目)
  右: Card 详情（字段 + 状态 Pill + 动作按钮）
Table (可选)          -> 数值明细，数字列右对齐
~~~

**关键片段：筛选 + 选中 + 人的状态改动**

~~~tsx
const dispatch = useCanvasAction();
const [filter, setFilter] = useCanvasState("filter", "open");
const [activeId, setActiveId] = useCanvasState("active", "T-01");
const overlay = useCanvasOverlay("tasks", DATA.tasks);   // 人的改动，agent 可见

const merged = useMemo(
  () => overlay.items.map((t) => ({ ...t, status: (t.status ?? "pending") })),
  [overlay.items],
);
const open = merged.filter((t) => t.status === "pending" || t.status === "in_progress");
const visible = filter === "open" ? open : merged;
const active = merged.find((t) => t.id === activeId) ?? open[0];
~~~

**关键片段：按钮把决定权交回 agent**

~~~tsx
<Button
  variant="primary"
  onClick={() => dispatch({
    type: "startTurn",
    prompt: "处理 " + active.id + "：" + active.title +
            "\n目标：" + active.goal +
            "\n遵守项目门禁；不要改共享管线以外的东西。",
  })}
>
  Start in chat
</Button>
<Button onClick={() => overlay.set(active.id, { status: "in_progress" })}>Mark active</Button>
<Button variant="ghost" onClick={() => overlay.set(active.id, { status: "completed" })}>Mark done</Button>
<Button variant="ghost" onClick={() => dispatch({ type: "openFile", path: active.write })}>Open file</Button>
~~~

**注意事项**

- **状态一定要走 `useCanvasOverlay`**：人要能用面板改状态，而你下一轮必须看得见。放 `useCanvasState` 等于人白点。
- 分组（`lane` / `bucket`）用 `CollapsibleSection` 包一组 `TodoList`，而不是一个巨大的扁平列表。
- 详情卡里字段不要超过 6 行；更长的说明留一个 `note` 引用（文件:行 或"见 t323"）。
- 内联只留"当前窗口"：未完成 + 最近完成。归档进折叠区或另一张画布。

---

## 2. 门禁 gates

**用途**：盯一组**可复现的检查**（测试、对拍、基线）的通过情况，并让人能当场重跑。

**结构**

~~~text
H1 + Text(基线是什么、怎么复现)
Grid columns=3        -> Stat 通过 / 失败 / 未跑
Callout danger        -> 失败清单（有失败时才渲染）
Table                 -> Gate | 基线 | 最近 | Δ | 状态 | 操作(每行一个 Run 按钮)
Row                   -> Run all 按钮 + 最近一次运行时间
CollapsibleSection    -> 如何在 Config 里登记白名单
~~~

**关键片段：每行一个重跑按钮**

~~~tsx
<Table
  headers={["Gate", "基线", "最近", "Δ", "状态", "操作"]}
  columnAlign={["left", "left", "left", "right", "left", "left"]}
  rows={DATA.gates.map((g) => [
    <Code>{g.id}</Code>,
    g.baseline,
    g.last,
    g.baseline === g.last ? "0" : "changed",
    <Pill size="sm" tone={g.ok ? "success" : "danger"}>{g.ok ? "pass" : "fail"}</Pill>,
    <Button size="sm" onClick={() => run(g)}>Run</Button>,
  ])}
  rowTone={DATA.gates.map((g) => (g.ok ? "success" : "danger"))}
/>
~~~

~~~tsx
async function run(g) {
  const r = await dispatch({ type: "runCommand", id: g.runId });
  if (!r.ok) {
    await dispatch({ type: "notify", tone: "warning", message: g.id + " 未执行：" + r.message });
  }
}
~~~

**关键片段：人工确认走 overlay**

~~~tsx
// 门禁结果来自 harness；人只对"我知道这条红着但先接受"负责
const acks = useCanvasOverlay("gates", DATA.gates);
<Pill
  tone={acks.get(g.id)?.acked ? "neutral" : g.ok ? "success" : "danger"}
  onClick={() => acks.set(g.id, { acked: true })}
>
  {acks.get(g.id)?.acked ? "acked" : g.ok ? "pass" : "fail"}
</Pill>
~~~

**注意事项**

- **`runCommand` 默认全拒**：`id` 必须先在插件 Config 的 `commandWhitelist` 里登记，且逐字匹配。被拒返回 `{ ok: false, code: "denied" }`——要在画布上显示"需登记 / 需提权"，不要静默失败。
- **结果不要手抄进 `DATA`**：`baseline` / `last` 是运行产物。画布只负责**显示与触发**；数字由 harness 写回（`canvas_state_merge` 或 agent 改 DATA）。手抄就是伪造证据。
- `基线 vs 最近` 两列都要有：只有一列"通过"的话，人看不出是不是回落了。
- 颜色只用 tone：`success` 通过、`danger` 失败、`neutral` 未跑 / 已接受、`warning` 抖动。

---

## 3. 时间线 timeline

**用途**：按时间/轮次看推进过程，回答"这几轮分别做了什么、什么时候停的"。

v1 没有专用时间线组件——用 `Table` + 分组实现，效果一样且更省事。

**结构**

~~~text
H1 + Text(时间范围)
Grid columns=3        -> Stat 本轮 / 累计 / 停滞天数
BarChart (可选)        -> 每天/每轮的事件计数
CollapsibleSection(每天/每轮, defaultOpen=最近一个)
   Table              -> 时间 | 事件 | 状态 | 证据
~~~

**关键片段：倒序 + 分组**

~~~tsx
const groups = useMemo(() => {
  const by = new Map();
  for (const e of DATA.events) {
    if (!by.has(e.day)) by.set(e.day, []);
    by.get(e.day).push(e);
  }
  return Array.from(by.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)); // 新的在前
}, []);

groups.map(([day, events]) => (
  <CollapsibleSection key={day} title={day} count={events.length} defaultOpen={day === groups[0][0]}>
    <Table
      headers={["时间", "事件", "状态", "证据"]}
      columnAlign={["left", "left", "left", "left"]}
      rows={events.map((e) => [
        e.at,
        e.title,
        <Pill size="sm" tone={e.ok ? "success" : "warning"}>{e.ok ? "done" : "partial"}</Pill>,
        <Code>{e.ref}</Code>,
      ])}
      rowTone={events.map((e) => (e.ok ? "success" : "warning"))}
    />
  </CollapsibleSection>
))
~~~

**注意事项**

- **日期是数据，不是现场取的**：`DATA` 里写字符串字面量（`"2026-09-21"`）。画布里没有定时器，也不该有"当前时间"这种会漂的状态。
- `new Date()` 只在渲染期做分组/排序时用（`DATA` 内禁止函数调用）。
- 只显示"最近 N 条 / 最近 N 天"，更早的进折叠区或另一个画布——时间线最容易无限膨胀。
- 时间线的价值在**证据列**：每条都该指向可核对的文件、日志或提交，而不是一句结论。

---

## 4. 对比 comparison

**用途**：把"我们的结果"和"参考结果"逐项摆在一起，让人一眼看到差在哪、差多少。

**结构**

~~~text
H1 + Text(参考是什么、口径是什么)
BarChart              -> 分组柱：ours vs reference（缺失值不要用 0 冒充）
Table                 -> 项 | ours | ref | Δ | 结论
Callout (可选)         -> 最大的差异点与下一步
~~~

**关键片段：Δ 与方向色**

~~~tsx
const rows = DATA.models.map((m) => {
  const hasRef = m.ref !== null;
  const delta = hasRef ? m.ours - m.ref : null;
  return {
    ...m,
    hasRef,
    delta,
    tone: !hasRef ? "neutral" : delta === 0 ? "success" : delta > 0 ? "warning" : "danger",
  };
});

<Table
  headers={["项", "ours", "ref", "Δ", "结论"]}
  columnAlign={["left", "right", "right", "right", "left"]}
  striped
  rows={rows.map((r) => [
    r.name,
    String(r.ours),
    r.hasRef ? String(r.ref) : "—",
    r.delta === null ? "no ref" : (r.delta > 0 ? "+" : "") + String(r.delta),
    r.hasRef ? (r.delta === 0 ? "aligned" : "differs") : "no reference",
  ])}
  rowTone={rows.map((r) => r.tone)}
/>
~~~

**注意事项**

- **缺失参考要明确写"—" / "no ref"**，绝不能用 0 参与比较：0 会被读成"我们少了 100%"，而且会污染图表尺度。`BarChart` 里缺失项要显式给 0 但配以列表说明，或干脆排除该 category。
- `Δ` 只在双方都有值时计算。方向色要固定含义（大 = 警告 / 小 = 危险，或反之），并在画布上写清口径。
- 口径写在 `Text` 里：参考来自哪个文件、哪个版本、什么参数。没有口径的对比表会误导人。
- 结论列是有价值的一列：把"是否在容差内"显式写出来，不要让人自己算。
