# DSH Canvas 插件设计（真 TSX · 通用 · 内联数据）

> **状态**：host + client 已实现（详见 §14「实现状态」）；client bundle 需重启 GUI 激活
> **目标读者**：实现者（host/client 两个包）、写画布的 agent（见 §12）、后续维护者
> **载体**：本仓 `D:\source\repos\dsh-canvas`（2026-09-28 从 `D:\source\repos\dogs\tools\dsh-canvas` 迁出）；插件与 OCCT 无关，任何 profile 可用
> **参考实现**：Cursor Canvas（用户提供的 `StepObjRemaining` 画布源码，见附录 A 的改写）

---

## 0. 决策记录（已拍板）

| # | 决策 | 选择 | 后果 |
|---|---|---|---|
| D1 | 画布语言 | **真 TSX**，宿主用 `sucrase` 编译 | 需要新增 1 个依赖（纯 JS，无原生二进制）；能力与 Cursor 等价 |
| D2 | 适用范围 | **通用插件**（任何 profile / 任何项目） | 画布不能依赖本仓约定；发现机制要做成"工作区里任何 `*.canvas.tsx`" |
| D3 | 数据位置 | **内联在画布文件里**（照 Cursor） | 必须补两个补偿机制：§11.3 内联数据静态抽取、§9.2 sidecar overlay |
| D4 | 交付顺序 | 先出完整设计 | 本文档；实现从 §17 的 P0 开始 |

**D3 的代价必须写在最前面**：内联数据 = 画布文件会长成第二个 `_board.md`。本仓现况是 4160 行 / 888 KB 的 markdown，§3 独占第 102–1908 行。把同样的内容内联进 TSX 只是换了个更漂亮的壳。所以本设计把"D3 + 两个补偿机制"当作一个整体：**内联是给人看的产物格式，不是 agent 的读取格式**——agent 永远通过 `canvas_read`（§11.3）读结构化切片，而不是全文重读、全文重写。

---

## 1. 目标 / 非目标

### 目标

1. agent 写一个 `*.canvas.tsx` 文件，宿主**实时编译并渲染**成一个可交互面板（右栏 tab / 满屏页）。
2. 渲染结果使用宿主主题与排版，**不需要 agent 写任何 CSS**。
3. 画布上的按钮能**回灌 agent**：打开文件、发起新回合、执行白名单命令。
4. agent 有完整的自检手段：`canvas_check` 编译校验、`canvas_read` 结构化查询、脚手架 `canvas_new`。
5. 人的交互结果（点击改状态等）对 agent **可见**（sidecar overlay，§9.2）。
6. 编译失败 / 运行时崩溃**不能是白屏**，必须是可诊断的卡片。

### 非目标（本设计不做）

- 不做画布的市场 / 分发 / 版本管理。
- 不向画布代码提供网络、文件写入、DOM 直操作（§13）。
- 不替代 `todo_write`（短任务）与 `goal`（是否继续下一轮）。
- 不做"agent 自动决定该画什么"的调度；画布是**被要求时**才写的产物。
- 不修改 DSH 自身的任何已发布包（纯增量插件）。

---

## 2. 术语与 Cursor 对应

| Cursor 概念 | 代码证据（用户提供的画布） | DSH 对应 |
|---|---|---|
| Canvas 文件 | `export default function StepObjRemaining()` | `*.canvas.tsx`，默认导出组件 |
| `cursor/canvas` | 18 个组件 + `useMemo` | `dsh/canvas`（本文档 §8 的套件） |
| Host 渲染 | 自动主题、自动排版 | 右栏 tab type + host 注入的 CSS 变量 |
| `useHostTheme()` | `theme.text.tertiary` | `useHostTheme()`，返回 token 值对象（§9.4） |
| `useCanvasState()` | `"step-rem-status"` 持久化 | `useCanvasState`（本地 UI 态）+ `useCanvasOverlay`（对 agent 可见，§9.1/§9.2） |
| `useCanvasAction()` | `{type:"newComposerChat", userPrompt:[...]}` | `{type:"startTurn", prompt}` 等（§9.3） |
| "canvas sidecar" | 代码注释提到，但无规范 | `.canvas/<name>.state.json`（§9.2，本设计补齐） |
| — | — | 新增：`canvas_check` / `canvas_read` / `canvas_new` 工具（§11） |

---

## 3. 为什么是"文件 + 编译 + 套件 + 钩子 + 动作桥"

五个机制缺一不可，少任何一个都会退回成"更好的 markdown"：

1. **文件**——产物可 diff、可进 git、可被任何编辑器打开、可被 agent 用普通文件工具改。这是 DSH 的既有强项，不要发明新存储。
2. **编译**——只有真代码才能在同一个产物里同时表达筛选、聚合、排序、条件渲染、图表。声明式 DSL 走到第三步就会长出半吊子表达式语言。
3. **套件**——把"好看"变成默认。agent 只选语义（`tone="warning"`），不碰间距/圆角/配色，所以画布与宿主永远一致，主题切换免费。
4. **钩子**——`useCanvasState` 让"点一下筛选"这种纯 UI 态不污染数据；`useCanvasOverlay` 让人的改动对 agent 可见。
5. **动作桥**——这是分界线。只有报表是死物；能把"下一步"直接变成 agent 指令的看板才是活的。

---

## 4. 总体架构

### 4.1 两个包

| 包 | 半边 | 职责 |
|---|---|---|
| `@local/dsh-canvas` | **host**（Node） | 编译（sucrase）、模块服务、画布发现、元数据与内联数据抽取、sidecar overlay 读写、动作桥、model 工具（`canvas_new/check/read`）、`Config` |
| `@local/dsh-client-ui-canvas` | **browser** | `dsh/canvas` 套件实现、`sidebar.right` tab type、page kind、源码读取、动态 import 挂载、错误边界 |

> 建议**同仓两个包**：host 半边需要 `sucrase` 依赖，client 半边必须零依赖，混在一起会把 sucrase 的打包面暴露给浏览器。但若只求最快落地，**单包 + `dsh.client` 声明**（`exports["./client"]`）也成立：P0 先单包，P1 再拆。

### 4.2 数据流

~~~text
                     ┌──────────── agent ─────────────┐
                     │ 写/改 specs/board.canvas.tsx    │
                     │ 调 canvas_check / canvas_read   │
                     └───────────────┬────────────────┘
                                     │ 文件工具
                                     ▼
┌──────────────────────── @local/dsh-canvas (host) ────────────────────────┐
│  发现/watch → 读源码 → sucrase 编译 → 内容哈希 → 模块 URL                 │
│  内联数据抽取（纯括号扫描，不执行代码，§11.3）                              │
│  sidecar overlay 读写（.canvas/<name>.state.json）                        │
│  动作桥：openResource | startTurn | runCommand | overlaySet | notify       │
│  工具：canvas_new / canvas_check / canvas_read                            │
└───────────────┬───────────────────────────────────┬─────────────────────┘
                │ GET /canvas/module/<h>.js          │ Remote 调用 / 推送
                ▼                                    ▼
