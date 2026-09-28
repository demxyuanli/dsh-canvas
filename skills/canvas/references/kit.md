# 套件 API —— `dsh/canvas`

画布文件**只能** import 这一个模块说明符：

~~~tsx
import {
  Stack, Row, Grid, Divider, CollapsibleSection,
  H1, H2, Text, Code,
  Card, CardHeader, CardBody, Callout,
  Stat, Table, BarChart, TodoList,
  Button, Pill,
  useState, useEffect, useMemo, useCallback, useRef,
  useCanvasState, useCanvasOverlay, useCanvasAction, useHostTheme, useCanvasResource,
} from "dsh/canvas";
~~~

不要 `import React from "react"`，也不要任何其它模块——它们会被 `E_PARSE_IMPORT` 拒绝。

## 设计约定（先读这四条）

1. **只认语义 `tone`，不认颜色**：不要写颜色值、不要写 class、不要写像素间距。颜色与间距由宿主解析，主题切换自动跟随。
2. **受控组件**：`active` / `open` 由调用方给。唯一例外是 `CollapsibleSection` 的 `defaultOpen`。
3. **`tone` 与 `size` 是两条独立的轴**：`tone` 管颜色，`size` 管字号。
4. **只加不减**：套件不会删导出或改签名。若某天必须改，会先给 `W_DEPRECATED` 诊断并保留至少两个 minor 版本。

## 通用类型

~~~ts
type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type Status = "pending" | "in_progress" | "completed" | "cancelled";
~~~

| tone | 语义 | 典型用途 |
|---|---|---|
| `"neutral"` | 中性 / 未知 | "无参考基线"、归档 |
| `"info"` | 信息 | "ours" 系列、一般提示 |
| `"success"` | 通过 | 门禁绿、已完成 |
| `"warning"` | 需注意 | 偏差、进行中、超阈值 |
| `"danger"` | 失败 / 回归 | 门禁红、编译错误 |

`Text` 的 `tone` 额外接受 `"primary" | "secondary" | "tertiary"` 三个便利别名（映射到中性色的三个弱化档）。

---

## 布局

### `Stack`

纵向 flex。画布根节点通常就是它。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `gap` | `number` | `12` | 子元素间距（宿主间距单位） |
| `align` | `"start" \| "center" \| "end" \| "stretch"` | — | 交叉轴对齐 |
| `children` | `ReactNode` | — | — |

~~~tsx
<Stack gap={24}>
  <H1>Title</H1>
  <Text tone="secondary">Subtitle</Text>
</Stack>
~~~

### `Row`

横向 flex。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `gap` | `number` | `8` | 间距 |
| `wrap` | `boolean` | — | 允许换行（按钮条、Pill 条建议开） |
| `align` | 同 `Stack` | — | 交叉轴对齐 |
| `justify` | `"start" \| "center" \| "end" \| "space-between"` | — | 主轴对齐 |

~~~tsx
<Row gap={8} wrap>
  <Pill active>Open 12</Pill>
  <Pill>All 40</Pill>
</Row>
~~~

### `Grid`

等宽或自定义列网格。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `columns` | `number \| string` | `2` | 数字 = 等宽列数；字符串直接作为 CSS `grid-template-columns`（支持 `"minmax(0, 1.1fr) minmax(0, 0.9fr)"`） |
| `gap` | `number` | `16` | 间距 |
| `align` | 同 `Stack` | — | 交叉轴对齐 |

~~~tsx
{/* 概览指标：三列等宽 */}
<Grid columns={3} gap={16}>
  <Stat value="8" label="Aligned" tone="success" />
  <Stat value="12" label="Open" tone="warning" />
  <Stat value="3" label="Blocked" tone="danger" />
</Grid>

{/* 左右主从：列表 + 详情 */}
<Grid columns="minmax(0, 1.1fr) minmax(0, 0.9fr)" gap={20} align="start">
  <Stack gap={12}>...</Stack>
  <Card>...</Card>
</Grid>
~~~

### `Divider`

1px 分隔线，无 props。

