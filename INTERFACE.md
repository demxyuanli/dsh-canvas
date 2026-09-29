# Canvas 插件 —— 冻结接口 v1

> 本文件是 host 半边与 client 半边的**唯一契约**。任何一边改接口必须先改这里。
> 设计依据：`specs/_design_canvas_plugin.md`（本仓）

## 1. 包

- 包名 `@local/dsh-canvas`，单包双半：`index.js`（host）+ `lib/client.js`（browser）。
- 客户端模块注册 id **必须等于包名**：`@local/dsh-canvas`。
- client 半边只允许 `require("react")`（平台模块表已预置），**不得** require 任何 DSH client 包。

## 2. 注入到浏览器的全局（动态 import 之前同步设置）

~~~js
globalThis.__DSH_CANVAS__ = {
  version: "1",
  h: React.createElement,
  Fragment: React.Fragment,
  React,
  ...kit,           // §5 的组件与钩子，平铺
};
~~~

编译产物是标准 ESM，`export default` 为画布组件；模块顶层只允许引用 `__DSH_CANVAS__`。

## 3. HTTP 接口（同源，全部在 `/canvas` 前缀下）

host 用 `webServer.register({ kind: "prefix", path: "/canvas", handler })` 注册**一个**前缀路由，内部按 pathname 分发。handler 是 **Node 风格 `async (req, res) => {}`**。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/canvas/compile` | `{ path, source }` | `{ ok: boolean, sha?: string, url?: string, diagnostics: CanvasDiagnostic[] }` —— **编译失败不是 HTTP 错误**，永远 200 |
| GET | `/canvas/module/<pathHash>/<sha>.js` | — | `text/javascript`，内容寻址，`Cache-Control: public, max-age=31536000, immutable` |
| GET | `/canvas/list` | — | `{ canvases: [{ path, title?, description?, icon?, bytes, lines }] }` |
| GET | `/canvas/overlay?canvas=<abs path>` | — | `{ version: 1, canvas, sourceSha1, overlays }` |
| POST | `/canvas/overlay` | `{ canvas, key, id?, patch?, clear? }` | `{ ok: true, overlays }` |
| POST | `/canvas/action` | `{ canvas, sessionId?, action }` | `{ ok: true, detail? }` 或 `{ ok: false, code, message }` |
| GET | `/canvas/api` | — | `{ version, limits, actions: string[] }` |

`CanvasDiagnostic`（与设计文档 §6.6 一致）：

~~~ts
{ code: string; severity: "error" | "warning"; message: string;
  line?: number; col?: number; hint?: string }
~~~

### 3.1 信任边界（v1 的硬约束）

插件注册在 `webServer` 上的路由**不在宿主外壳的 token/cookie 边界内** —— 那道 401 只守外壳与连接（`dsh-client-connection`：根查询里的 token 换 cookie）。`webServer.register` 的签名是 `{ kind, path, handler }`，没有鉴权参数，所以边界由插件自己建立。三条：

1. **POST 必须 `content-type: application/json`**，否则 `403 { ok:false, code:"unsupported" }`。理由：跨站页面只能发**简单请求**（`text/plain` / `x-www-form-urlencoded` / `multipart`）；要求 JSON 就逼它走预检，而本服务器**不回应预检** → 浏览器那条路被关掉。本机脚本（curl / PowerShell / 其它 DSH 组件）与自带 client 本来就用 JSON（`lib/client.js` 的 `postAction`）。
2. **写操作钉在工作区根内**：`canvas_new`、`POST /canvas/overlay`、`overlaySet` / `overlayClear`、`canvas_state_merge` 五处，路径必须落在该请求解析出的根内，越界 → 拒绝并说明。**读操作不设限**（`canvas_check` / `canvas_read` / `GET /canvas/source` / `GET /canvas/overlay` / `GET /canvas/list`）—— 这是刻意的取舍：钉写能挡住「任意目录造文件 / 写 sidecar / 回写源文件」，而读的泄漏面很窄（只有能被当成画布解析的文件才会返回 `DATA`），不值得再引入一条不对称之外的规则。
3. **权威根阶梯**：`config.workspaceRoot` → 本请求的 session cwd → **记住的上次会话根** → `policy.workspaceRoot`。落到 `process.cwd()` 时**写操作一律拒绝**：

   > 「记住的上次会话根」排在 policy 之前是刻意的：Desktop 的 `ctx.sandboxPolicy.workspaceRoot` 是**应用数据目录**（实测 `profiles/desktop`），让一个真正见过的工作区优先于它，无 session 的写才不会落在应用自己的目录里。

~~~json
{ "ok": false, "code": "unsupported",
  "message": "cannot resolve the workspace root for this write (no session and no known workspace); pass sessionId or set workspaceRoot" }
~~~

Desktop 应用的 cwd 是 profile 目录 —— 信任它就是「文件被建到 `profiles/desktop/` 下」那次事故的成因。

> 已知限制：容器检查是**路径前缀**级别，不解析符号链接。根内一个指向根外的链接仍可能被写入；要彻底挡住需要 realpath 处理，收益与成本不成比例。

## 4. 动作（action）分工

**client 自己处理，绝不发往 host**：

- `{ type: "openFile", path, line? }` —— 转成 `dsh-resource://file/session/<sid>/<path>` 后走右栏导航
- `{ type: "openResource", address, params? }`
- `{ type: "copy", text }`