┌──────────────────── @local/dsh-client-ui-canvas (browser) ────────────────┐
│  tab type：patterns ['**/*.canvas.tsx']  → 打开即画布                      │
│  page kind：'canvas'                     → 画布目录 / 空态                 │
│  源码：useResource(dsh-resource://file/session/<sid>/<path>)              │
│  挂载：await import(moduleUrl) → <ErrorBoundary><Default/></ErrorBoundary> │
│  套件：dsh/canvas（§8） + 钩子（§9）                                       │
└──────────────────────────────────────────────────────────────────────────┘
~~~

> 本设计里围栏代码块统一用波浪线 `~~~`，因为文档本身大量讨论反引号。正式文件可以改成反引号围栏，不影响内容。

### 4.3 为什么 host 编译而不是浏览器编译

| 方案 | 结论 |
|---|---|
| host 编译（选中） | 一个内容哈希一个产物，编译一次多处复用；错误可结构化上报；浏览器不必带编译器；可离线预编译 |
| 浏览器 Worker + 编译器 | 每开一次页面都要下载编译器；`new Function` 可能撞 CSP；错误只能本地显示 |
| 不编译（声明式 DSL） | D1 已否决 |

---

## 5. 画布文件格式 `.canvas.tsx`

### 5.1 最小契约

~~~tsx
import { H1, Text, Stack } from "dsh/canvas";

export default function MyCanvas() {
  return (
    <Stack gap={16}>
      <H1>Hello canvas</H1>
      <Text tone="secondary">Rendered by the host.</Text>
    </Stack>
  );
}
~~~

三条硬规则：

1. **必须有 `export default`**，且是一个无参 React 组件。
2. **只能 import `"dsh/canvas"`**。任何其它模块说明符在编译期报错（`react` 由宿主注入，见 §6.3）。
3. **组件必须是纯渲染**：无网络、无 `setTimeout`、无 `document`、无副作用（§13）。

### 5.2 文件头元数据（可选）

供画布目录与 tab 标题使用；宿主用**注释扫描**解析，不执行代码：

~~~tsx
/** @canvas
 * title: STEP→OBJ 对齐看板
 * description: 未完成任务的监控清单
 * icon: board
 */
~~~

缺省时 `title` 取文件名、`icon` 取默认图标。元数据非法时保留合法字段并给一条诊断（与 DSH manifest 的容错策略一致）。

### 5.3 允许与禁止的语法

| 允许 | 禁止（`canvas_check` 报错或警告） |
|---|---|
| TSX、TS 类型、`as const`、泛型 | 非 `dsh/canvas` 的 `import`（E_PARSE_IMPORT） |
| 顶层 `const` 字面量、`function`、`export const DATA` | 顶层副作用：`fetch`/`setTimeout`/`console.log`/`localStorage`（E_SIDE_EFFECT） |
| `useState/useEffect/useMemo` 经套件 re-export 使用 | 直接 `import React from "react"`（E_PARSE_IMPORT：白名单只有 `dsh/canvas`） |
| `map/filter/sort/reduce`、`new Date()` | `eval` / `new Function` / 动态 `import()`（E_DYNAMIC） |
| 内联 SVG | 远程 `<img>`、`<iframe>`（E_EXTERNAL） |

实现：编译后用**扫描器**过一遍即可（不求完备），错误码集中在 §6.6。

`react` 也被拒绝，理由只是「保持单一入口」：模块包装器本就把 `require("react")` 解析到宿主同一个实例（不会出现双 React），所以放开它是**一行改动**，当前选择是严格。

### 5.4 内联数据约定（D3 的关键补偿）

脚手架默认生成这个形状：

~~~tsx
export const DATA = {
  models: [
    { stem: "Shape", oursV: 6140, oursF: 11352, occV: 6150, occF: 11372,
      note: "t306: Rev f2/f4 412/730 vs occ 301/510" },
  ],
  tasks: [
    { id: "t80", title: "布尔结果边界折线换成精确裁剪曲线", bucket: "hit",
      status: "completed", occt: "BOPAlgo ...", rust: "crates/occt-topo/...",
      hits: "Shape", goal: "...", note: "..." },
  ],
} as const;

export default function Board() {
  const { tasks, models } = DATA;
  return null; // 渲染代码见 §8 与附录 A
}
~~~

**为什么必须这个形状**：

- `DATA` 是**纯字面量**（JSON 兼容，容忍尾逗号/单引号/注释），所以宿主能用**括号扫描 + 宽容字面量解析**把它抽出来，**完全不执行 agent 的代码**（§11.3）。这让"内联"不牺牲可查询性。
- `DATA` 之外的渲染代码保持小（目标 < 400 行），改版式时才动。

**约束**：`DATA` 内不允许函数调用、模板拼接、非字面量 spread、`Date.now()`。抽取失败时报 `E_DATA_NOT_LITERAL` 并指出行号。没有 `export const DATA` 的画布**仍可渲染**，只是 `canvas_read` 退化为全文读取并给 `W_NO_DATA` 警告。

### 5.5 体积预算

| 指标 | 软阈值（警告） | 硬阈值（拒绝编译） |
|---|---|---|
| 源码字节 | 128 KB | 1 MB |
| 行数 | 1500 | 8000 |
| `DATA` 抽取后的 JSON 字节 | 512 KB | 4 MB |
| 单次渲染行数（Table/TodoList） | 300 | 5000（截断 + 提示） |

超软阈值给 `W_LARGE_FILE` 并建议拆分（多个画布 + 一个索引画布）。**硬阈值存在的目的就是防止把 888 KB 的 `_board.md` 原样搬进 TSX。**

口径：**软阈值是内建常量，不进 Config**（它们是建议性的）；`maxSourceBytes` / `maxLines` / `maxDataBytes` / `maxRenderRows` 是 Config 键。`maxRenderRows` 由 client 经 `GET /canvas/api` 读取并作为 Table 的硬上限，**不是装饰性配置**。

### 5.6 命名与发现

| 规则 | 说明 |
|---|---|
| 文件名 | `*.canvas.tsx`（tab type 的 `patterns` 匹配） |
| 目录 | 任意；推荐 `specs/` 或 `.canvas/` |
| 多画布 | 允许且鼓励：`specs/board.canvas.tsx`、`specs/gates.canvas.tsx` |
| sidecar | 同目录 `.canvas/<stem>.state.json`（§9.2） |
| 发现 | host 侧 glob + 客户端 tab 打开两条路径；guide 条目列出发现的画布（§7.2） |

---

## 6. 编译管线

### 6.1 编译器选型

| 候选 | 结论 |
|---|---|
| **`sucrase`（选中）** | 纯 JS、无原生二进制、无配置、TSX 一次到位、错误带行列号。约 1–2 MB，只装 host |
| `esbuild` | 更快，但要平台原生二进制；装到 profile 时多一层失败模式 |
| `@swc/core` | 同上；本机只有 `@swc/helpers` |
| `@babel/standalone` | 3 MB+、慢；本机 `@babel` 只有 `runtime/code-frame/helper-validator-identifier` |
| `typescript` | 3 MB+、慢，且本机两棵 node_modules 都没有 |

**现状核实**：profile 与 npx 两棵 `node_modules` 里都没有 `typescript` / `esbuild` / `sucrase`。所以**必须**由本插件的 bundle 声明依赖（profile 是 pnpm workspace，`install_bundle` 会装）。

### 6.2 变换配置

~~~js
sucrase.transform(src, {
  transforms: ["typescript", "jsx", "imports"],
  jsxRuntime: "classic",
  jsxPragma: "__DSH_CANVAS__.h",
  jsxFragmentPragma: "__DSH_CANVAS__.Fragment",
  production: true,
  filePath: canvasPath,          // 让错误带真实文件名
});
~~~

- `imports` 把 ESM 变成受限 `require`，于是我们能在工厂里注入白名单。
- `classic` + pragma 指向注入对象，**不需要把 `react/jsx-runtime` 塞进平台模块表**（那是 DSH 内部机制，插件不应依赖）。
- 目标 `esnext`（宿主是当代 Chromium/Electron，不降级）。

### 6.3 import 重写规则

编译前先做一次基于模块说明符的改写（因为我们已禁止其它说明符，一次轻量扫描即可）：

| 源码写法 | 解析到 |
|---|---|
| `import { Stack, Text } from "dsh/canvas"` | 工厂注入的套件对象 |
| `import { useMemo } from "dsh/canvas"` | 同上（套件 re-export `useMemo`，与 Cursor 一致） |
| `import * as C from "dsh/canvas"` | 整个套件命名空间 |
| JSX | `__DSH_CANVAS__.h` / `.Fragment` |
| 任何其它说明符 | 编译期 `E_PARSE_IMPORT` |

**注入全局**（在动态 import 之前设置）：

~~~js
globalThis.__DSH_CANVAS__ = {
  ...kit,
  h: React.createElement,
  Fragment: React.Fragment,
  React,
};
~~~

React 来自平台模块表（client 插件本身就在该表内运行），套件对象由 client 插件提供（§8）。

### 6.4 模块包装与 id 方案

- 产物是**标准 ESM**：`export default <Component>`。
- URL：`/canvas/module/<pathHash>/<contentSha1>.js`
  - `pathHash`：画布绝对路径的短哈希，便于排查。
  - `contentSha1`：**源码 + 编译器版本 + 套件 API 版本**的哈希，三者任一变化即新 URL。
- 响应头：`Content-Type: text/javascript; charset=utf-8`、`Cache-Control: public, max-age=31536000, immutable`。

同一 URL 永远返回同一字节，所以**未变化的保存不会触发重新编译**（先算哈希，命中即跳过 sucrase）。

### 6.5 缓存与失效

| 层 | 键 | 失效 |
|---|---|---|
| 编译缓存（host 内存） | `contentSha1` | LRU：64 条 / 32 MB |
| 浏览器模块缓存 | URL | 内容寻址，天然不失效；旧 URL 随会话存活 |
| 发现缓存 | 工作区 glob 结果 | 文件系统 watch（与 §7.6 的 reload 共用同一信号） |

> 长期会话里旧模块会累积（浏览器无法卸载 ESM）。缓解：前端记录每个路径最近 N 个 URL，超限时提示"重载页面以回收"，不强制。

### 6.6 错误模型

~~~ts
type CanvasDiagnostic = {
  code:
    | "E_PARSE"            // sucrase 语法/类型剥离错误
    | "E_PARSE_IMPORT"     // 非法 import
    | "E_NO_DEFAULT"       // 缺 export default
    | "E_SIDE_EFFECT"      // 顶层副作用
    | "E_DYNAMIC"          // eval / new Function / import()
    | "E_EXTERNAL"         // 远程资源 / iframe
    | "E_DATA_NOT_LITERAL" // DATA 抽取失败
    | "E_TOO_LARGE"        // 超硬阈值
    | "W_NO_DATA" | "W_LARGE_FILE" | "W_REMOTE_URL";
  severity: "error" | "warning";
  message: string;   // 人话，可直接给 agent
  line?: number;
  col?: number;
  hint?: string;     // 修复建议
};
~~~

**诊断有两个产出方，别混为一谈**：

- **编译期（host）**：`E_PARSE` / `E_PARSE_IMPORT` / `E_NO_DEFAULT` / `E_SIDE_EFFECT` / `E_DYNAMIC` / `E_EXTERNAL` / `E_DATA_NOT_LITERAL` / `E_TOO_LARGE` / `W_NO_DATA` / `W_LARGE_FILE` / `W_REMOTE_URL`。这些是 `canvas_check` 的全部可见输出。
- **渲染期（client）**：截断文案、套件弃用提示。它们**不可能**出现在 `canvas_check` 里，因为 check 不渲染。保留的名字：`W_MANY_ROWS`（实为渲染期文案，不是诊断）、`W_DEPRECATED`（套件弃用信号）、`W_UNKNOWN_PROP`（需要组件 prop 表才能查，未实现）、`W_NO_METADATA`（discovery 直接内联返回元数据）。

`E_PARSE` 的行列号取自 sucrase 抛出的错误对象，其余来自扫描器。**同一条诊断供三处使用**：`canvas_check` 输出、tab 里的错误卡片、host 日志。

### 6.7 传输与 CSP

- 模块走**同源** `/canvas/module/...`，与 DSH 自己的 `/plugins` 同源，不必放宽 `script-src`。
- 客户端首选**动态 `import(url)`**，而不是往 `window.__ModuleLoader__` 注册：后者的行语义面向"客户端插件"，未声明行的自动激活行为不是我们要的。
- 备选（若 CSP 禁止动态 import）：改成 `window.__ModuleLoader__.load({ id, factory })` 形式的 combo 脚本，再用 `require(id)` 取组件。两条路径产出的组件形态一致，**P0 必须实测其中一条**。

### 6.8 已否决项

| 方案 | 否决理由 |
|---|---|
| 画布在 Web Worker 里生成 VDOM 再回传 | 序列化开销大；React 事件与受控组件无法跨线程 |
| 画布跑在 iframe 里 | 违反 DSH 明确规则（iframe 拿不到主题 token 与 locale）；动作桥要 postMessage |
| 画布 import DSH 的 client 包 | 规则明令禁止；且会撞单实例 React |
| 服务端渲染成 HTML | 失去交互与动作桥，等于静态报表 |

## 7. 浏览器加载与挂载

### 7.1 客户端插件清单

~~~json
{
  "name": "@local/dsh-client-ui-canvas",
  "type": "module",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": {
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-resources",
        "@deepseek-ai/dsh-client-ui-sidebar-right"
      ]
    }
  }
}
~~~

- `immediately: true` 是**必需**的：tab type 必须在用户点开任何 `.canvas.tsx` 之前完成注册，否则文件会被内置文档预览接管。
- `inject` 只负责**激活顺序**，不是依赖注入；规则明确禁止用 `require` 去加载这些包（§6.8）。
- host 半边的 `lib/index.js` 只需 `export function apply() {}`（纯 UI 插件，参见 §4.1 的单包退化）。

### 7.2 tab type 与 page kind 注册

~~~js
ctx.sidebarRightTabs.register({
  id: "@local/dsh-client-ui-canvas/canvas",
  kind: "canvas",
  patterns: ["*.canvas.tsx"],
  priority: "extension",
  title: (address) => metadataTitle ?? basename(address),
  guide: [{ id: "canvas.directory", title: "Canvases", description: "画布目录与新画布入口" }],
  keepMounted: true,
});

ctx.slots.register({ name: "sidebar.right.pane.tab", key: "@local/dsh-client-ui-canvas/canvas" }, CanvasBody);
~~~

- `patterns` 语义（已核实）：**不含 `:` 的模式匹配 URI 的 path、任意深度、忽略大小写**，内置预览就是写 `*.md`。所以这里写 `*.canvas.tsx`，不要写 `**/*.canvas.tsx`。
- `priority: "extension"` 高于内置文档预览，保证 `.canvas.tsx` 默认进画布而不是纯文本预览。
- `keepMounted: true`：切 tab 不卸载，避免每次切回都重编译重挂载。
- body 组件从框架 props 取 `useTabInfo` / `useResource` / `useStore` / `actions`（已从内置文档预览的签名核实）。
- page kind `"canvas"` 供 guide 条目打开"画布目录"页（列表 + 新建入口 + 空态）。

### 7.3 源码读取

- 文件资源地址语法（已核实）：`dsh-resource://file/session/<sessionId>/<path>`，前缀常量 `dsh-resource://file/`。
- tab 的 `contentId` 就是该地址；`useResource(tab.contentId)` 返回活值（内置预览的判据是 `meta.status !== "none"`）。
- **P0 需实测**：该资源默认返回的是文本还是字节。若默认不是文本，改走 `dsh-api-workspace-files` 的分页 UTF-8 读取（该服务已存在：bounded reads + watch，无写操作），并读满整个文件（画布源码不会超过 §5.5 硬阈值）。

### 7.4 加载器

~~~text
1. contentId -> 源码文本（§7.3）
2. 交给 host 编译：POST /canvas/module { path, source } -> { url, diagnostics }
   （host 先算 contentSha1；命中缓存则直接返回已有 url，跳过 sucrase）
3. 同步注入：globalThis.__DSH_CANVAS__ = { ...kit, h: React.createElement,
                                             Fragment: React.Fragment, React }
4. const mod = await import(url)          // 同源、内容寻址、可永久缓存
5. const Component = mod.default
~~~

- **注入必须在 `import` 之前且同步完成**：画布模块顶层可能立刻用 `h`（`jsxPragma`）。
- 同一 URL 的并发打开用一个 in-flight Map 去重；浏览器自身也去重，但我们要共享**错误态**（一次失败所有等待者拿到同一诊断）。
- 已有成功结果的 URL 直接复用，不再 `import`（§6.5）。

### 7.5 挂载 / 重挂载 / 卸载

- tab body 内部维护 `{ status, Component, diagnostics, sha }`。
- 源码变化 -> 新 sha 与旧 sha 不同 -> 重走 §7.4 -> 成功后整体替换。
- 用 `key={sha}` 强制重挂载：否则旧组件的 `useState`/`useMemo` 内存态会与新代码混在一起，出现"改了代码但行为没变"的幽灵。
- 卸载只移除 React 树；动态 import 的模块由浏览器持有，**无法卸载**（§6.5）。
- 画布不允许定时器（§5.3），所以 `keepMounted` 被隐藏时不会产生后台开销。