~~~tsx
<Divider />
~~~

### `CollapsibleSection`

折叠区。用来把"历史 / 归档 / 说明"收起来，是保持画布小的主要手段。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | `string` | 必填 | 折叠区标题 |
| `count` | `number` | — | 渲染成标题后的尾随徽标 |
| `trailing` | `ReactNode` | — | 标题行右端（放说明文字或 Pill） |
| `defaultOpen` | `boolean` | `false` | 非受控初值；这是套件里唯一带内部状态的 prop |
| `children` | `ReactNode` | — | 折叠内容 |

~~~tsx
<CollapsibleSection
  title="Archived"
  count={31}
  trailing={<Text size="small" tone="tertiary">历史不进默认视图</Text>}
>
  <Text size="small" tone="tertiary">见 specs 归档。</Text>
</CollapsibleSection>
~~~

---

## 排版

### `H1` / `H2`

两级标题，props 只有 `children`。

~~~tsx
<H1>STEP to OBJ remaining gaps</H1>
<H2>Face count vs OCCT</H2>
~~~

### `Text`

正文。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `size` | `"small" \| "md" \| "large"` | `"md"` | 字号档 |
| `weight` | `"normal" \| "semibold"` | `"normal"` | 字重档 |
| `tone` | `Tone \| "primary" \| "secondary" \| "tertiary"` | — | 颜色 |
| `style` | `CSSProperties` | — | 逃生口；只在确实需要时用 |
| `children` | `ReactNode` | — | — |

~~~tsx
<Text>正文。</Text>
<Text weight="semibold">强调一行</Text>
<Text size="small" tone="tertiary">来源与脚注</Text>
<Text size="small">Hits: <Code>Shape</Code></Text>
~~~

### `Code`

等宽文本，用于文件路径、命令、标识符。props 只有 `children`。

~~~tsx
<Code>crates/occt-topo/src/brep_surface.rs:306</Code>
~~~

---

## 容器

### `Card` / `CardHeader` / `CardBody`

卡片。`CardHeader` 是标题行（`trailing` 右对齐），`CardBody` 是内容区（带内边距）。三者按 `Card > CardHeader|CardBody` 嵌套。

| 组件 | props |
|---|---|
| `Card` | `children` |
| `CardHeader` | `trailing?: ReactNode`；`children` |
| `CardBody` | `children` |

~~~tsx
<Card>
  <CardHeader trailing={<Pill size="sm" tone="warning">active</Pill>}>
    T-323
  </CardHeader>
  <CardBody>
    <Stack gap={12}>
      <Text weight="semibold">未移植的极值搜索窗口</Text>
      <Text size="small">OCCT: <Code>ShapeAnalysis_Surface.cxx:1340-1352</Code></Text>
      <Divider />
      <Row gap={8} wrap>
        <Button variant="primary">Start in chat</Button>
        <Button variant="ghost">Open file</Button>
      </Row>
    </Stack>
  </CardBody>
</Card>
~~~

### `Callout`

提示块。宿主也用它渲染编译错误卡（`tone="danger"`）。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `tone` | `Tone` | `"info"` | 语义色 |
| `title` | `string` | — | 加粗标题行 |
| `children` | `ReactNode` | — | 正文 |

~~~tsx
<Callout tone="warning" title="不要为单个样例调参">
  管线是共享的。补缺失的分支，保住既有基线。
</Callout>
~~~

---

## 数据

### `Stat`

单个指标块：大号 `value` + 小号 `label`。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `value` | `string \| number` | 必填 | 主数值 |
| `label` | `string` | 必填 | 说明文字 |
| `tone` | `Tone` | — | 语义色 |
| `hint` | `string` | — | 悬浮说明 |

~~~tsx
<Stat value={open.length} label="Open tasks" tone="warning" />
<Stat value="14/14" label="parity" tone="success" hint="基线 14/14" />
~~~

### `Table`

