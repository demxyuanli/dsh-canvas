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

| 码 | 级别 | 产出方 | 一句话 | 修法要点 |
|---|---|---|---|---|
| `E_PARSE` | error | sucrase | 语法 / TS 解析失败 | 看行列号，通常是 JSX 标签不配对 |
| `E_PARSE_IMPORT` | error | 扫描 | import 了非 `dsh/canvas` 的模块 | 只用 `dsh/canvas`（`import React` 也归这条） |
| `E_NO_DEFAULT` | error | 编译管线 | 缺 `export default` | 导出一个无参组件 |
| `E_SIDE_EFFECT` | error | 扫描 | 顶层副作用 | I/O 与定时器移出模块顶层 |
| `E_DYNAMIC` | error | 扫描 | `eval` / `new Function` / 动态 `import()` | 改成普通分支 |
| `E_EXTERNAL` | error | 扫描 | 远程资源 / iframe | 去掉；用内联 SVG |
| `E_DATA_NOT_LITERAL` | error | 抽取 | `DATA` 不是纯字面量 | 把值写成字面量，计算放渲染期 |
| `E_MERGE` | error | `canvas_state_merge` | 读不出 `DATA` | `DATA` 必须是对象字面量，且每行有 `id` |
| `E_TOO_LARGE` | error | 编译管线 | 超硬阈值，拒绝编译 | 拆画布 / 外置历史 |
| `W_NO_DATA` | warning | 抽取 | 没有 `export const DATA` | 把数据搬进 `DATA` |
| `W_LARGE_FILE` | warning | 编译管线 | 超软阈值 | 拆画布 / 用引用替代长字段 |
| `W_REMOTE_URL` | warning | 扫描 | 源码里出现 `http(s)://` | 画布不能拉远程内容；内联数据 |
| `W_MANY_ROWS` | warning | **渲染期文案（不是诊断）** | 行数被截断 | 加筛选器 |

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
import React from "react";                  // 同样归 E_PARSE_IMPORT（§21 D2 已删掉专用码）
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

## E_MERGE

**含义**：`canvas_state_merge` 想在源文件里定位 `export const DATA` 的字段跨度，但没找到可解析的对象字面量。它不是编译错误——画布可能照常渲染——只是"把 sidecar 固化回源文件"这一步做不了。

**典型原因**

- 文件里没有 `export const DATA`（先补 `DATA`，见 `W_NO_DATA`）。
- `DATA` 不是对象字面量（例如导出了数组或标识符）。
- `DATA` 里有非字面量，宽容解析器读不下去（同 `E_DATA_NOT_LITERAL`）。
- 目标数组的条目缺少 `id`：merge 靠 `id` 找行；没有 `id` 的行会被跳过而不是猜。

**修法**：把 `DATA` 修成"对象 + 每个条目有 `id` + 纯字面量"，再重跑 `canvas_state_merge`。未命中的 id 会出现在返回的 `skipped` 里，不会静默丢弃。

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

## 诊断码的口径（已定）

DESIGN §21 已经逐条裁决。下面是最终归属；排错时不要按旧文档猜。

| 码 | 归属 | 说明 |
|---|---|---|
| `E_REACT_IMPORT` | **已删除** | `import React from "react"` 报 `E_PARSE_IMPORT`——允许的模块集合只有 `dsh/canvas`（§21 D2）。 |
| `W_UNKNOWN_PROP` | **reserved，不产出** | 需要 per-component prop 表才能实现；当前不要依赖它（§21 D3）。 |
| `W_DEPRECATED` | **client 渲染期信号** | 套件真要做破坏性变更时才启用；它不是 host 编译诊断（§21 D4）。 |
| `W_MANY_ROWS` | **渲染期文案** | 超过 `maxRows` 只显示 `showing N of M`，不产出编译诊断（§21 D5）。 |
| `W_NO_METADATA` | **reserved，不产出** | discovery 直接内联返回 metadata，不再需要这条码。 |

**产出方只有两个**：host（扫描 / 编译器 / 抽取 / `canvas_state_merge`）与 client（渲染期文案）。`canvas_check` 只看得到 host 的那部分。

> `W_MANY_ROWS` 属于渲染期条件，与"编译期产生诊断"的主管线不同源。若希望它能被 `canvas_check` 捕获，需要额外做静态行数估算——目前没有。

---

## 在 Desktop 里验证安装（host / client 是两个半边）

装进 profile 后**要重启应用**才生效，而且两个半边分开加载，验证方式不同：

| 半边 | 怎么验 | 期望 |
|---|---|---|
| host | `GET /canvas/api` | 200 + `{"version":"1","actions":[…] }`；404 = host 没加载（没装 / 没重启） |
| host | 直接调 `canvas_check` / `canvas_read` | 工具已注册，能返回数据 |
| host | `POST /canvas/action {type:"runCommand"}` | 真实 `exitCode` |
| client | **在应用里打开任意 `*.canvas.tsx`** | 渲染成画布；若是文本预览 = client 半边没加载 |

**不要用 HTTP 探测 client bundle。** Desktop 的客户端模块走自定义协议 `dsh-app://app/plugins/<包名>/client.js`，不是 HTTP 路由——对 `/plugins/...` 发 HTTP 请求一律 404，**连官方插件也一样**，极易误判成"我们的没装上"。

想知道渲染进程实际加载了哪些 client bundle，查 Chromium 的 V8 代码缓存（**只有执行过的脚本才会进这里**）：

~~~powershell
$ud = "$env:APPDATA\@deepseek-ai\dsh-desktop\Code Cache\js"
Get-ChildItem $ud | Where-Object { [System.IO.File]::ReadAllText($_.FullName) -match "dsh-canvas" }
~~~

命中的文件里能看到 `dsh-app://app/plugins/@local/dsh-canvas/client.js`，与官方客户端插件排列在同一批 URL 中——这就是"client 半边已经在跑"的直接证据。