### 7.6 错误边界、加载态、空态、自动重载

- **错误边界**：画布外一层 error boundary，捕获渲染期异常并渲染错误卡（§15.2）。边界同样带 `key={sha}`，让修好后的新代码能重试。
- **加载态**：骨架条（几行灰块），不要全屏转圈。
- **空态**：画布目录页列出发现的画布；没有画布时给"新建画布"按钮（走 `startTurn` 让 agent 调 `canvas_new`，或直接提供工具入口）。
- **自动重载**：文件保存 -> watch 信号 -> 重编译；信号复用内置文档预览已实现的自动重载路径（`dsh-api-workspace-files` 的 watch）。大文件连续保存抖动时提供"暂停自动重载"开关。

## 8. 套件 `dsh/canvas` API（核心交付物）

### 8.1 设计原则

1. **零依赖、零 CSS 文件**：所有样式来自宿主 CSS 变量（§8.8）。套件的实现只依赖 React（平台模块表提供）。
2. **token 是唯一共享**：token 改名最多让外观退化，**永远不会让画布崩**。绝不引用宿主 class 名。
3. **只加不减**：套件 API 与画布文件长期共存于用户磁盘；删/改签名会毁掉已存在的画布。弃用走三步：文档标注 → `W_DEPRECATED` 信号（**client 渲染期**提示，不是编译诊断）→ 至少两个 minor 版本后才移除。
4. **语义优先**：组件暴露 `tone`（语义）而不是颜色；暴露 `size` 档位而不是像素。
5. **受控 + 无状态默认**：所有组件都是受控组件（`active`/`open` 由调用方给），套件内部不藏状态（`CollapsibleSection` 的 `defaultOpen` 是唯一例外，且仅用于非受控便利）。

### 8.2 布局组件

| 组件 | Props | 说明 |
|---|---|---|
| `Stack` | `gap?: number = 12; align?: "start"\|"center"\|"end"\|"stretch"; children` | 纵向 flex |
| `Row` | `gap?: number = 8; wrap?: boolean; align?; justify?: "start"\|"center"\|"end"\|"space-between"; children` | 横向 flex |
| `Grid` | `columns?: number \| string = 2; gap?: number = 16; align?; children` | `columns` 支持 CSS 值（如 `"minmax(0, 1.1fr) minmax(0, 0.9fr)"`，Cursor 就是这么用的） |
| `Divider` | 无 | 1px 分隔线，用边框 token |
| `CollapsibleSection` | `title: string; count?: number; trailing?: ReactNode; defaultOpen?: boolean; children` | 折叠区；`count` 渲染成尾随徽标 |

### 8.3 排版组件

| 组件 | Props | 说明 |
|---|---|---|
| `H1` / `H2` | `children` | 两级标题；字号取宿主标题档位 |
| `Text` | `size?: "small"\|"md"\|"large"; weight?: "normal"\|"semibold"; tone?: Tone \| "secondary"\|"tertiary"\|"primary"; children; style?` | 正文 |
| `Code` | `children` | 等宽；用于文件路径、命令、标识符 |

> `tone` 与 `size` 是两条独立轴：`tone` 管颜色，`size` 管字号。`"secondary"/"tertiary"` 只是 `tone` 的别名便利值，映射到 neutral 的两个弱化档。

### 8.4 容器组件

| 组件 | Props | 说明 |
|---|---|---|
| `Card` | `children` | 带边框/圆角的卡片，圆角取宿主 radius 档 |
| `CardHeader` | `trailing?: ReactNode; children` | 标题行，`trailing` 右对齐（放 Pill/Button） |
| `CardBody` | `children` | 卡片内容区（内边距） |
| `Callout` | `tone?: Tone = "info"; title?: string; children` | 提示块；`tone="danger"` 同时用于"编译错误卡"形态 |

### 8.5 数据组件

这四个是画布的价值所在，也是 Cursor 那份代码里用得最多的。

**`Stat`** — `{ value: string \| number; label: string; tone?: Tone; hint?: string }`
单个指标块：大号 `value` + 小号 `label`。

**`Table`** — 对标 Cursor 的 API（这套设计得好，直接沿用）：

~~~ts
{
  headers: ReactNode[];
  rows: ReactNode[][];
  columnAlign?: ("left" | "right" | "center")[];
  rowTone?: Tone[];            // 每行一个 tone，背景/文字着色
  striped?: boolean;
  stickyHeader?: boolean;
  onRowClick?: (index: number) => void;
  emptyText?: string;          // 默认 "No rows"
  maxRows?: number;            // 默认取 §5.5 的 300 软阈值
}
~~~

**`BarChart`** — `{ categories: string[]; series: { name: string; data: number[]; tone?: Tone }[]; beginAtZero?: boolean; height?: number = 240; stacked?: boolean }`
手写 SVG，不引第三方。P1 只做分组柱状图；线图/迷你趋势图放 P3（同为加性扩展）。

**`TodoList`** — `{ todos: { id: string; status: Status; content: ReactNode }[]; onTodoClick?: (todo) => void; dense?: boolean }`
`Status = "pending" | "in_progress" | "completed" | "cancelled"`（与 DSH 的 `todo_write` 状态集对齐，便于互操作）。行前是状态点/勾，`onTodoClick` 让整行可点。

### 8.6 控件

| 组件 | Props | 说明 |
|---|---|---|
| `Button` | `variant?: "primary"\|"secondary"\|"ghost" = "secondary"; size?: "sm"\|"md"; disabled?; pending?: boolean; onClick?: () => void \| Promise<void>; children` | `pending` 时禁用并显示进行中；`onClick` 返回 Promise 时自动进入 pending（这是动作桥的主要入口） |
| `Pill` | `active?: boolean; size?: "sm"\|"md"; tone?: Tone; onClick?: () => void; children` | 用于筛选条；`active` 高亮 |

### 8.7 钩子

~~~ts
useCanvasState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void]
useCanvasOverlay<T extends { id: string }>(key: string, rows: readonly T[]): OverlayApi<T>
useCanvasAction(): (action: CanvasAction) => Promise<ActionResult>
useHostTheme(): HostTheme
useCanvasResource(path: string): { status: "loading" | "ready" | "error" | "none"; text?: string; error?: string }
useMemo                                 // 直接 re-export React.useMemo
~~~

`useState` / `useEffect` / `useCallback` / `useRef` 一律经 `dsh/canvas` re-export（与 Cursor 的 `useMemo` 做法一致），这样画布文件只有一行 import。

**所有接受数组的 prop 都接受 readonly 数组**（`readonly T[]`）。这是硬约定：`export const DATA = {...} as const` 产出只读字面量类型，若 prop 要求可变数组，**每一个画布**都得写 `as unknown as` 双重转换。附录 A 原先就是这么写的，现已去掉。

### 8.8 tone → 语义映射

套件内部只认语义 tone，具体颜色由实现期从宿主 token 解析，**不硬编码色值、不在文档里写死 token 名**（实现时用 `cordis_inspect_query` 的 `Theme` 查询确认）：

| tone | 语义 | 典型用途 |
|---|---|---|
| `neutral` | 中性/未知 | "no occ ref"、归档 |
| `info` | 信息 | "ours" 系列、提示 |
| `success` | 通过 | 门禁绿、已完成 |
| `warning` | 需注意 | 偏差、进行中、超软阈值 |
| `danger` | 失败/回归 | 门禁红、编译错误 |

### 8.9 规模与虚拟化

- `Table`/`TodoList` 超过 `maxRows`（默认 300）时**截断**并在末尾渲染一行 "showing N of M"；不实现真虚拟化（P1–P3），因为画布的正确用法本就是切片而非全量。
- 截断时在表格下方渲染一行「showing N of M」文案（**渲染期**，不是诊断，`canvas_check` 看不到）——提醒作者该拆画布或该用筛选。
- `BarChart` 超过 40 个 category 时只渲染前 40 并提示。

### 8.10 类型定义草案（`dsh/canvas`）

~~~ts
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Status = "pending" | "in_progress" | "completed" | "cancelled";

export type CanvasAction =
  | { type: "openResource"; address: string; params?: Record<string, unknown> }
  | { type: "openFile"; path: string; line?: number }
  | { type: "startTurn"; prompt: string; newSession?: boolean }
  | { type: "runCommand"; id?: string; command?: string; title?: string; cwd?: string }  // id 与 command 恰给其一
  | { type: "copy"; text: string }
  | { type: "overlaySet"; key: string; id: string; patch: Record<string, unknown> }
  | { type: "overlayClear"; key: string; id?: string }
  | { type: "notify"; tone: Tone; message: string };

export type ActionResult =
  | { ok: true; detail?: string }
  | { ok: false; code: "denied" | "unsupported" | "failed"; message: string };

export interface OverlayApi<T> {
  items: T[];                       // 源数据 + overlay 合并后的结果
  get(id: string): T | undefined;
  set(id: string, patch: Record<string, unknown>): Promise<void>;   // 故意不约束：补丁是运行时浅合并
  clear(id?: string): Promise<void>;
  pending: boolean;                 // 有未落盘改动
}

export interface HostTheme {
  dark: boolean;
  tone(t: Tone): string;            // 解析后的颜色（token 变量或值）
  text: { primary: string; secondary: string; tertiary: string };
  space(n: number): string;
}
~~~

---

## 9. 钩子语义与 sidecar

### 9.1 `useCanvasState` —— 纯 UI 态

- 存储：`localStorage`，键空间 `dsh.canvas.<canvasId>.<key>`，`canvasId` = 画布绝对路径的短哈希。
- 作用域：**跨会话共享**（同一画布的所有会话看同一个筛选器），这是刻意的——筛选器是用户偏好，不是会话状态。
- 生命周期：仅当值 `!==` 初始值时才写；键在校验失败时清除（与 sidebar-right 的 localStorage 容错策略一致）。
- **明确语义：agent 看不到它。** 文档、脚手架注释、skill 三处都要写清。想让人机一致用 `useCanvasOverlay`。

### 9.2 `useCanvasOverlay` —— 对 agent 可见的人机共享状态

这是 D3（内联数据）必须补的机制，也是 Cursor 代码里提到但没有规范化的 "canvas sidecar"。

**问题陈述**：画布把数据内联在源文件里。人点一下"标记完成"：

| 做法 | 后果 |
|---|---|
| 只写 localStorage | agent 看不到，人机不一致——正是用户抱怨的"编排混乱" |
| 改写源文件 | 触发重编译；需要 AST 级改写；并发编辑冲突 |
| **sidecar overlay（选中）** | 人写的改动落在源文件旁边的独立 JSON；agent 通过 `canvas_read` 读到；需要时用工具合并回源文件 |

**文件**：同目录 `.canvas/<stem>.state.json`

~~~json
{
  "version": 1,
  "canvas": "specs/board.canvas.tsx",
  "sourceSha1": "9f2c...",
  "updatedAt": "2026-09-21T14:02:11+08:00",
  "overlays": {
    "tasks": {
      "t80": { "status": "in_progress", "at": "2026-09-21T14:02:11+08:00", "by": "user" },
      "t87": { "pinned": true, "at": "2026-09-21T14:01:03+08:00", "by": "user" }
    }
  }
}
~~~

**语义**：

1. `overlays[key][id]` 是**对 `DATA[key]` 对应项的补丁**（浅合并）。
2. `useCanvasOverlay("tasks", DATA.tasks)` 返回合并后的 `items`——画布代码只读 `items`，不关心补丁来自哪。
3. `set(id, patch)` 走动作桥 `overlaySet` 落盘（不是 localStorage），所以 agent 读得到。
4. `sourceSha1` 记录写入时的源文件哈希。**源文件变化后不自动丢弃 overlay**（人的标注往往仍然有效），但 `canvas_read` 会同时返回 `staleOverlay: true` 让 agent 知道该复核。若某个 `id` 在新源码里已不存在，该条 overlay 被标记为 `orphan` 而非删除。
5. **合并回源文件**由 agent 决定：`canvas_state_merge` 工具（§11.4）把指定 overlay 写成源文件里 `DATA` 的对应字段，并从 sidecar 移除。这样"源文件是唯一持久真相"这条 DSH 原则得到保持，sidecar 只是暂存区。
6. sidecar 与源文件一起进 git（不是隐藏状态）；`.canvas/` 目录可被 `.gitignore` 忽略，但默认不忽略。

