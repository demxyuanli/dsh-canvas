# @local/dsh-canvas

> Agent 写的 `.canvas.tsx` 画布，由宿主实时编译渲染，并可反向回灌 agent。

## 是什么

把"给人看的产物"从散文 markdown 变成**能编译的可交互面板**：agent 写一个 `*.canvas.tsx` 文件，host 用 sucrase 编译成 ESM，浏览器动态 import 后渲染成右栏 tab；面板上的按钮能打开文件、发起新回合、跑白名单命令。

它解决的不是"好不好看"，而是三件事：

1. 多状态长任务有一个**可下钻的常驻面板**，而不是每轮重贴 markdown；
2. 面板数据**结构化可查询**（`canvas_read` 取切片），agent 的 context 成本与文件总大小脱钩；
3. 门禁的红绿来自 **harness 真实退出码**，不是模型的自述。

**不是什么**：(a) 不是 `todo_write` 的替代（短任务仍用它）；(b) 不是 `goal` 的替代（goal 管"要不要继续下一轮"）；(c) 不是通用前端框架——画布只能 import `"dsh/canvas"`；(d) 不是第三方内容的沙箱（画布代码 = 插件信任级别，见"已知限制"）。

## 装法

以普通工作区 bundle 安装：

1. 把本目录（含 `package.json` / `cordis.patch.yml` / `index.js` / `host/` / `client/` / `lib/`）放在工作区任意位置；
2. 用 `plugin_manager` 的 `install_bundle`，`target` 传**本目录绝对路径**；由它完成依赖安装（`sucrase`）与 bundle 选择。不要手改 `$DSH_HOME` 下的 profile 文件，也不要在 profile 目录里跑 pnpm；
3. 读安装结果：只有 `application: applied` 说明改动生效。`restart-required` 表示需要重启，`overridden` 表示被更高优先级的 patch 层覆盖；
4. 之后可用 `list_plugins` / `set_plugin` 开关该行。替换已安装包需要重启才能加载新的 JS 模块代。

配置覆盖写在**你自己 profile 的 `cordis.patch.yml`**（用户 patch 层在 bundle 层之后应用）：

~~~yaml
- id: dsh-canvas
  name: "@local/dsh-canvas"
  config:
    maxSourceBytes: 2097152
    commandWhitelist:
      - id: gate:phase19
        title: phase19 gate
        command: cargo test -p occt-topo phase19
        timeoutMs: 600000
~~~

## 配置项

随包发出的 `cordis.patch.yml` 默认值如下。

| 键 | 默认 | 含义 |
|---|---|---|
| `maxSourceBytes` | `1048576`（1 MB） | 源码字节硬上限，超出报 `E_TOO_LARGE` |
| `maxLines` | `8000` | 源码行数硬上限 |
| `maxDataBytes` | `4194304`（4 MB） | 抽取后 `DATA` 的 JSON 字节硬上限 |
| `maxRenderRows` | `5000` | 单次渲染行数硬上限；超出截断并报 `W_MANY_ROWS` |
| `compileTimeoutMs` | `2000` | 单文件编译超时，超出拒绝编译 |
| `commandWhitelist` | `[]` | `runCommand` 白名单，**默认空 = 全部拒绝**；每项 `{ id, title, command, cwd?, timeoutMs? }` |
| `startTurnCooldownMs` | `30000` | 同一画布 + 同一 prompt 的冷却窗口（去重） |

补充：

- 软阈值（源码 128 KB / 1500 行 / `DATA` 512 KB / 单组件 300 行）目前是**内建常量**，不在 Config 里，只产生 `W_LARGE_FILE` / `W_MANY_ROWS` 警告，不阻断编译。若要可配置，请先改 `INTERFACE.md` 再实现（配置面属于冻结接口）。
- 白名单项必须**逐字匹配**画布请求（按 `id` 或完整 `command` 字符串）；`runCommand` 仍受当前 permission preset 约束，被拒时返回 `{ ok: false, code: "denied" }`。

## 架构（两半）

单包双半：`package.json` 同时声明 `dsh.bundle.patch`（host 行）与 `dsh.client`（浏览器半边）。