**发给 host**（`POST /canvas/action`）：

- `{ type: "startTurn", prompt, newSession? }` —— 默认追加到当前会话；带冷却与去重
- `{ type: "runCommand", id?, command?, cwd?, title? }` —— 仅 Config 白名单
- `{ type: "notify", tone, message }` —— 由 client 显示，host 只回 ok
- `{ type: "overlaySet", key, id, patch }` / `{ type: "overlayClear", key, id? }`

未来动作：`{ type: "startTurn" }` 之外的编排动作一律先在此登记再实现。

### 4.1 `runCommand` 的结果形状

进程跑完即算**动作成功**，与命令自己的退出码无关：

~~~ts
{ ok: true, code: "ran", exitCode: number | null, signal: string | null, timedOut: boolean,
  sandbox?: { mode, denied, enforcement?, runnerFailed? },
  policy: { source: "session" | "deployment", sessionId: string | null, reason: string },
  detail: string, stdout: string, stderr: string }   // stdout / stderr 是截断后的尾部（8 KB / 4 KB）
~~~

- 命令字符串**永远取自 Config 白名单项**；请求只能按 `id` 或完整命令逐字**选中**一项，不能改写它（请求里同时带 `id` 与不相干的 `command` 时以命中项为准）。
- 执行经 `ctx.shell`（`resolve` → `execute` → `result`），沙箱策略来自调用 Session 的 `ctx.sandboxPolicy.resolve({ session })`，作为 `request.sandboxPolicy` 交给执行器（`dsh-pwsh-sandbox` 的 `resolve` 认这个字段，缺省才自己回退部署默认）。
- **兜底是显式的**（V-05 裁决）：请求没带 `sessionId`、或该 id 在本 host 上查不到时，**仍按部署默认策略执行**（不拒绝，按钮照常可用），但结果必须带 `policy.source: "deployment"` + `policy.reason`，并在 `detail` 末尾括注——面板不能把部署默认读成调用方自己的策略。
  - `policy.source` 只有两个取值：`session`（解析到调用方）/ `deployment`（其余全部情形）；
  - 三种回落原因写在 `policy.reason` 里：请求未带 `sessionId`、`sessionId` 在本 host 查不到、本组合没有 `sandboxPolicy` 服务（解析抛错时 reason 带原文）。
- 未登记 → `{ ok:false, code:"denied" }`；白名单为空 → `{ ok:false, code:"unsupported" }`；`ctx.shell` 缺失 → `{ ok:false, code:"unsupported" }`；准备 / 启动失败 → `{ ok:false, code:"failed" }`。

## 5. 套件（`dsh/canvas`）导出面

组件：`Stack Row Grid Divider CollapsibleSection H1 H2 Text Code Card CardHeader CardBody Callout Stat Table BarChart HeatMatrix TodoList Progress KeyValue Timeline Button Pill`
钩子：`useState useEffect useMemo useCallback useRef useCanvasState useCanvasOverlay useCanvasAction useHostTheme useCanvasResource`

`TodoList` 的 `status` 取 `pending | in_progress | blocked | completed | cancelled`。

props 细节见设计文档 §8。**只加不减**：新增组件/可选 prop 允许；改签名或删导出必须升级 `version`，并在 client 渲染期报 `W_DEPRECATED`（**不是编译诊断**）。

v1.1 加性新增 `Progress` / `KeyValue` / `Timeline` 与 `TodoList` 的 `blocked`；`KIT_VERSION` 已 `k1 → k2`，所有画布模块 URL 随之失效并重编译。

## 6. 文件约定

- 画布文件：`*.canvas.tsx`；**必须** `export default`；**推荐** `export const DATA = {...} as const`（纯字面量）。
- sidecar：与被引用画布同目录的 `.canvas/<stem>.state.json`。
- 画布模块 URL 段：`pathHash` = 画布绝对路径 sha1 前 12 位；`sha` = (source + COMPILER_VERSION + KIT_VERSION) 的 sha1 前 16 位。

## 7. 工作区根（root）的解析

画布路径的解析顺序（与 §§dsh-api-workspace-files§§ 用的同一对来源一致）：

1. 请求里的显式覆盖：§§?root=<abs>§§ 或 body 的 §§root§§（仅调试/测试用）；
2. 调用方 Session 的 §§session.cwd§§：客户端在 §§list/source/overlay§§ 上带 §§?session=<sid>§§，在 §§compile/action§§ 的 body 里带 §§sessionId§§；
3. §§ctx.sandboxPolicy.workspaceRoot§§（组合级兜底）；
4. 插件行的 §§config.workspaceRoot§§（部署显式设定，优先级最高）；
5. §§process.cwd()§§（最后兜底，通常**不是**用户工作区，仅用于诊断）。

§§GET /canvas/api§§ 会回显当前解析到的 §§root§§，排查"列表为空"时先看它。

## 8. 端点补充（相对 §3）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | §§/canvas/source?path=<abs|rel>&session=<sid>§§ | 读文本；也可用 §§address=<dsh-resource 地址>§§ |
| GET | §§/canvas/list?session=<sid>§§ | 发现工作区里的 §§*.canvas.tsx§§ |

§§CanvasDiagnostic§§、动作分工、套件导出面不变。