### 9.3 `useCanvasAction` 协议

- 返回一个函数，签名 `(action: CanvasAction) => Promise<ActionResult>`。
- 每个动作都经 host（Remote 调用）执行，**画布代码自己不能直接做这些事**。
- 失败返回 `{ok:false, code}` 而不是抛异常，方便画布渲染错误提示。
- 具体动作表与权限见 §10。

### 9.4 `useHostTheme`

返回 §8.10 的 `HostTheme`。绝大多数组件不需要它（它们内部用 CSS 变量）；它主要服务两处：

1. 内联 SVG（`BarChart` 的 series 颜色）需要在属性上用具体值，而不是在 CSS 里；
2. 画布自定义的少量美术元素（DSH 规则允许"美术可用自有颜色"）。

---

## 10. 动作桥（host 侧）

### 10.1 动作表

| 动作 | 权限 | 实现 | 审计 |
|---|---|---|---|
| `openResource` | 免确认 | 复用右栏 tab 导航（`ctx.sidebarRight.openResource` 的 host 侧对应物） | 无 |
| `openFile` | 免确认 | 转成 `dsh-resource://file/session/<sid>/<path>` 后打开 | 无 |
| `startTurn` | 免确认，但有限流 | 见 §10.3 | 写会话（可见） |
| `runCommand` | **受 permission preset 约束** | 见 §10.4 | 写会话 + 记录命令与退出码 |
| `copy` | 免确认 | 前端剪贴板 | 无 |
| `overlaySet` / `overlayClear` | 免确认 | 写 sidecar（§9.2） | 记人机改名时间戳 |
| `notify` | 免确认 | 前端提示条 | 无 |

**默认拒绝未知动作类型**（`unsupported`），不做"向前兼容地忽略"。

### 10.2 `openFile` / `openResource`

- 地址语法已核实：`dsh-resource://file/session/<sessionId>/<path>`（`FILE_ADDRESS_PREFIX = "dsh-resource://file/"`）。
- `openFile` 只是把工作区相对路径补成完整资源地址，然后交给右栏导航；`line` 作为 `params` 传下去（文本预览已支持 `{ line }`）。
- 画布不该自己拼地址；`openFile({ path, line })` 是唯一入口，避免画布与地址语法耦合。

### 10.3 `startTurn`

这是"画布能回灌 agent"的核心。语义：

- `newSession: false`（默认）：向**当前会话**追加一条用户消息，等同用户在输入框敲了这段话。
- `newSession: true`：新建会话（Cursor 的 `newComposerChat` 语义），用于"把这条任务拿到干净的上下文里做"。
- **防点火**：同一画布 + 同一 `prompt` 在 30 秒内只接受一次；连续超过 N 次/分钟返回 `denied` 并提示。防止画布里的循环渲染或误点把会话刷爆。
- **必须可审计**：追加的消息带来源标记（画布路径 + 动作 id），使会话日志能回答"这条消息是哪个按钮触发的"。
- 提示词由画布提供。脚手架会生成一个规范模板（含"遵守 OCCT 门禁"这类项目约束占位），但**不硬编码项目规则**（D2：通用插件）。

### 10.4 `runCommand`

- 命令必须命中插件 `Config` 里的白名单（默认空 = 全部拒绝）。
- 白名单项形如 `{ id, title, command, cwd?, timeoutMs? }`；画布只能按 `id` 或完整命令字符串请求，且请求必须逐字匹配。
- 执行遵守 permission preset（`read-only` / `workspace-write` / `danger-full-access`）；被拒时返回 `{ok:false, code:"denied"}`，画布可显示"需提权"。
- 结果（退出码、耗时、输出尾部、spill 路径）作为证据记录，**这正好是 §7.3 里"证据来自 harness 而非模型自述"的落点**：画布按钮跑门禁 → 真实退出码进 sidecar/会话 → 画布 chip 变绿或变红。

### 10.5 审计

所有非免确认动作在 host 侧写一条结构化记录（`canvas/action`，走会话事件或 storage，取决于实现期确认哪条通道可用）。格式：

~~~json
{ "canvas": "specs/board.canvas.tsx", "action": "runCommand", "id": "gate:phase19",
  "at": "...", "ok": true, "detail": "exit 0 in 41.2s" }
~~~

---

## 11. 模型侧工具

四个工具，都用 `ctx.tools.register(defineTool({ name, description, parameters, output, execute, presentCall }))` 注册（形状已从 `dsh-tool-todo` 核实）。

### 11.1 `canvas_new`

- 入参：`{ path: string; title: string; description?: string; kind?: "blank" | "board" | "gates" }`
- 行为：写一个可编译、可渲染的脚手架文件（含 §5.2 元数据头、§5.4 的 `export const DATA` 形状、§8 组件的示例用法）。
- 返回：`{ path, diagnostics: [] }`。
- 价值：把"套件 API 记不记得住"从 agent 的记忆问题变成一次文件拷贝。`kind` 给三种常见形状的模板。

### 11.2 `canvas_check`

- 入参：`{ path: string }`
- 行为：读源码 → 静态扫描 + sucrase 编译 + `DATA` 抽取 → 返回 `CanvasDiagnostic[]`。
- **不渲染**，所以可以在 agent 自己改完立刻自检（符合 DSH 技能里"先装一个能工作的版本"的纪律）。
- `output.render` 用人话总结：`"board.canvas.tsx: 0 errors, 1 warning (W_LARGE_FILE at line 812)"`。

### 11.3 `canvas_read` —— 内联数据的补偿机制

- 入参：`{ path: string; dataPath?: string; filter?: Record<string, unknown>; ids?: string[]; limit?: number }`
- 行为：
  1. 抽取 `export const DATA`（`E_DATA_NOT_LITERAL` 时退化为返回源码文本 + `W_NO_DATA`）；
  2. 合并 sidecar overlay（§9.2），标记 `staleOverlay` / `orphan`；
  3. 按 `dataPath`（如 `"tasks"`）切片，按 `filter`（字段等值匹配）与 `ids` 过滤，按 `limit` 截断；
  4. 返回**结构化 JSON + 一份摘要统计**（每 status 计数、每 bucket 计数、超期项）。
- **这是整个设计里最重要的一条**：因为数据内联，agent 若不切片就必须全文重读（`_board.md` 的老路）。有了它，agent 的常规循环变成：`canvas_read(path, "tasks", {status:"pending"})` 拿 12 条 → 干活 → 用普通文件编辑改那 12 条的 status → `canvas_check` 自检。**context 成本与文件总大小脱钩。**

**抽取实现（关键：不执行代码）**：

1. sucrase 变换（§6.2），得到 JS 文本；
2. 正则定位 `exports.DATA =` / `const DATA =` 的起始偏移（同时支持 `export default function` 之前的声明）；
3. **括号配对扫描**（字符串/注释/正则字面量状态机）找到字面量结束位置；
4. 宽容字面量解析（容忍尾逗号、单引号、无引号键、注释、`undefined`/`NaN`）；
5. 校验结果是纯 JSON 值；含函数/标识符引用则报 `E_DATA_NOT_LITERAL`。

**明确否决**：不在 host 用 `vm` 执行画布模块来取 ——那等于把 agent 写的任意代码放进宿主进程。`canvas_read` 必须能在"源码是恶意"的前提下安全运行。

### 11.4 `canvas_state_merge`

- 入参：`{ path: string; key?: string; ids?: string[] }`
- 行为：把 sidecar 里的 overlay 补丁写进源文件 `DATA` 的对应项，并从 sidecar 移除已合并条目。
- 编辑策略：**文本级定位 + 最小替换**（找到该 item 的字面量区间，只改被补丁覆盖的字段），而不是重新序列化整个 `DATA`——后者会把整文件重排，毁掉 diff。
- 返回：`{ merged: number, skipped: number, diagnostics }`。orphan 条目跳过并保留。

### 11.5 与 `present` 的配合

画布文件是普通文件，`present` 可直接交付（用户在卡片里点开就是画布 tab，因为 tab type 已认领 `*.canvas.tsx`）。不需要新的交付机制。

---

## 12. 技能与提示

### 12.1 `canvas` skill 结构（渐进披露）

~~~text
skills/canvas/
  SKILL.md                     # 何时写画布、五步流程、反模式
  references/kit.md            # §8 的完整 API（props、tone、示例）
  references/patterns.md       # 看板/门禁/时间线/对比四类画布范式
  references/troubleshooting.md# 诊断码 → 修法
  templates/board.canvas.tsx   # 与 canvas_new kind:"board" 同源
  templates/gates.canvas.tsx
~~~

`SKILL.md` 正文要点（草案）：

1. **何时用画布**：用户要看"多项状态 + 多次更新 + 需要交互下钻"时；单条结论用正文，短任务用 `todo_write`。
2. **五步流程**：`canvas_new` 建脚手架 → 填 `DATA`（只填数据，不写渲染）→ 需要时改渲染 → `canvas_check` 自检 → 打开 tab 看。
3. **保持小的纪律**：`DATA` 是唯一会长大的部分；渲染代码超 400 行就该拆画布；note 字段超过约 120 字应改为引用（`crates/...:476` 或证据 id）而不是粘贴全文。
4. **人机一致**：人的交互写 `useCanvasOverlay`（agent 可见）；`useCanvasState` 只放筛选器等纯 UI 态。
5. **反模式清单**（见 §12.3）。

### 12.2 system prompt section（草案）

> 长任务与多状态工作用画布文件（`*.canvas.tsx`）作为对外产物，而不是往对话里贴大段 markdown 或维护巨型 specs 文档。
> 建新画布用 `canvas_new`；改完必须 `canvas_check`；**不要全文重读画布**，用 `canvas_read` 取切片。
> 画布里的数据放 `export const DATA`，渲染代码从 `DATA` 取值。人的点击通过 `useCanvasOverlay` 落盘，你在下一轮应把它当作人的指令看待。

（这段是**通用**建议，不含任何本仓规则；项目规则仍由各自的 `CLAUDE.md` / rules 文件提供。）

### 12.3 反模式清单

| 反模式 | 为什么坏 | 正确做法 |
|---|---|---|
| 把 300+ 条任务全内联，note 粘贴几万字 | 文件长成第二个 `_board.md`，每次编辑都是全文重写 | 内联只保留"当前窗口"（未完成 + 最近完成），历史进 `canvas_state_merge` 后的源文件或另一画布 |
| 用画布当日志 | 日志是 append-only，画布是状态快照 | 日志用文件；画布只显示"最近 N 条" |
| 在画布里做业务逻辑（算门禁、调命令） | 逻辑藏在 UI 里，agent 复用不了 | 逻辑在工具/harness；画布只显示与触发 |
| `useState` 存应当持久的状态 | 刷新即丢 | `useCanvasState`（UI 态）/ `useCanvasOverlay`（共享态） |
| 多个画布互相复制数据 | 双源漂移 | 一个画布一个数据源；跨画布引用用 `openFile` 链接 |
| 自定义 CSS/颜色 | 主题切换就崩 | 只用 `tone`/`size`；美术元素才用 `useHostTheme()` |

## 13. 安全模型

信任级别：**画布代码 = 插件代码**（都是用户/agent 写入并被执行的前端代码）。因此安全设计的重点不是"防住画布"，而是"把画布能碰到的东西收窄到最小"。

| 面 | 措施 |
|---|---|
| 模块 | 编译期只允许 `dsh/canvas`；实现里对 §6.3 的改写做**反向校验**（改写后若仍存在非白名单 `require`，直接拒绝编译，而不是只信任改写器） |
| 网络 | 不注入 `fetch/XMLHttpRequest/WebSocket`；静态扫描拦 `http(s)://` 字面量与 `<iframe>` |
| 存储 | 不注入 `localStorage`/`indexedDB`；钩子是唯一入口，且键空间前缀固定 |
| DOM | 不提供 `document`/`window` 句柄；扫描拦 `document.`/`window.` 用法 |
| 宿主进程 | `canvas_read`/`canvas_check` **绝不执行画布代码**（§11.3）；编译只需 sucrase（纯函数变换） |
| 命令 | 白名单 + permission preset（§10.4） |
| 提权 | 画布无权请求提权；`denied` 只能由人另行操作 |
| 资源耗尽 | §5.5 体积/行数硬阈值；§8.9 渲染行数上限；§10.3 动作限流；编译超时（例如 2s）即拒绝 |