明细表。画布的主力组件。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `headers` | `ReactNode[]` | 必填 | 表头 |
| `rows` | `ReactNode[][]` | 必填 | 每行的单元格（可以是任意节点，例如放 `<Button>`） |
| `columnAlign` | `("left" \| "right" \| "center")[]` | 全左 | 逐列对齐；数字列建议 `"right"` |
| `rowTone` | `Tone[]` | — | 逐行语义色（长度不足的行不着色） |
| `striped` | `boolean` | `false` | 斑马纹 |
| `stickyHeader` | `boolean` | `false` | 表头吸顶 |
| `onRowClick` | `(index: number) => void` | — | 整行可点 |
| `emptyText` | `string` | `"No rows"` | 空数据文案 |
| `maxRows` | `number` | `300` | 超出截断并报 `W_MANY_ROWS` |

~~~tsx
<Table
  headers={["Model", "ours v/f", "occ v/f", "faces"]}
  columnAlign={["left", "right", "right", "right"]}
  striped
  stickyHeader
  rows={DATA.models.map((m) => [
    m.stem,
    m.oursV + "/" + m.oursF,
    m.occV === null ? "—" : m.occV + "/" + m.occF,
    m.occF === null ? "no ref" : String(m.oursF - m.occF),
  ])}
  rowTone={DATA.models.map((m) =>
    m.occF === null ? "neutral" : m.oursF === m.occF ? "success" : "warning"
  )}
/>
~~~

### `BarChart`

分组柱状图（手写 SVG，无第三方依赖）。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `categories` | `string[]` | 必填 | 横轴标签；**超过 40 个只渲染前 40** 并提示 |
| `series` | `{ name: string; data: number[]; tone?: Tone }[]` | 必填 | 每组的 `data` 长度应与 `categories` 对齐 |
| `beginAtZero` | `boolean` | `false` | 纵轴是否从 0 开始 |
| `height` | `number` | `240` | 像素高度 |
| `stacked` | `boolean` | `false` | 堆叠而非分组 |

~~~tsx
<BarChart
  categories={DATA.models.map((m) => m.stem)}
  series={[
    { name: "ours", data: DATA.models.map((m) => m.oursF), tone: "info" },
    { name: "occt", data: DATA.models.map((m) => m.occF ?? 0), tone: "neutral" },
  ]}
  beginAtZero
  height={220}
/>
~~~

### `TodoList`

待办清单。行前是状态点，`onTodoClick` 让整行可点（常用来把"点行"变成"切换当前详情"）。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `todos` | `{ id: string; status: Status; content: ReactNode }[]` | 必填 | `status` 取 `pending \| in_progress \| completed \| cancelled` |
| `onTodoClick` | `(todo) => void` | — | 收到的是被点的那个 todo 对象 |
| `dense` | `boolean` | `false` | 紧凑排版 |

~~~tsx
<TodoList
  todos={visible.map((t) => ({ id: t.id, status: t.status, content: t.title }))}
  onTodoClick={(todo) => setActiveId(todo.id)}
/>
~~~

---

## 控件