| 半边 | 入口 | 职责 |
|---|---|---|
| host (Node) | `index.js` + `host/` | 编译（sucrase）、内容寻址模块服务、画布发现与 watch、`DATA` 抽取、sidecar overlay 读写、动作桥、四个模型工具 |
| browser | `client/` 源码 → 构建产物 `lib/client.js` | `dsh/canvas` 套件、`sidebar.right` tab type（认领 `*.canvas.tsx`）、源码读取、动态 `import()` 挂载、错误边界 |

客户端模块注册 id **必须等于包名** `@local/dsh-canvas`；浏览器半边**只允许** `require("react")`，不得 require 任何 DSH client 包。

关键链路：

1. **编译**：`POST /canvas/compile { path, source }` 返回 `{ ok, sha, url, diagnostics }`；**编译失败不是 HTTP 错误**，永远 200。
2. **取模块**：`GET /canvas/module/<pathHash>/<sha>.js` 内容寻址、`immutable`。源码 / 编译器版本 / 套件版本任一变化即新 URL，因此未变化的保存不触发重编译。
3. **注入**：动态 import 之前**同步**设置 `globalThis.__DSH_CANVAS__`（`h`、`Fragment`、`React` + 平铺的套件导出）。
4. **动作分流**：`openFile` / `openResource` / `copy` 由 client 自己处理；`startTurn` / `runCommand` / `notify` / `overlaySet` / `overlayClear` 发往 `POST /canvas/action`。
5. **sidecar**：人的改动落在与被引用画布同目录的 `.canvas/<stem>.state.json`；`canvas_read` 能读到，`canvas_state_merge` 可合并回源文件。

完整 HTTP 面与 `CanvasDiagnostic` 形状见 [INTERFACE.md](INTERFACE.md)。

## 画布文件约定

三条硬规则 + 一个推荐：

~~~tsx
/** @canvas
 * title: My board
 * description: 一句话说明
 * icon: board
 */
import { H1, Text, Stack } from "dsh/canvas";

export const DATA = { items: [{ id: "a", title: "first" }] } as const;

export default function MyBoard() {
  return (
    <Stack gap={16}>
      <H1>My board</H1>
      <Text tone="secondary">DATA has {DATA.items.length} item(s).</Text>
    </Stack>
  );
}
~~~

1. 必须有 `export default`（无参组件）；
2. 只能 import `"dsh/canvas"`（其它说明符一律 `E_PARSE_IMPORT`）；
3. 纯渲染：禁止 `fetch` / `setTimeout` / `document` / `window` / `eval` / `iframe` / 远程资源；
4. **推荐** `export const DATA = { ... } as const`，且 `DATA` 必须是**纯字面量**（无函数调用、无模板拼接、无非字面量 spread、无 `Date.now()`）——host 用括号扫描把它抽出来，**不执行代码**；这样 `canvas_read` 才能按 `dataPath` / `filter` / `ids` 切片。

状态放哪：

- **要 agent 看见的**（人的标记、认领、豁免）→ `useCanvasOverlay`（落 sidecar，`canvas_read` 可读）；
- **纯 UI 态**（筛选器、当前选中项）→ `useCanvasState`（localStorage，**agent 看不到**）。

## 模型工具

| 工具 | 用途 |
|---|---|
| `canvas_new` | 按 `kind: "blank" \| "board" \| "gates"` 生成脚手架（与 `skills/canvas/templates/` 同源） |
| `canvas_check` | 静态扫描 + sucrase 编译 + `DATA` 抽取，返回 `CanvasDiagnostic[]`；**不渲染** |
| `canvas_read` | 抽取 `DATA` + 合并 sidecar + 切片 / 过滤 / 截断，返回结构化 JSON 与统计；`W_NO_DATA` 时退化为源码文本 |
| `canvas_state_merge` | 把 sidecar 补丁最小化写回源文件 `DATA`，并从 sidecar 移除 |

**不要全文重读画布**：用 `canvas_read` 取切片，改完用 `canvas_check` 自检——这是本插件对 context 成本的核心承诺。

## 技能与模板