**残留风险（明确接受）**：画布代码可以在浏览器里做任意计算（死循环、吃内存）。前端沙箱只能靠渲染行数上限与页面自身的可恢复性缓解；不引入 iframe/Worker 隔离（§6.8）。

---

## 14. 性能预算

| 环节 | 预算 | 手段 |
|---|---|---|
| 编译（sucrase，单文件 ≤128 KB） | < 50 ms | 内容哈希命中即跳过；命中率接近 100% |
| 保存 → 面板更新（本机） | < 400 ms | watch 信号 → 编译 → 新 URL → import → 重挂载 |
| 首次打开画布 | < 300 ms | 模块与源码并行取；先渲染"骨架"再挂载 |
| 单个画布渲染（300 行内） | < 16 ms/帧无长任务 | 无虚拟化时靠上限；禁止在渲染期做 O(n²) |
| 内存 | 每画布 ≤ 18 MB，每会话 ≤ 32 MB（§5.5 上限） | 超限报 `W_LARGE_FILE` |

**新会话的特别约束**：因为不存在 `canvas_*` 新事件类型（DSH 不允许新增会话事件），画布的持久化只能落在**文件 + sidecar + storage**。这是设计约束，不要在实现期试图往会话日志里塞画布状态（那会让会话打不开）。

---

## 15. 可观测性与诊断

1. **诊断三出口**：`canvas_check`（agent）、tab 错误卡（人）、host 日志（排查）。同一 `CanvasDiagnostic` 结构。
2. **错误卡内容**：诊断码 + 人话 + 文件名:行:列 + 该行源码片段 + hint；另给"在编辑器中打开"和"让 agent 修"两个按钮（后者走 `startTurn` 并带上诊断文本）。
3. **运行时崩溃**：React error boundary 兜住画布组件；卡片显示错误消息与组件栈（生产构建下栈会不全，因此同时打印到浏览器控制台）。**画布崩溃不得影响宿主页面**。
4. **重载语义**：面板头部给"重新编译"按钮；文件保存自动重编译（可用开关关掉，用于大文件编辑中的抖动）。
5. **诊断不静默**：任何 `W_*` 都要在 tab 上可见（例如右上角一个 warning 徽标 + 悬浮列出），否则 agent 永远不会知道自己在写巨型文件。

---

## 16. 目录与文件清单

> **已独立成库（2026-09-28）**：`D:\source\repos\dsh-canvas\` —— 本库根即插件根，本文档即 `DESIGN.md`。此前暂放在 `dogs/tools/dsh-canvas/` 与 `dogs/specs/_design_canvas_plugin.md`（因当时会话载体在 dogs，且与 OCCT 无关）。宿主接线见 §14「实现状态」。

~~~text
dsh-canvas/                         # 单包双半（P0 单包；拆两包是后续选项）
  package.json                      # dsh.bundle.patch + dsh.client + dependency: sucrase
  cordis.patch.yml                  # 插入 host 行 dsh-canvas，config 列硬阈值与命令白名单
  INTERFACE.md                      # host/client 冻结契约
  index.js                          # host 入口：/canvas 路由 + 动作桥 + 三个 model 工具
  host/                             # host 纯逻辑（node 可直接单测）
    compile.js                      #   sucrase 变换 + import 白名单 + 阈值 + 内容寻址
    scan.js                         #   静态禁止项扫描（blankNonCode 保持偏移）
    literal.js                      #   DATA 宽容字面量解析（不执行代码）
    diagnostics.js                  #   诊断码表与 lineCol
    overlay.js discovery.js store.js
  lib/client.js                     # browser 半边：套件 + 钩子 + tab type + 加载器（单文件）
  skills/canvas/                    # SKILL.md + references/{kit,patterns,troubleshooting}.md + templates/
  examples/selfcheck.canvas.tsx     # 用满套件的自检画布
  test/                             # core.test.mjs / serve.test.mjs / templates.test.mjs
  locale/{en,zh}.json   icon.svg
~~~

说明：client 半边必须**单文件**——`window.__ModuleLoader__.load({ id, factory })` 的工厂只解析平台模块与声明的 externals，包内 chunk 需要构建期配合，而纯 JS 插件不值得引入构建步骤。

---

## 17. 实施计划

每阶段结束都要**真实跑一次**（打开页面看、改文件看刷新），不以"写了多少测试"作为完成标准——沿用 DSH 自己的插件技能纪律：**先把能工作的版本装上去，用它本身作为第一次预览**。

| 阶段 | 交付 | 验收（真实操作） | 估时 |
|---|---|---|---|
| **P0 管道打通** | host：compile + module-server + 最小静态扫描；client：tab type + 动态 import 挂载 + 错误边界；套件 v0：Stack/Row/Text/H1/H2/Code/Card\*/Divider/Callout/Button/Pill/Stat/Table/TodoList | 1) 在 workspace 放一个手写 `demo.canvas.tsx`，右栏 tab 打开即渲染；2) 改文件保存 → 面板自动更新；3) 故意写错语法 → 出错误卡带行列号；4) 明暗主题切换正常；5) 控制台无 `slot entry crashed` | 1–1.5 d |
| **P1 套件与钩子** | 套件补全（Grid/CollapsibleSection/BarChart + 全套 hooks）；`canvas_new/check/read`；`canvas` skill v1；guide 条目（画布目录 + 空态入口） | 1) `canvas_new` 生成的画布不经修改即可渲染；2) `canvas_check` 对错误/合法文件分别给出正确诊断；3) `canvas_read` 能只取 12 条 pending；4) 画布按钮 `openFile`/`startTurn` 生效且会话里能看到来源 | 1.5–2 d |
| **P2 overlay 与共享态** | `useCanvasOverlay` + sidecar 读写 + `overlaySet/Clear` 动作 + `canvas_state_merge` 工具 | 1) 画布点"标记进行中"→ 关闭页面重开仍在；2) `canvas_read` 能读到人的改动；3) 改源文件后 overlay 保留且被标 `staleOverlay`；4) merge 后源文件 diff 只动目标字段 | 1–1.5 d |
| **P3 动作权限与证据** | `runCommand` 白名单 + permission preset 集成 + 结果记录；画布 chip 显示真实退出码/计数 | 1) 白名单外命令被拒且画布显示"需提权"；2) 白名单内门禁跑完 chip 变绿；3) 故意让门禁失败 → 变红并给出日志入口 | 1–2 d |
| **P4 大文件与发现** | 阈值告警、截断提示、多画布索引画布模板、性能打磨（缓存命中率、重载抖动开关） | 1) 塞 2000 行触发 `W_LARGE_FILE` 且可见；2) 超 300 行截断提示正确；3) 连续 20 次保存无重复编译（hash 命中） | 1 d |
| **P5 迁移（本仓专属，可选）** | 把 `_board.md` 生成 `specs/board.canvas.tsx`（一次性脚本 + 人工复核）；`_board.md` 冻结为归档 | 1) 画布覆盖 §3 的全部在办任务；2) agent 一轮的 context 读取量用 `dsh-token-meter` 对比下降 | 1 d |

**P0 的两个必须实测项（风险最高的两处）**：
1. **动态 `import()` 是否被 CSP 允许**。不允许则立刻切 §6.7 的 ModuleLoader 备选路径，不要试图绕 CSP。
2. **`sucrase` 是否能装进 profile 并被 host 半边加载**（`install_bundle` 路径 + pnpm）。装不上则整个 D1 需要重估。

---

## 18. 测试与验证策略

| 层 | 做法 | 理由 |
|---|---|---|
| `extract-data`（状态机 + 宽容解析） | **写单元测试**（唯一被要求写测试的模块） | 它是安全边界：错了要么拒绝合法画布，要么把非字面量当数据；字符级边界（字符串/注释/正则/嵌套）靠人工看不可靠 |
| `scan.js` 禁止项 | 表驱动小测试 | 规则数量固定，回归风险低但便宜 |
| compile / diagnostics | 少量用例：合法、语法错、非法 import、缺 default、超阈值 | 错误码是契约，被 skill 文档引用 |
| 套件组件 | **不写组件单测**；用真实画布做验收 | 与 DSH 的"用插件本身作预览"一致；组件是视觉产物，快照测试价值低 |
| 端到端 | 每个阶段的人工验收清单（§17） | 这是唯一能证明"用户看得到"的层 |
| 回归 | 保留 3–4 个 `skills/canvas/templates/*.canvas.tsx` 作为"必须永远能编译"的语料；每次改套件或加规则后跑一遍 `canvas_check` | 防止套件加性演进时破坏既有画布 |

---

## 19. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | CSP 禁止动态 `import()` | 低 | 中 | §6.7 备选路径；P0 先实测 |
| R2 | `sucrase` 装不进 profile | 低 | 高（D1 失效） | P0 先实测；退路是改为随插件 vendor 一份压缩后的 sucrase |
| R3 | 画布文件重新长成巨石 | **高** | 高（就是用户现在的问题） | §5.5 阈值 + §11.3 切片读取 + §12.3 反模式 + 诊断可见化 |
| R4 | 套件 API 变更毁掉既有画布 | 中 | 中 | §8.1 只加不减 + `W_DEPRECATED` + 模板语料回归 |
| R5 | 人与 agent 状态不一致 | 中 | 高 | §9.2 overlay 落盘 + `canvas_state_merge` |
| R6 | `startTurn` 被滥用刷会话 | 中 | 中 | §10.3 限流 + 审计 + 来源标记 |
| R7 | `runCommand` 成为提权跳板 | 低 | 高 | §10.4 白名单 + preset + 逐字匹配 |
| R8 | 旧模块累积占内存 | 中 | 低 | §6.5 提示重载 |
| R9 | 画布与 DSH 版本耦合（`0.1.7-rc.2`） | 中 | 中 | 只用 `react` + 自建套件 + slot/资源两类稳定接口；不用 DSH client 包 |
| R10 | 通用插件与项目规则冲突（如 OCCT 门禁） | 低 | 低 | 项目规则由项目自己的 `CLAUDE.md`/rules 提供；画布模板留占位不硬编码 |

---

## 20. 未决问题（实现期需用 `cordis_inspect_query` / 读源码确认）

1. **CSP 与动态 import**（P0 阻塞项）。
2. **`useResource` 的返回结构**：已确认是"带 `status` 的活值"（预览代码里判 `meta.status !== "none"`），但字段名（`value`/`text`/`bytes`）需按 `dsh-client-resources` 的实际契约确认。
3. **host↔client 的 Remote 通道**：沿用 `dsh-api-remotes` + Typert 描述符，具体注册与方法名需确认。
4. **`openResource` 的 host 侧对应物**：右栏导航是 client-only 服务（`ctx.sidebarRight`），`openFile` 可能应实现为"client 侧直接调用 + 只把路径规范化放 host"，需在 P1 定。
5. **`startTurn` 的确切 API**：往当前会话追加用户消息的公开入口（`dsh-api-session-controller` / `dsh-client-ui-chat`）需确认，且要确认能否带来源元数据。
6. **`canvas/action` 审计记录的落点**：session event（不允许新类型）/ storage / 普通日志文件，三选一。
7. **`.canvas/` 目录命名**是否与用户既有习惯冲突（本仓已有 `.target-gate/`、`.codegraph/`、`.cursor/` 等点目录）。

---

## 附录 A：改写后的示例画布（DSH 版）

用户的 `StepObjRemaining` 精简改写，演示本设计的关键点：元数据头、`export const DATA` 纯字面量、`useCanvasOverlay` 共享态、`useCanvasAction` 回灌、`Table` 的 `rowTone`/`columnAlign`。

~~~tsx
/** @canvas
 * title: STEP to OBJ remaining gaps
 * description: 未完成任务的监控清单
 * icon: board
 */
import {
  H1, H2, Text, Code, Stack, Row, Grid, Divider, Card, CardBody, CardHeader,
  Callout, Stat, Table, BarChart, TodoList, Pill, Button, CollapsibleSection,
  useCanvasState, useCanvasOverlay, useCanvasAction, useMemo,
} from "dsh/canvas";