### `Button`

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "ghost"` | `"secondary"` | 视觉级别 |
| `size` | `"sm" \| "md"` | `"md"` | 尺寸档 |
| `disabled` | `boolean` | `false` | 禁用 |
| `pending` | `boolean` | `false` | 显示进行中并禁用 |
| `onClick` | `() => void \| Promise<void>` | — | **返回 Promise 时自动进入 pending** |
| `children` | `ReactNode` | — | 标签 |

~~~tsx
<Button variant="primary" onClick={() => dispatch({ type: "startTurn", prompt: "继续 T-323" })}>
  Start in chat
</Button>
<Button onClick={() => overlay.set(active.id, { status: "in_progress" })}>Mark active</Button>
<Button variant="ghost" onClick={() => dispatch({ type: "openFile", path: active.write })}>Open file</Button>
~~~

### `Pill`

筛选条 / 徽标。

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `active` | `boolean` | `false` | 高亮当前项 |
| `size` | `"sm" \| "md"` | `"md"` | 尺寸档 |
| `tone` | `Tone` | — | 语义色 |
| `onClick` | `() => void` | — | 传了才可点 |
| `children` | `ReactNode` | — | 标签 |

~~~tsx
<Pill active={filter === "open"} onClick={() => setFilter("open")}>Open {open.length}</Pill>
<Pill size="sm" tone="danger">failing</Pill>
~~~

---

## 钩子

### React 基础钩子（re-export）

`useState` / `useEffect` / `useMemo` / `useCallback` / `useRef` 直接从 `dsh/canvas` 取，语义与 React 完全一致。这样画布文件只需要一行 import。

~~~tsx
const [q, setQ] = useState("");
const filtered = useMemo(() => rows.filter((r) => r.title.includes(q)), [rows, q]);
~~~

### `useCanvasState` —— 纯 UI 态

~~~ts
useCanvasState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void]
~~~

- 存在浏览器 `localStorage`，键空间 `dsh.canvas.<canvasId>.<key>`（`canvasId` 是画布绝对路径的短哈希）。
- **跨会话共享**：同一画布的所有会话看到同一个筛选器——这是刻意的，筛选器是用户偏好。
- **agent 看不到它。** 只放筛选器、当前选中项、折叠开关这类纯 UI 态。
- 想让人机共享，用 `useCanvasOverlay`。

~~~tsx
const [filter, setFilter] = useCanvasState("filter", "open");
const [activeId, setActiveId] = useCanvasState("active", "T-01");
~~~

### `useCanvasOverlay` —— 对 agent 可见的共享态

~~~ts
useCanvasOverlay<T extends { id: string }>(
  key: string,
  initial: readonly T[],
): {
  items: T[];                          // initial + overlay 合并后的结果
  get(id: string): T | undefined;
  set(id: string, patch: Partial<T>): Promise<void>;
  clear(id?: string): Promise<void>;   // 省略 id = 清空该 key
  pending: boolean;                    // 有未落盘改动
}
~~~

- `key` 对应 `DATA` 里的数组字段名（例如 `"tasks"`），overlay 就是对该数组条目的**浅合并补丁**。
- `set` 落盘到同目录 sidecar `.canvas/<stem>.state.json`，所以 **`canvas_read` 读得到**——人的判断对 agent 可见。
- 只读 `items`：画布不需要关心某个字段是来自源文件还是来自人的改动。
- 人可能标了还在源文件里不存在的 `id`；这类条目会被标 `orphan` 而非删除（`canvas_read` 会报告）。
- 固化：用 `canvas_state_merge` 把 sidecar 写回源文件 `DATA`。

> **实现要求**：`initial` 必须接受 `readonly T[]`。`export const DATA = { ... } as const` 产生的正是 readonly 字面量数组；若签名只收 `T[]`，每个画布都得写 `as unknown as T[]` 双重 cast（设计文档附录 A 就是这么写的，属于缺陷）。本模板与文档示例一律按 `readonly` 签名书写，不带 cast。
>
> **另一个书写要求**：`set(id, patch)` 的参数类型是 `Partial<T>`，所以**人会改的字段必须已经出现在 `DATA` 里**。又因为 `DATA` 用了 `as const`，字段是字面量类型，`overlay.set(id, { status: 'acked' })` 只有在 `'acked'` 已经出现在某个条目上时才通过类型检查。模板的做法是：board 让四种 status 各至少出现一次，gates 用 `acked` 作为一个显式取值。若不想受这个约束，可以不给 `DATA` 加 `as const`——代价是 `status` 退化为 `string`，`Record<Status, ...>` 查表会失配。

~~~tsx
const overlay = useCanvasOverlay("tasks", DATA.tasks);

// 人在面板上点 "Mark done" —— 下一轮 agent 通过 canvas_read 能看到
<Button onClick={() => overlay.set(active.id, { status: "completed" })}>Mark done</Button>
~~~

### `useCanvasAction`

~~~ts
useCanvasAction(): (action: CanvasAction) => Promise<ActionResult>
~~~

- 每个动作都要经过宿主；**画布自己不能**做这些事（不能开文件、不能起回合、不能跑命令）。
- 失败**不抛异常**，返回 `{ ok: false, code, message }`，方便你在画布上渲染"被拒绝"状态。
- 动作分流：

| 动作 | 谁处理 | 说明 |
|---|---|---|
| `openFile` | client | 转成文件资源地址后走右栏导航，`line` 作为参数传下去 |
| `openResource` | client | 直接打开一个 `dsh-resource://` 地址 |
| `copy` | client | 写剪贴板 |
| `startTurn` | host | 追加到当前会话（`newSession: true` 则新建会话）；有冷却与去重 |
| `runCommand` | host | 仅 Config 白名单内的命令；受 permission preset 约束 |
| `notify` | host | 宿主回 ok，由 client 显示提示条 |
| `overlaySet` / `overlayClear` | host | 写 sidecar |