- [skills/canvas/SKILL.md](skills/canvas/SKILL.md) —— 何时写画布、四步流程、保持小的纪律、反模式；
- [skills/canvas/references/kit.md](skills/canvas/references/kit.md) —— 套件完整 API（组件 + 钩子 + 类型）；
- [skills/canvas/references/patterns.md](skills/canvas/references/patterns.md) —— 看板 / 门禁 / 时间线 / 对比四类范式；
- [skills/canvas/references/troubleshooting.md](skills/canvas/references/troubleshooting.md) —— 诊断码逐条修法；
- `skills/canvas/templates/*.canvas.tsx` —— `canvas_new` 的三个模板，同时是**必须永远能编译**的回归语料。

## 验证方式

安装成功不等于用户看得见。按顺序真实操作：

1. `install_bundle` 返回 `application: applied`；`cordis_inspect_query` 能看到 `dsh-canvas` 行与四个工具。
2. 在工作区建一个最小画布（或 `canvas_new`），从文件树点开 → 右栏出现画布 tab 并渲染。
3. 改文件并保存 → 面板**不刷新页面**即更新。
4. 故意写错语法 → 出错误卡（带 `code` 与行列号）；改回 → 自动恢复。
5. `canvas_check` 跑 `skills/canvas/templates/` 三个模板 → 期望 0 error（回归语料）。
6. 明暗主题各看一次；控制台无 `slot entry crashed`。
7. 人点一次 overlay 按钮 → 关闭页面重开仍在，且 `canvas_read` 能读到该改动。

**当前未验证项（实现期阻塞项）**：动态 `import()` 是否被页面 CSP 允许；`sucrase` 能否经 `install_bundle` 装进 profile 并被 host 半边加载。这两项没有结论之前，画布不会真正渲染。

## 已知限制

1. **信任级别 = 插件**：画布代码在宿主页面里执行。不注入 `fetch` / `localStorage` / `document`，也不允许远程资源，但**能**在浏览器里做任意计算（死循环 / 吃内存只能靠渲染上限与页面可恢复性缓解）。不引入 iframe / Worker 隔离。
2. **不真正虚拟化**：`Table` / `TodoList` 超过单组件 `maxRows`（默认 300）只截断并报 `W_MANY_ROWS`；`BarChart` 超过 40 个 category 只渲染前 40。
3. **`W_MANY_ROWS` 是渲染期条件**，而诊断管线是编译期（host）——所以 `canvas_check` 看不到它，它只出现在 tab 的 warning 徽标上。
4. **诊断码口径未完全收敛**：`W_UNKNOWN_PROP` 出现在诊断码联合里但没有对应检查；`E_REACT_IMPORT`（设计文档 §5.3）与 `W_DEPRECATED`（§8.1 / §19）被引用但不在联合里。三者的最终归属待定。
5. **旧模块不回收**：浏览器无法卸载已 import 的 ESM，长期会话里旧版本模块会累积（数量 = 修订数），只能提示重载页面。
6. **只能 import `dsh/canvas`**：画布之间不能互相 import，也不能用第三方库；`BarChart` 只有分组柱状图。
7. **`runCommand` 默认全拒**：必须先在 Config 里登记白名单项并逐字匹配，且仍受 permission preset 约束。
8. **`startTurn` 有限流**：同一画布 + 同一 prompt 在 `startTurnCooldownMs` 内只接受一次，防止误点或循环刷会话。
9. **发现范围是工作区**：工作区外的 `*.canvas.tsx` 可以用文件地址打开，但不会出现在画布目录里。
10. **单包双半**：host 半边依赖 `sucrase`，浏览器半边必须零依赖；二者一起发布，不能只装一半。
11. **sidecar 可能陈旧**：源文件变化后 overlay 不自动丢弃，会以 `staleOverlay` / `orphan` 暴露给 `canvas_read`，由 agent 决定是否 `canvas_state_merge`。
12. **`.canvas/` 目录名**尚未与既有习惯（`.target-gate/`、`.codegraph/`、`.cursor/`）统一评审。

## 相关文档

- 设计文档：[../../specs/_design_canvas_plugin.md](../../specs/_design_canvas_plugin.md) —— 决策记录、套件 API、分阶段计划、风险登记册
- 冻结接口：[INTERFACE.md](INTERFACE.md) —— host↔client 唯一契约
- 包清单：[package.json](package.json)