type Status = "pending" | "in_progress" | "completed" | "cancelled";
type Bucket = "hit" | "shared" | "parked";

export const DATA = {
  models: [
    { stem: "Shape",    oursV: 6140, oursF: 11352, occV: 6150, occF: 11372 },
    { stem: "Shape-1",  oursV: 3327, oursF: 4266,  occV: 3343, occF: 4336 },
    { stem: "linkrods", oursV: 3505, oursF: 5096,  occV: 3494, occF: 5078 },
    { stem: "Offset",   oursV: 712,  oursF: 892,   occV: null, occF: null },
  ],
  tasks: [
    { id: "t323", title: "未移植的极值搜索窗口", bucket: "hit",
      status: "pending", occt: "ShapeAnalysis_Surface.cxx:1340-1352",
      rust: "crates/occt-topo/src/pcurve_full/p01.rs",
      hits: "Shape", goal: "把窗口扩张分支移植进 value_of_uv", note: "见 t323" },
    { id: "t326", title: "face_uv_bounds 返回自然域", bucket: "hit",
      status: "pending", occt: "BRepTools::UVBounds",
      rust: "crates/occt-topo/src/brep_surface.rs:306",
      hits: "BOP", goal: "按调用点分别判定域", note: "见 t326" },
    { id: "t6", title: "Offset.step 目视 vs 解析面", bucket: "hit",
      status: "pending", occt: "BRepMesh_Deflection.cxx:126",
      rust: "export_data_obj", hits: "Offset",
      goal: "无 occ 参考，只做目视", note: "见 t6" },
  ],
} as const;

const TONE: Record<Status, "neutral" | "warning" | "success" | "danger"> = {
  pending: "neutral", in_progress: "warning", completed: "success", cancelled: "danger",
};

function label(s: Status) {
  if (s === "completed") return "done";
  if (s === "in_progress") return "active";
  if (s === "cancelled") return "cancelled";
  return "todo";
}

