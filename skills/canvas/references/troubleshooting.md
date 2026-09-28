# 诊断码与修法

诊断同一条结构供三处使用：`canvas_check` 的输出、tab 里的错误卡、host 日志。**先跑 `canvas_check`**——它只编译不渲染，能在你还没打开页面时就把问题说清楚。

~~~ts
type CanvasDiagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
  line?: number;
  col?: number;
  hint?: string;
};
~~~

## 速查

| 码 | 级别 | 一句话 | 修法要点 |
|---|---|---|---|
| `E_PARSE` | error | 语法 / TS 解析失败 | 看行列号，通常是 JSX 标签不配对 |
| `E_PARSE_IMPORT` | error | import 了非 `dsh/canvas` 的模块 | 只用 `dsh/canvas` |
| `E_NO_DEFAULT` | error | 缺 `export default` | 导出一个无参组件 |
| `E_SIDE_EFFECT` | error | 顶层副作用 | I/O 与定时器移出模块顶层 |
| `E_DYNAMIC` | error | `eval` / `new Function` / 动态 `import()` | 改成普通分支 |
| `E_EXTERNAL` | error | 远程资源 / iframe | 去掉；用内联 SVG |
| `E_DATA_NOT_LITERAL` | error | `DATA` 不是纯字面量 | 把值写成字面量，计算放渲染期 |
| `E_TOO_LARGE` | error | 超硬阈值，拒绝编译 | 拆画布 / 外置历史 |
| `W_NO_DATA` | warning | 没有 `export const DATA` | 把数据搬进 `DATA` |
| `W_LARGE_FILE` | warning | 超软阈值 | 拆画布 / 用引用替代长字段 |
| `W_MANY_ROWS` | warning | 渲染行数被截断 | 加筛选器；**只在渲染期出现** |

---

## E_PARSE

**含义**：sucrase 无法解析源码（语法错误，或 TS 类型剥离失败）。行列号直接来自编译器。

**典型写法**

~~~tsx
<Card>
  <CardBody>
    <Stack gap={12}>
      <Text>hi</Text>
    </Card>        {/* 打开的是 Stack，关的却是 Card */}
  </CardBody>
</Card>
~~~

**修法**：按错误卡给的行列号检查那一处的 JSX 配对与括号。JSX 要求关闭标签与最近的打开标签同名——把上面的 `</Card>` 改成 `</Stack>` 即可。

> 真实案例：设计文档附录 A 的示例画布就有一处把 `</Stack>` 写成了 `</Card>`，属于这个码。

---

## E_PARSE_IMPORT

**含义**：出现了非 `"dsh/canvas"` 的模块说明符。

**典型写法**

~~~tsx
import _ from "lodash";                    // 第三方
import { helper } from "./helper";          // 相对路径
import React from "react";                  // 见 E_REACT_IMPORT
import { LineChart } from "recharts";       // 图表库
~~~

**修法**：画布只允许 `dsh/canvas`。需要的工具函数就地写；需要的图表用套件里的 `BarChart` 或自己用内联 SVG 画。**画布之间也不能互相 import**——需要复用就复制那几行，或把逻辑提成 agent 侧的工具。

---

## E_NO_DEFAULT

**含义**：文件里没有 `export default`，或默认导出的不是组件。

**典型写法**

~~~tsx
export function Board() { return null; }   // 只有具名导出
const Board = () => null;                  // 定义了但没导出
~~~

**修法**

~~~tsx
export default function Board() {
  return <Stack gap={16}>...</Stack>;
}
~~~

具名导出（`export const DATA`、辅助函数）可以同时存在，宿主只取 default。

---

## E_SIDE_EFFECT

**含义**：模块顶层执行了有副作用或依赖运行环境的调用。模块在动态 import 时求值一次，顶层副作用会让"编译检查"和"渲染"都不再是纯函数。

**典型写法**

~~~tsx
console.log("canvas loaded");                     // 顶层日志
const timer = setTimeout(() => {}, 1000);         // 定时器
const base = window.location.pathname;            // 环境依赖
localStorage.setItem("k", "v");                   // 存储写入
const data = fetchRows();                         // I/O
~~~

**修法**

- 数据 → 写进 `DATA`（字面量）。
- 需要随交互发生的动作 → 放进事件处理器，或经 `useCanvasAction`。
- 顶层**纯计算**（`const TASKS = DATA.tasks.filter(...)`、`DATA.tasks.map(...)`）是允许的：它不读环境、不写外部。
- 定时器与网络在画布里**本来也不可用**；不要试图绕过。

---

## E_DYNAMIC

**含义**：用了动态代码执行。

**典型写法**

~~~tsx
const f = new Function("return 1");
const v = eval("1 + 1");
const mod = await import(someUrl);
~~~

**修法**：改成显式分支或查表。需要"按类型渲染不同内容"就写 `switch` / 映射对象。

---

## E_EXTERNAL

**含义**：引用了画布之外的资源。

**典型写法**

~~~tsx
<img src="https://example.com/logo.png" />
<iframe src="https://example.com" />
const url = "http://localhost:8080/data.json";
~~~