~~~tsx
const dispatch = useCanvasAction();

await dispatch({ type: "openFile", path: "crates/occt-topo/src/brep_surface.rs", line: 306 });
await dispatch({ type: "startTurn", prompt: "处理 T-323：把窗口扩张分支移植进 value_of_uv" });
await dispatch({ type: "runCommand", id: "gate:phase19" });

const r = await dispatch({ type: "runCommand", id: "gate:parity" });
if (!r.ok && r.code === "denied") {
  // 白名单未登记或权限不足 —— 在画布上提示，而不是静默失败
}
~~~

### `useHostTheme`

~~~ts
useHostTheme(): {
  dark: boolean;
  tone(t: Tone): string;                                    // 解析后的颜色
  text: { primary: string; secondary: string; tertiary: string };
  space(n: number): string;
}
~~~

绝大多数组件不需要它（它们内部用 CSS 变量）。只有两处需要：内联 SVG 的颜色属性（例如自定义图表），以及画布自定义的美术元素。

~~~tsx
const theme = useHostTheme();
<svg viewBox="0 0 100 20"><rect width="100" height="20" fill={theme.tone("warning")} /></svg>
~~~

### `useCanvasResource`

~~~ts
useCanvasResource(path: string): {
  status: "loading" | "ready" | "error" | "none";
  text?: string;
  error?: string;
}
~~~

按工作区路径读一个文本文件（例如让画布顺带显示某个日志尾部）。`status === "none"` 表示路径不可读。

~~~tsx
const log = useCanvasResource("output/phase19.log");
{log.status === "ready" ? <Code>{log.text}</Code> : null}
~~~

---

## 类型

~~~ts
type CanvasAction =
  | { type: "openFile"; path: string; line?: number }
  | { type: "openResource"; address: string; params?: Record<string, unknown> }
  | { type: "copy"; text: string }
  | { type: "startTurn"; prompt: string; newSession?: boolean }
  | { type: "runCommand"; id?: string; command?: string; cwd?: string; title?: string }
  | { type: "notify"; tone: Tone; message: string }
  | { type: "overlaySet"; key: string; id: string; patch: Record<string, unknown> }
  | { type: "overlayClear"; key: string; id?: string };

type ActionResult =
  | { ok: true; detail?: string }
  | { ok: false; code: "denied" | "unsupported" | "failed"; message: string };
~~~

`runCommand` 必须给 `id`（对应 Config 白名单项的 id）或**完整命令字符串** `command`，二者都要逐字匹配白名单。

---

## 规模上限

| 情况 | 行为 |
|---|---|
| `Table` / `TodoList` 超过 `maxRows`（默认 300） | 截断，末尾显示 "showing N of M"，并报 `W_MANY_ROWS` |
| 全局渲染行数超过 Config 的 `maxRenderRows`（默认 5000） | 硬上限，截断 |
| `BarChart` 超过 40 个 category | 只渲染前 40 并提示 |
| 源码 / 行数 / `DATA` 超软阈值 | `W_LARGE_FILE` 警告（不阻断） |
| 源码 / 行数 / `DATA` 超硬阈值 | `E_TOO_LARGE`（拒绝编译） |

**截断不是虚拟化**。画布的正确用法是切片：用筛选器只渲染当前要看的那部分。