export default function StepObjRemaining() {
  const dispatch = useCanvasAction();
  const [filter, setFilter] = useCanvasState("filter", "open" as "open" | "all");
  const [activeId, setActiveId] = useCanvasState("active", "t323");
  const overlay = useCanvasOverlay("tasks", DATA.tasks);

  const merged = useMemo(
    () => overlay.items.map((t) => ({ ...t, status: (t.status ?? "pending") as Status })),
    [overlay.items],
  );
  const open = merged.filter((t) => t.status === "pending" || t.status === "in_progress");
  const visible = filter === "open" ? open : merged;
  const active = merged.find((t) => t.id === activeId) ?? open[0];
  const withOcc = DATA.models.filter((m) => m.occF !== null);

  return (
    <Stack gap={24}>
      <H1>STEP to OBJ remaining gaps</H1>
      <Text tone="secondary">
        对齐基线见 <Code>data/occ-*.obj</Code>，偏转 0.1。
      </Text>

      <Grid columns={3} gap={16}>
        <Stat value="8" label="Aligned models" tone="success" />
        <Stat value={String(open.length)} label="Open tasks" tone="warning" />
        <Stat value={String(overlay.items.length)} label="Tracked tasks" />
      </Grid>

      <Callout tone="warning" title="不要为单个 STEP 调参">
        网格管线是共享的。补 OCCT 的分支，保住既有基线。
      </Callout>

      <H2>Face count vs OCCT</H2>
      <BarChart
        categories={withOcc.map((m) => m.stem)}
        series={[
          { name: "ours faces", data: withOcc.map((m) => m.oursF), tone: "info" },
          { name: "occ faces",  data: withOcc.map((m) => m.occF ?? 0), tone: "neutral" },
        ]}
        beginAtZero height={220}
      />

      <Row gap={8} wrap>
        <Pill active={filter === "open"} onClick={() => setFilter("open")}>Open {open.length}</Pill>
        <Pill active={filter === "all"}  onClick={() => setFilter("all")}>All {merged.length}</Pill>
      </Row>

      <Grid columns="minmax(0, 1.1fr) minmax(0, 0.9fr)" gap={20} align="start">
        <Stack gap={12}>
          <H2>Supervision todos</H2>
          <TodoList
            todos={visible.map((t) => ({ id: t.id, status: t.status, content: t.title }))}
            onTodoClick={(todo) => setActiveId(todo.id)}
          />
          {filter === "all" ? (
            <CollapsibleSection title="Archived" count={0} trailing={<Text size="small" tone="tertiary">历史不进默认视图</Text>}>
              <Text size="small" tone="tertiary">见 specs 归档。</Text>
            </CollapsibleSection>
          ) : null}
        </Stack>

        {active ? (
          <Card>
            <CardHeader trailing={<Pill size="sm" tone={TONE[active.status]}>{label(active.status)}</Pill>}>
              {active.id.toUpperCase()}
            </CardHeader>
            <CardBody>
              <Stack gap={12}>
                <Text weight="semibold">{active.title}</Text>
                <Text>{active.goal}</Text>
                <Text size="small">Hits: <Code>{active.hits}</Code></Text>
                <Text size="small">OCCT: <Code>{active.occt}</Code></Text>
                <Text size="small">Write: <Code>{active.rust}</Code></Text>
                <Divider />
                <Row gap={8} wrap>
                  <Button
                    variant="primary"
                    onClick={() => dispatch({
                      type: "startTurn",
                      prompt: "处理 " + active.id + ": " + active.title + "\nOCCT: " + active.occt +
                              "\n写入: " + active.rust + "\n目标: " + active.goal +
                              "\n遵守项目门禁；不改共享管线以外的东西。",
                    })}
                  >
                    Start in chat
                  </Button>
                  <Button onClick={() => overlay.set(active.id, { status: "in_progress" })}>Mark active</Button>
                  <Button variant="ghost" onClick={() => overlay.set(active.id, { status: "completed" })}>Mark done</Button>
                  <Button variant="ghost" onClick={() => dispatch({ type: "openFile", path: active.rust })}>Open file</Button>
                </Row>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
      </Grid>

      <Table
        headers={["STEP", "ours v/f", "occ v/f", "face delta"]}
        columnAlign={["left", "right", "right", "right"]}
        striped stickyHeader
        rows={DATA.models.map((m) => {
          const delta = m.occF === null ? "no occ ref" : (m.oursF - m.occF > 0 ? "+" : "") + String(m.oursF - m.occF);
          return [m.stem, m.oursV + "/" + m.oursF, m.occV === null ? "—" : m.occV + "/" + m.occF, delta];
        })}
        rowTone={DATA.models.map((m) => (m.occF === null ? "neutral" : m.oursF === m.occF ? "success" : m.oursF > m.occF ? "warning" : "danger"))}
      />
    </Stack>
  );
}
~~~

**与用户原版的差异（都是有意的）**：

| 差异 | 原因 |
|---|---|
| 数据进 `export const DATA` 且是纯字面量 | §5.4 / §11.3：让宿主能安全抽取切片，agent 不必全文重读 |
| 状态走 `useCanvasOverlay` 而不是 `useCanvasState` | §9.2：人的点击对 agent 可见 |
| 删掉内联的超长 `note` 正文 | §12.3：note 超长改为引用（`见 t323`） |
| `Archived` 变空壳 | 内联只保留当前窗口；历史不该住在画布里 |
| 按钮多一个 `openFile` | 演示动作桥的两个方向：给 agent 下指令 / 给自己开文件 |

---

## 评审请求（四项裁决已由 §21 记录，本节保留作决策痕迹）

请就以下四点给出结论，然后即可开工 P0：

1. **§5.4 的 `export const DATA` 约定**是否接受（这是 D3 内联方案能成立的前提）。
2. **§9.2 的 sidecar overlay** 语义是否接受（人的点击落盘 + agent 可读 + 可合并回源文件）。
3. **§10.3 的 `startTurn` 默认打当前会话**是否正确（对照 Cursor 的 `newComposerChat` 默认开新会话）。
4. **§16 的开发位置**：**已定为独立目录 `D:\source\repos\dsh-canvas\`**（2026-09-28 迁出；引导期曾放 `dogs/tools/dsh-canvas/`）。



---

## 21. 裁决与修订记录（实现后审计提出的 16 项）

实现完成后对文档与代码做了一次对账，提出 16 项不一致。以下逐条记录裁决，**文档与代码已按裁决改完**（记录保留以便回溯）。

| # | 问题 | 裁决 | 落地 |
|---|---|---|---|
| A1 | `runCommand` 形状在 §8.10 / INTERFACE §4 / §10.4 三处不一致 | 取并集 `{ id?, command?, cwd?, title? }`，**id 与 command 恰给其一**；INTERFACE 为准 | 文档已改；实现仍整体拒绝（P3） |
| A2 | `useCanvasOverlay` 的 `initial: T[]` 逼每个画布写双重 cast | 改为 `rows: readonly T[]`，并定下**所有数组 prop 接受 readonly** | 文档已改；附录 A 已去掉 cast |
| A3 | overlay 补丁类型 `Partial<T>` 受 `as const` 字面量类型限制 | 改为 `Record<string, unknown>`（运行时本就是浅合并） | 文档已改 |
| A4 | `Divider` 无方向语义，却在 `<Row wrap>` 里当分隔用 | 加 `orientation?: "horizontal" \\| "vertical"`（默认 horizontal，加性变更） | **代码已实现** |
| D1 | 附录 A 示例 JSX 不闭合（`<Stack>` 被 `</Card>` 关闭） | 真 bug；并用真实编译器验证附录可编译 | 文档已改 + **已验证**（157 行、0 警告） |
| D2 | `E_REACT_IMPORT` 在 §5.3 出现却不在 §6.6 联合里 | 删掉该码：白名单只有 `dsh/canvas`，react 也归 `E_PARSE_IMPORT` | 文档已改（实现本就如此） |
| D3 | `W_UNKNOWN_PROP` 在联合里但没有任何检查 | 移出联合，标记 reserved（需要组件 prop 表，未实现） | 文档 + CODES 注释 |
| D4 | `W_DEPRECATED` 被 §8.1/§19 当弃用通道却不在联合里 | 保留名字，但归类为 **client 渲染期信号**，不是编译诊断 | 文档已改 |
| D5 | `W_MANY_ROWS` 是渲染期条件，却挂在编译期诊断管线上 | 移出联合：截断只渲染「showing N of M」文案 | 文档已改 |
| D6 | package.json 声明 `./src/*` 但没有 `src/`；§16 目录树与实际布局冲突 | 删掉该 export；§16 重写为真实布局 | **已改** |
| D7 | §12.1 说四步却列五步；技能树只列两个模板 | 改为五步；模板补 `blank` | 文档已改 |
| D8 | `@canvas` 的 `icon` 没有允许值集合与回退规则 | 自由字符串；**当前 client 不渲染图标**，字段保留备用 | 文档已改 |
| D9 | §5.5 软阈值未进 Config，但行文暗示全部可配 | 软阈值是**内建常量**（建议性）；硬阈值才是 Config 键 | 文档已改 |
| D10 | `maxRenderRows` 是 Config 键，但 client 硬编码 300，配置形同虚设 | client 经 `GET /canvas/api` 取 limits，Table 的硬上限用它 | **代码已实现** |
| D11 | 诊断有两个产出方（编译期 host / 渲染期 client）从未写明 | §6.6 增加「产出方」小节，列出各自可见的码 | 文档已改 |
| D12 | 子代理只能静态验证（当时本机无 sucrase） | 已在包内装 sucrase；`test/templates.test.mjs` 用真实编译器验证 3 模板 + 样例 | **已实现并通过** |

### 尚未闭环的事（不要当成已完成）

- **`startTurn` 的 prompt 请求体形状**：按 `dsh-api-session-controller` 源码推断，未经真实 agent 验证；形状不符会返回 `{ok:false,code:"failed"}` 而不是崩溃。
- **浏览器渲染**：本会话无浏览器控制能力。client 半边只有语法检查与注册契约一致性，**没有目视验证**。
- **`runCommand`**：设计归 P3，实现当前整体拒绝，不执行任何命令。
- **react 严格性**：当前拒绝（与文档一致）。放开是一行改动——模块包装器已把 `require("react")` 解析到宿主同一实例。

### 实现状态（2026-09-28）

- 插件在 `D:\source\repos\dsh-canvas\`（2026-09-28 从 `dogs/tools/dsh-canvas/` 迁出），已进 web profile：`dsh plugin --profile web add <dir>` 一次完成依赖安装 + bundle 选择（`link:`，改代码即生效）。宿主侧的 `link:` 与 `node_modules\@local\dsh-canvas` junction 已改指新目录。
- host 半边**已在运行中的 GUI 上实测**：`/canvas/api`、`/compile`、`/module/<sha>.js`、`/source`、`/action`、overlay 全部 200 且行为正确。
- 三套测试：`core 15/15`、`serve 13/13`（含「送出的模块能在 Node 里 import 并调用组件」）、`templates 4 compiled / 0 broken`。
- 待办：**重启 GUI** 激活 client bundle（`/plugins/@local/dsh-canvas/client.js` 现为 404：运行中的页面在插件安装前已组合模块图）与工作区根解析修正。

### 补充：DSH 工具 schema 的两条硬约束（实证）

1. **每个 object 类型的 schema 节点必须显式声明 `additionalProperties`**（`true` 或 `false`）。缺失时 `defineTool` 的校验器会拒绝整条工具定义，报 `unsupported JSON schema: ... must be explicitly true or false`。本次命中两处：诊断项的 `items`（→ `false`，因为 `mk()` 只产出 code/severity/message/line/col/hint）与 `canvas_read` 的自由筛选器 `filter`（→ `true`）。
2. `defineTool` 返回的是**普通对象、不带 brand symbol**（已读源码确认：文件里仅有的两个 Symbol 属于调度器与执行，不参与定义）。因此插件自带一份 `@deepseek-ai/dsh-tools` 不会与宿主注册表产生实例冲突 —— 这一点决定了 `link:` 安装下的依赖修复可以走「装进插件自己的 node_modules」而不是必须与宿主共实例。

这两条已编码进 `test/tools.test.mjs`：它用真实的 `defineTool` 编译三个工具定义，所以这类失败在包内就能复现，不必等一次宿主重启来发现。

### 补充 2：guide 条目的字段是 **thunk**，不是字符串（实证）

`sidebarRightTabs.register({ guide: [...] })` 里的 `guide[].title` 与 `guide[].description` 是**函数**，`GuideBody` 会调用 `entry.title()` 与 `entry.description?.()`（`dsh-client-ui-sidebar-right/lib/client.js:512-520`）。写成字符串会让 guide body 直接抛 `TypeError: entry.description is not a function`，被错误边界接住，用户看到的是「slot entry crashed in 'sidebar.right.pane.tab'」而不是条目列表 —— 也就是说**整栏 guide 都被这一条坏注册带崩**。

正确形状（对照随包发布的 `dsh-client-ui-sidebar-files/lib/client.js:28-35`）：

```js
guide: [{ id: "workspace", commandId: "workspace.files", order: 10,
          title: () => t("guide.title"), description: () => t("guide.description") }]
```

`id` 必填且在提供者内唯一；`title` / `description` 为 thunk；`order` / `icon` / `commandId` 可选。

**教训（比 bug 本身重要）**：`test/client.test.mjs` 最初断言的是 `typeof type.guide[0].title === "string"` —— **测试和代码以同样的方式写错了**，所以本地 8/8 全绿而浏览器一开就炸。现在的断言改成**调用它们**（`type.guide[0].title()`），与 `GuideBody` 的行为一致。对着源码抄契约、并让测试执行契约，比对着自己的假设写测试可靠。

### 补充 3：客户端 context 的注入与文件地址（实证）

1. **读未声明的服务会抛，不是返回 undefined**：`TypeError: cannot get property "sidebarRight" without inject`。插件里访问 `ctx.sidebarRight`，就必须在 `inject` 里声明 `"sidebarRight"`（只声明 `slots` / `sidebarRightTabs` 不够）。任何 `ctx.<service>` 访问都要先声明，或包在 try/catch 里作为可选回退。
2. **优先用 tab 自己的绑定动作**：slot props 的 `tab.actions.openResource(address, options)` 已经绑定它所属的 Session，比控制器更少前置条件。`ctx.sidebarRight.openResource(...)` 只作为回退。
3. **文件地址需要 Session id，且要按段编码**：`dsh-resource://file/session/<sessionId>/<path>`。随包实现的 `sessionFileAddress` 用 `encodeURIComponent` 逐段编码并保留 `:` 字面量（盘符），前导 `./` 去掉、绝对路径保留原样（Host 接受绝对路径）。Session id 的来源顺序：tab 地址里的 → `ctx.sidebarRight.mounted.get()`（`ObservableSnapshot<SessionId|undefined>`）。**拿不到 Session 时不要编一个**（早期实现会写成 `session/local/...` 然后静默打不开），应当返回干净的失败。

**第三次"测试与代码同错"**：修这一处时我的替换只落了一半（调用点改了、helper 没插进去），`node --check` 和全部测试照样绿 —— 因为测试从不执行点击路径。已加守卫：`test/client.test.mjs` 断言打开路径调用的每个 helper 都有声明、被替换掉的 `fileAddressOf` 必须消失。凡是"测试从不执行、只在浏览器里发生"的路径，至少要有声明级守卫。

---

## 22. 修订记录（2026-09-28，看板质量审计）

对看板的评审结论是四条：**内容不够详细、分析不够合理、任务跟踪不够完善、显示不够优雅**。逐条落到实现：

| 症状 | 根因 | 落地 |
|---|---|---|
| 内容不够详细 | 模板每行只有 6 个字段，详情卡只有 4 行文本 | board 模板改为 19 字段/条（含 `acceptance` / `evidence` / `next` / `blocker` / 三个日期 / `estimate`+`actual`） |
| 分析不够合理 | 看板只数条目，唯一「分析」是一句固定 Callout | 派生加权进度（按估算人日）、WIP 超限、陈旧、超估算四类风险，Callout 与 Stat 全部从 `DATA` 现算 |
| 任务跟踪不够完善 | 没有 `blocked` 状态、没有时间维度、没有下一步与验收；分组只在筛选器里、没有真正分组 | `TodoList` 支持 `blocked`；`Timeline` 记录时间线；按 lane 分组并在组头显示进度；「下一步」取优先级前 3 条 |
| 显示不够优雅 | 没有进度可视化、详情堆文本、状态既填行底色又加 Pill（双重编码） | 新增 `Progress` / `KeyValue` / `Timeline`；详情改字段表；明细表精简列并右对齐数字列 |

**套件 v1.1（加性，符合 §8.1 只加不减）**：

- 新增 `Progress`（`value` / `max` / `tone` / `label` / `showValue` / `size`）。
- 新增 `KeyValue`（`items[{label,value,tone?}]` / `columns` / `dense`）。
- 新增 `Timeline`（`events[{id,at,title,tone?,detail?,ref?}]` / `dense`）。
- `TodoList` 的 `status` 增加 `blocked`（危险色 + `!` 字形）。
- `KIT_VERSION`：`k1` -> `k2`（套件版本参与模块 URL 哈希，所有画布自动重编译）。
- 同步：`INTERFACE.md` §5、`skills/canvas/references/kit.md`、`patterns.md` 看板范式、`examples/selfcheck.canvas.tsx`（仍然覆盖全部套件面）。

**测试**：新增 `test/board.test.mjs`——它编译 board 模板、用**真实套件**（`lib/client.js` + React stub）递归渲染整棵树，并断言派生分析的结果（加权进度 40%、两条阻塞、两条陈旧）。`test/templates.test.mjs` 增加 board 行字段表守卫；`test/client.test.mjs` 的套件面清单补三个新组件。`canvas_check` 只验证编译，这个测试补上了渲染那条缝。

**本次审计发现、但不在本次改动范围（待裁决）**：

1. **`canvas_state_merge` 未实现**：README / INTERFACE / SKILL / patterns 都把它列为第四个模型工具，`index.js` 只注册了 `canvas_check` / `canvas_new` / `canvas_read` 三个。副作用是「人的改动固化回源文件」这一步目前只能由 agent 手动改 DATA。
2. **`runCommand` 未实现**：`/canvas/api` 的 `actions` 与 gates 模板都按「白名单内可执行」写，host 对所有请求一律回 `{ ok:false, code:'unsupported' }`（P3 未做）。
3. **`startTurn` 冷却顺序**：先写 cooldown 再调 `sessionController.prompt`，失败也会占满 `startTurnCooldownMs` 窗口。
4. **`canvas_read` 标量 dataPath**：`dataPath` 指向非数组字段时，`mergeRows` 返回空数组并覆盖该字段，返回的 JSON 会静默丢值。
5. **`W_MANY_ROWS` 口径**：kit.md 曾写「并报 `W_MANY_ROWS`」，与 §21 D5 的裁决矛盾，本次已按裁决改为「渲染期文案，不产出编译诊断」。

---

## 23. 修订记录（续，2026-09-28：把审计项做完）

§22 列出的 5 条待裁决项，本轮全部落地：

| # | 项目 | 落地 |
|---|---|---|
| 1 | `canvas_state_merge` 未实现 | 新增 `host/merge.js`：先把 `literal.js` 的解析器改成带跨度的 `parseValueSpanned`（`parseValue` 变为它的薄包装），再按**字段值跨度**最小替换；`DATA` 里没有的字段插到最后一项之后，其余字节完全不动。新增 `removeOverlayEntries` 清掉已合并的 sidecar 条目；新增诊断码 `E_MERGE`。模型工具 3 → 4 |
| 2 | `runCommand` 未实现 | 经 `ctx.shell`（`resolve` → `execute` → `result`）执行；命令字符串**只取自** Config 白名单项，请求只能按 `id` / 完整命令选中；沙箱策略取 `ctx.sandboxPolicy.resolve({ session })`。返回真实 `exitCode` / `timedOut` / 输出尾部 |
| 3 | `startTurn` 冷却顺序 | 仍先写 cooldown（防连点），失败时 `delete`，不再让一次失败占满 30s 窗口 |
| 4 | `canvas_read` 标量 `dataPath` | 只在 `Array.isArray(value[key])` 时合并；标量键原样返回，不再被 `[]` 覆盖。`key === null` 的全量合并分支改为显式条件 |
| 5 | `W_MANY_ROWS` 口径 | troubleshooting / kit.md 已与 §21 D5 对齐 |

**文档同步**：`INTERFACE.md` 新增 §4.1（`runCommand` 结果形状与安全边界）；`kit.md` 的 `ActionResult` 扩成真实返回面、动作表更新；`troubleshooting.md` 新增 `E_MERGE` 一节并修掉 `E_REACT_IMPORT` 的死引用；gates 模板改为用 `exitCode` 区分「动作成功」与「门禁通过」。

**测试**：`test/merge.test.mjs`（9，含「未触碰的字节完全一致」与合并后 DATA 重新解析）；`test/tools.test.mjs` 增加 `canvas_state_merge` 的端到端（含 `dryRun` 不写盘）；`test/serve.test.mjs` 增加第二套组合（假 `ctx.shell` + `sandboxPolicy`）验证白名单执行、未登记拒绝、以及「请求里的 `command` 不能覆盖白名单」。全量 64 断言 / 7 个测试文件全绿。

> 仍未闭环：`runCommand` 的 `ctx.shell` 集成只在假执行器上验证过，未在真实 GUI 里跑过一条命令；`canvas_state_merge` 只覆盖「已存在字段 + 新增字段」两条路径，没有处理引号风格重写与注释保留以外的排版细节（它本来也不该动那些）。

---

## 24. 修订记录（续：画布意图入口）

补上一直缺的一环：**用户要画布时的意图识别与 intake 入口**。

- **事件面**：`agent/pre-step`（`dsh-agent` 声明的水位事件）。监听器先 `next()`，只在 `{ kind: 'enter' }` 上把消息折进批次末尾——与 `dsh-hooks-claude-code` 的 `UserPromptSubmit` 同一形状，因此后续监听器仍可拒绝或改写。
- **`host/intent.js`**：
  - `matchesCanvasIntent`：**创建动词必须治理到名词**（中文 12 字符、英文 24 字符的窗口内），再叠加"指代既有物"的抑制 —— 出现 `这张/现有/本仓`、路径或文件名（`.canvas.tsx`、`foo.md`）时必须有创建动词才触发；强名词在**短消息（≤ 12 字）且无指代**时仍可光杆触发（`项目看板`）。`帮我 / 看一下 / show me` 不算创建动词 —— 它们是"对既有的东西求助"。Config 的 `intentKeywords` 按弱名词处理。
  - `userPlainText`：只读 `source.kind === 'user'` 的消息，别的插件注入的上下文不会二次触发。
  - `buildCanvasIntakeGuidance`：只带**必须在当下发生**的部分 —— 7 条对齐问题 + 一句指向 `references/intake.md`（产出顺序、质量门槛、锚点三块都在那里）。刻意不复制：同一份契约的第二份拷贝必然漂移，这份已经漂过一次（`intake.md` 加了锚点、注入文本没跟）。
  - `createCanvasIntentListener`：`{ getCreateUserMessage, keywords, guide, onError }`；工厂缺席、guide 抛错都放行。
- **`index.js`**：`registerIntentHook` 用 `ctx.effect(() => ctx.on('agent/pre-step', listener))` 注册；`@deepseek-ai/dsh-llm` 的消息工厂**懒加载**，缺了只警告一次，不影响插件加载。新增配置 `intentHook`（默认 true）/ `intentKeywords` / `intentGuide`。
- **技能**：新增 `skills/canvas/references/intake.md`（触发含义、7 条 intake 表、字段清单与缺失后果、回执模板、产出顺序、质量门槛、反模式）；`SKILL.md` 的流程补第 0 步并更新 frontmatter description；README 增加「画布意图入口」一节与三条配置。

**测试**：`test/intent.test.mjs` 13 条（强 / 弱名词、英文、部署关键词、只读人类消息、回执内容、恰好追加一条，以及不匹配 / 拒绝 / 空批次 / 工厂缺席 / 自身出错五条放行路径）；`test/serve.test.mjs` 的 ctx shim 记录 `ctx.on`，断言入口确实注册在 `agent/pre-step`。

> 未闭环：这条只在事件契约层验证过（shim + 单测），**没有在真实会话里观察过注入效果** —— 下一次真实 GUI 会话里发一句「给我建个项目看板」即可确认。

---

## 25. 修订记录（续：画布 tab 的滚动容器）

**Bug**（真实会话反馈）：右栏画布内容超出面板后没有滚动条，看不到全部。

**根因**：`SidebarRight` 的 tab 容器是 `.tabBody{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}` —— 它**裁剪**。随包发布的文件页之所以能滚，是因为它自己带滚动容器（`.root{height:100%;min-height:0;flex:auto;display:flex}` + `.body{flex:auto;min-height:0;overflow:auto}`）。`CanvasBody` 的根 `Stack` 只有 `display:flex` 与 `gap`，没有高度也没有 overflow，于是内容长出容器后被裁掉：没有滚动条，也够不到下面。

**修复**：`lib/client.js` 的 `CanvasBody` 统一走 `FRAME_STYLE`（`height:100%` / `minHeight:0` / `flex:auto` / `overflowY:auto` / `overflowX:hidden` / `scrollbarGutter:stable`），**两条 return**（目录页与画布页）都套上。

**回归**：`test/client.test.mjs` 新增「the canvas body owns a scroll container」，对两条渲染路径都断言上面四个样式，避免以后有人顺手把根 `Stack` 的 `style` 去掉。

> 副作用（正向）：根容器成了真正的滚动容器后，`Table` 的 `stickyHeader` 有了正确的 sticky 参照；`scrollbar-gutter: stable` 让有无滚动条时布局不跳。
> 生效仍需刷新 / 重启 GUI：运行中的页面在改动前就组合好了模块图。

---

## 26. 修订记录（续：画布面板的边距与排版）

**反馈**：画布没有页面边距，上下左右都很挤；字体没有参照 harness 标准，有大有小、混乱。

**根因（都是 token 用错，不是审美问题）**：

1. **边距**：`FRAME_STYLE` 只留了 `paddingRight: 4px`（给滚动条让位），而 tab 容器 `.tabBody` 本身没有 padding —— 内容贴边。
2. **排版**：
   - `--dsw-font-mono` 在主题里**不存在**，裸 `var()` 是无效字族 → `Code` 一直用 UI 字体渲染，代码不是等宽。
   - `fontSmall` / `fontCaption` 引用的是**简写** token（`--dsw-font-xs-13` = `13px/20px family`、`--dsw-font-xxs-12`）。把它们当 `font-size` 是无效值，于是 12 / 13px 静默退回继承字号 —— `small` 与 `caption` 实际和正文一样大。
   - `H1` / `H2` / `Stat` 用 `calc(--dsh-content-font-size * 1.6 / 1.22 / 1.5)` 这类自造乘法，得到 22.4 / 17 / 21px：既不在 harness 刻度上，彼此也没有统一的基线。
   - 基线本身也选错了：右栏正文是 `--dsh-content-font-size-secondary`（13px），不是聊天区的 14px。

**修复**（`lib/client.js`）：

- `T.mono` → `--ds-font-family-code, ui-monospace, …`（与 markdown code 同一个 token）。
- 新增长写 token：`base / small / caption / large` 的 `-font-size` 与 `-line-height`；`H1` = `--dsw-font-l-20`，`H2` = `--dsw-font-base-strong-16`，code = `--dsw-font-markdown-code`。
- `font(size)` 只从刻度取；新增 `lineOf(size)`，字号与行高成对出现（去掉 `lineHeight: 1.6` 这类裸值）。
- 全部组件（Text / H1 / H2 / Code / CardHeader / Callout / Stat / KeyValue / Timeline / Button / Pill / Table / BarChart / TodoList / DiagnosticsCard）改走 token；表头字重 500（对齐 markdown table head 的 500），BarChart 的 10px 轴标签上到 11px。
- `FRAME_STYLE` 加 `padding: "12px 16px 24px"`。

**文档**：`kit.md` 新增「排版标准」表，设计约定从四条加到五条（第 5 条：字号只从刻度取）。

**回归**：`test/client.test.mjs` 新增「typography comes from the harness scale」，断言各档的 `-font-size` 长写 token、`H1/H2` 的刻度、`--ds-font-family-code`，并显式禁止 `--dsw-font-mono`；滚动测试补上 `padding` 断言。

> 同一条教训，第三次：**契约要靠 token 的**长写形式**落地**。简写 token 贴进 `font-size` 不报错、不告警，只是安静地不生效。

---

## 27. 修订记录（续：startTurn 的真实请求形状）

**反馈**：画布上的「开始 / 在会话里开始」点了没反应，任务不会开始。

**根因**（两个 API 形状错误，叠加成「按钮坏了」）：

1. `SessionController.prompt(request, signal)` 的实现**第一行**就是 `signal.throwIfAborted()`。我们只传了一个参数 → `TypeError: Cannot read properties of undefined (reading 'throwIfAborted')`。它落进 `startTurn` 的 catch，变成 `{ ok:false, code:"failed" }`，看起来像「被拒」，实际是崩了。
2. `SessionPromptRequest.mode` 是**必填**字段（`'queue' | 'steer'`），我们没传。

这正是 §21「尚未闭环」里那条「按源码推断、未经真实 agent 验证」的欠账。

**修复**（`index.js`）：请求按契约补齐 `requestId` / `sessionId` / `mode: "queue"` / `content`，并显式传一个 `AbortController` 的 signal（它只界定 prompt 的准入，轮次本身要活过 HTTP 响应）。

**可见性**（`lib/client.js`）：`reportFailure` 扩成 `reportOutcome` —— 失败仍弹 danger，**成功也弹一条 info**（「已交给 agent；切到会话即可看到这一轮」）。静默的成功与坏按钮在体感上没有区别。

**回归**：`test/serve.test.mjs` 新增两条 —— `mode === "queue"`、传入了真正的 `AbortSignal`、`content[0].text` 原样、`requestId` 存在；以及冷却窗口内重复点击**不会**触达 agent。`test/client.test.mjs` 新增一条：成功的 `startTurn` 必须产生一条 info 通知。

> 教训：**跨包契约要对着类型与实现的第一个语句一起读**。`prompt` 的类型把 signal 标成可选，实现却在第一行解引用它 —— 只看类型照样会踩。

---

## 28. 修订记录（续：action 信封）

**反馈**：点「开始」后提示 `startTurn: unsupported action undefined`。

**根因**：客户端与 host 对 `POST /canvas/action` 的 body 形状不一致。

- INTERFACE §3 冻结的是 `{ canvas, sessionId?, action }`，host 也确实按 `body.action` 读。
- 但 `lib/client.js` 的 `postAction` 把 action **平铺**进 body：`Object.assign({ canvas, sessionId, root }, action)`。
- 于是 host 拿到 `body.action === undefined` → `action = {}` → `"unsupported action undefined"`。

**为什么测试没抓到**：`test/serve.test.mjs` 一直手写「包装形状」的 body（`{ canvas, action: {...} }`），而 `test/client.test.mjs` 从不检查请求体。两个半边各自自洽，接缝没人测 —— 与 §21 补充 2 的「测试与代码同错」是同一类。

**修复**：

- 客户端按契约包装：`{ canvas, sessionId, root, action }`。
- host 增加**兼容分支**：`body.action` 缺失时退化为 body 本身，让「页面还挂着旧 bundle、只重载了 host」的中间态也能工作；缺 `type` 时的消息改成点名信封形状与收到的 keys。
- 影响面：`startTurn` / `runCommand` / `overlaySet` / `overlayClear` 四条 host 侧动作**此前全部不可用** —— 「人点面板改状态落 sidecar」这条承诺在真实页面里从未成立过，§21 把它标为已验证只是 host 单边测试的结论。

**回归**：

- `test/client.test.mjs`：直接 stub `fetch` 抓请求体，断言它是 `{ canvas, sessionId, action: { type, ... } }`。
- `test/serve.test.mjs`：新增「扁平形状仍可用」（兼容分支）与「缺 type 时消息点名信封」两条。

> 教训第四次同源：**接缝要有测试**。两个半边各自自洽不等于它们对上；这次是「客户端不检查自己发的形状，服务端测试手写形状」。

---

## 29. 修订记录（续：runCommand 真机验收 + 意图入口噪音）

**V-03 闭环**（此前一直挂在「需要先在 Config 登记 commandWhitelist 项」）：

- 白名单登记在 **profile 的 `cordis.patch.yml`**（用户 patch 层，`patchReload: live`），新增 `gate:tests`（`node --test test/*.test.mjs`）与 `gate:templates`（`node --test test/templates.test.mjs`），`cwd` 写死为本仓绝对路径，避免依赖调用方 Session 的工作区根。
- 真机验收（直接打运行中的 host）：`POST /canvas/action { sessionId, action:{type:"runCommand", id:"gate:templates"} }` → `ok=true, code="ran", exitCode=0, mode="danger-full-access", denied=false`，stdout 是模板语料的真实输出；`gate:tests` → `exitCode=0`，8 文件全过。
- 新增 `gates.canvas.tsx`（本仓真实门禁画布），面板上的 Run 现在真的会执行。

**首次尝试暴露的兜底问题**（记为 V-05，未决）：不带 `sessionId` 时 `runCommand` 用 `sandboxPolicy.resolve()` 的部署默认 —— 模式 `workspace-write` + 回落根 `D:\source\repos\AIEngineering`，Windows ACL runner 在该目录上 `SetNamedSecurityInfoW` 失败（Win32 5），执行器拒绝在无约束下运行。面板总会带 `sessionId`，所以不影响按钮；但「没有 Session 时该怎么办」需要一条明确裁决（拒绝执行 / 显式回落），并写进 INTERFACE §4.1。

**意图入口噪音**：点「开始」提交的任务带 `source.rpcId = "canvas-…"`，而 prompt 里含「画布」，于是 intake 指引被再次注入 —— 一个已经跟踪的任务被要求重新做 intake。修复：`userPlainText` 跳过 `rpcId` 以 `canvas-` 开头的消息（`startTurn` 铸的 id）。文本是自由格式，`rpcId` 才是可靠信号。回归：`test/intent.test.mjs` +2。