**修法**：去掉远程引用。图标用内联 SVG（`<svg viewBox="0 0 24 24">` ... ），图像数据用 `DATA` 里的字面量（小图可内联为 SVG path）。**`useCanvasResource` 是读本地工作区文本文件的唯一入口**，不要自己拼 URL。

---

## E_DATA_NOT_LITERAL

**含义**：`export const DATA` 里出现了非字面量，宿主无法在不执行代码的前提下抽取（`canvas_read` 与 `canvas_state_merge` 都依赖抽取）。

**典型写法**

~~~tsx
const n = rows.length;
export const DATA = {
  count: n,                      // 标识符引用
  at: Date.now(),                // 函数调用
  title: "Board " + n,           // 拼接
  rows: rows,                    // 外部变量
  ...defaults,                   // 非字面量 spread
};
~~~

**修法**：`DATA` 只放字面量。

~~~tsx
export const DATA = {
  count: 3,
  at: "2026-09-21",
  title: "Board",
  rows: [{ id: "a", title: "first" }],
};
~~~

需要在渲染时算的东西（过滤、排序、拼接、`new Date()` 分组）放在组件里算，**不要预先算好塞进 `DATA`**。

---

## E_TOO_LARGE

**含义**：超过硬阈值，直接拒绝编译。默认：源码 1 MB / 8000 行 / `DATA` 4 MB（可在 Config 覆盖）。

**典型写法**：把整份历史任务表、全部日志、或另一个巨型 markdown 的内容粘进画布。

**修法**

1. 只保留当前窗口（未完成 + 最近完成）。
2. 超长 `note` 改成引用：`crates/occt-topo/src/brep_surface.rs:306` 或"见 t323"。
3. 拆成多个画布：一个索引画布（导航 + 概览）+ 若干子画布（每个一个主题）。
4. 历史数据留在普通文件里，画布只显示聚合数字。

---

## W_NO_DATA

**含义**：没有 `export const DATA`。画布仍可渲染，但 `canvas_read` 只能退化为返回源码文本——**context 成本回到全文重读的老路**。

**修法**：把条目搬进 `DATA`：

~~~tsx
export const DATA = {
  items: [{ id: "a", title: "first", status: "pending" }],
} as const;
~~~

然后组件只从 `DATA` 取值。这样 agent 以后能用 `canvas_read(path, "items", { status: "pending" })` 只取要动的那几条。

---

## W_LARGE_FILE

**含义**：超过软阈值（源码 128 KB / 1500 行 / `DATA` 512 KB）。不阻断编译，但这是**文件正在长成巨石的第一个信号**——把它当必须处理的信号，不要当噪音。

**修法**：同 `E_TOO_LARGE` 的四条，但现在是拆的时机，不是被迫拆。

---

## W_MANY_ROWS

**含义**：某次渲染的行数超过 `Table` / `TodoList` 的 `maxRows`（默认 300），或超过全局 `maxRenderRows`（默认 5000），内容被截断。

**注意**：这是**渲染期**条件，而诊断管线是**编译期**（host）——所以 `canvas_check` 看不到它，它只出现在 tab 的 warning 徽标上。**不要指望用 `canvas_check` 验证行数上限。**

**修法**

- 加筛选器：用 `Pill` 把"全部"变成"进行中 / 失败 / 某个分组"，默认只渲染当前视图。
- 把长表放进 `CollapsibleSection`，或拆成"概览表 + 明细画布"。
- 真需要看全量时，用 `canvas_read` 在 agent 侧切片，而不是让面板渲染全部。

---

## 已知的口径缺口（实现前需定）

下面三条在当前文档里口径不一致，写在这里以免你在排错时误判。**实现时以其中一条为准，并回写 `INTERFACE.md`。**

| 码 | 现状 | 建议 |
|---|---|---|
| `E_REACT_IMPORT` | 设计文档 §5.3 提到"`import React from "react"` 报此码"，但 §6.6 的诊断码联合里没有它；而 §6.3 又说"任何其它说明符 → `E_PARSE_IMPORT`"。两条码谁先触发未定。 | 二选一并写进 `INTERFACE.md`。若保留，明确优先级：react 专用码优先于通用的 `E_PARSE_IMPORT`。 |
| `W_UNKNOWN_PROP` | 出现在 §6.6 的联合里，但**没有任何检查定义**（组件未知 prop 的检测既非编译期也非渲染期，需要运行时比对）。 | 要么实现为编译期 prop 白名单检查，要么从联合里删除。当前不要依赖它。 |
| `W_DEPRECATED` | §8.1 与 §19 都引用它作为套件弃用通道，但不在 §6.6 的联合里。 | 补进联合，并按"文档标注 → 警告 → 两个 minor 后移除"的三步走实现。 |

另外，`W_MANY_ROWS` 属于**渲染期**条件，与"编译期产生诊断"的主管线不同源（见上文）。若希望它能被 `canvas_check` 捕获，需要额外做静态行数估算——目前没有。
