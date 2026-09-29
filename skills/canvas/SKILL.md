---
name: canvas
description: Use when the user asks for a project canvas, 看板, 画布, 画板, board, dashboard, or a multi-item status surface — a persistent, interactive audit/engineering-analysis view for both the human and the agent — instead of prose, a growing markdown spec, or a short todo list. Covers the intake first, then when to write a canvas, how to author and update a *.canvas.tsx file, how to check it, and how its state stays consistent between the human and the agent.
---

# Canvas（`*.canvas.tsx`）

画布是**能编译、能交互、能回灌 agent** 的产物：agent 写一个 `*.canvas.tsx` 文件，宿主实时编译并渲染成右栏 tab。面板上的按钮可以打开文件、发起新回合、跑白名单命令。

画布类请求有一个 host 侧**意图入口**（`agent/pre-step` hook）：用户说"建个项目的 canvas / 看板 / 画布 / 画板 / 项目文档"时，它会把 [references/intake.md](references/intake.md) 的摘要注入当前步骤。**这句话的含义是「用画布承载审计与工程分析」**——先做 intake 对齐口径，再写文件；直接产出一个只有标题与状态的薄看板等于没接住入口。

先读 [references/kit.md](references/kit.md) 拿到完整套件 API，再照 [templates/board.canvas.tsx](templates/board.canvas.tsx) 起步。

## 何时该写画布

同时满足下面两条才写：

- **多项状态**：要盯的是"一批条目各自的状态"，而不是一条结论；
- **多次更新**：它会跨多轮被反复更新，且人需要**下钻**（点开某条看细节、按状态筛选、触发下一步）。

典型场景：未完成任务看板、门禁 / 基线对齐仪表、迁移进度时间线、方案对比表。

## 何时不该写

| 情况 | 用什么 |
|---|---|
| 单条结论、一次性的说明 | 直接写在回复正文里 |
| 短任务（几步就完） | `todo_write` |
| "要不要继续跑下一轮" | `goal`（画布不替代它） |
| append-only 的日志 / 流水 | 普通文件；画布只显示"最近 N 条" |
| 纯数据交付（机器要读） | 普通 JSON / CSV 文件 |
| 需要一个真正的网页应用 | 这不是画布的场景（画布只能 import `dsh/canvas`） |

## 流程

0. **做 intake**：按 [references/intake.md](references/intake.md) 的 7 条与用户对齐（每条给一个默认值，只问一次），拿到确认或"你看着办"再往下。**不要在没对齐前写文件。**
1. **建脚手架**：用 `canvas_new`（`kind: "blank" | "board" | "gates"`）。不要从空白文件手写，会漏掉元数据头与 `DATA` 形状。
2. **先只填数据**：把条目写进 `export const DATA = { ... } as const`。这一步不碰渲染代码——模板里的渲染代码通常已经够用。
3. **需要时才改渲染**：只当现有范式都不合用时才动 JSX。改之前先读 [references/patterns.md](references/patterns.md)。
4. **自检**：每次改完跑 `canvas_check`。它只编译不渲染，所以能立刻暴露语法错误、非法 import、`DATA` 不纯等问题。
5. **目视**：打开 tab 看一次。`canvas_check` 通过不等于渲染正确——渲染期才会暴露的问题（例如超行数截断）只有看才知道。

## 保持小的纪律

画布唯一的失败模式是**长成第二个巨型 markdown**。四条纪律：

- `DATA` 是唯一允许长大的部分，而**渲染代码超过约 400 行就该拆成多个画布**（一个索引画布 + 若干子画布）。
- **内联只保留"当前窗口"**：未完成 + 最近完成的若干条。历史不该住在画布里。
- **`note` / 描述类字段超过约 120 字就要改成引用**：写 `crates/occt-topo/src/brep_surface.rs:306` 或"见 t323"，不要把整段分析粘进来。粘贴是文件膨胀的唯一原因。
- 触发软阈值（源码 128 KB / 1500 行 / `DATA` 512 KB）时会有 `W_LARGE_FILE` 警告——**把它当成必须处理的信号**，不是噪音。

## 读画布不要全文读

因为数据内联，全文重读是最贵的操作。常规循环是：

~~~text
canvas_read(path, "tasks", { status: "pending" })   # 只取要动的那些
   -> 干活
   -> 用普通文件编辑改那几条的 status
   -> canvas_check(path)                             # 自检
~~~

`canvas_read` 会抽取 `DATA`、合并人的改动、按 `dataPath` / `filter` / `ids` 切片并给出统计。**只有需要改版式时才读源文件的渲染部分。**

## 接手一张已有的画布（截断 / 换会话）

会话被压缩、上下文被截断、或另一个 agent 接手时：**先读画布再读代码**，而且不要全文读。

~~~text
canvas_read(path, brief: true)     # goal + nextAction + constraints + decisions + 在办行 + 最近活动
   -> 按 nextAction.taskId 读那一条
   -> 动手前跑门禁画布
~~~

`brief` 就是为这件事做的切片（1~3 KB），给的是「要去哪 / 什么不能碰 / 什么已经定了 /
现在做什么」。判断口径（画布自己是否过期、怎么和仓库对账、写回纪律）见
[references/resume.md](references/resume.md)。

## 人机一致

两个状态钩子语义完全不同，用错就会让"人看到的"和"agent 看到的"分叉：

| 钩子 | 存在哪 | agent 可见？ | 放什么 |
|---|---|---|---|
| `useCanvasState` | 浏览器 localStorage | **否** | 筛选器、当前选中项、折叠状态等纯 UI 态 |
| `useCanvasOverlay` | 同目录 `.canvas/<stem>.state.json`（sidecar） | **是**（`canvas_read` 可读） | 人做的判断：标记进行中 / 完成 / 认领 / 豁免 / 置顶 |

规则：**只要这个改动会影响你下一轮该做什么，就必须走 `useCanvasOverlay`。** 人在画布上点了"完成"，你下一轮必须能看见，并把它当作人的指令对待。

人的改动留在 sidecar 里是暂存；当你确认要把它们固化进源文件时，用 `canvas_state_merge`（它只做最小字段替换，不会重排整个文件）。源文件改动后 sidecar 不会自动丢弃，`canvas_read` 会用 `staleOverlay` / `orphan` 告诉你哪些需要复核。

## 反模式

| 反模式 | 为什么坏 | 正确做法 |
|---|---|---|
| 把 300+ 条全内联，`note` 粘贴几万字 | 文件长成第二个巨型 markdown，每次编辑都是全文重写 | 只内联当前窗口；历史外置 |
| 用画布当日志 | 日志是 append-only，画布是状态快照 | 日志用文件，画布只显示最近 N 条 |
| 在画布里做业务逻辑（算门禁、拼命令） | 逻辑藏在 UI 里，agent 复用不了，也过不了 `canvas_check` | 逻辑放工具 / harness，画布只显示与触发 |
| 用 `useState` 存应当持久的状态 | 刷新即丢，agent 也看不到 | `useCanvasState`（UI 态）/ `useCanvasOverlay`（共享态） |
| 多个画布互相复制同一份数据 | 双源漂移 | 一个画布一个数据源；跨画布用 `openFile` 链接 |
| 自定义 CSS / 颜色 / 像素间距 | 主题切换就崩，且与宿主不一致 | 只用 `tone` / `size`；只有美术元素才用 `useHostTheme()` |
| 画布里放 `fetch` / `setTimeout` / `document` | 直接编译失败（`E_SIDE_EFFECT` / `E_EXTERNAL`） | 需要数据就写进 `DATA`；需要动作就走 `useCanvasAction` |

## 工具速查

| 工具 | 什么时候用 |
|---|---|
| `canvas_new` | 新建画布（唯一正确的起步方式） |
| `canvas_check` | 每次改完源文件后自检 |
| `canvas_read` | 需要看数据时（切片，不要全文读）；截断后接手用 `brief: true` |
| `canvas_state_merge` | 要把人的 sidecar 改动固化进源文件时 |

## Read next

| 任务 | 文件 |
|---|---|
| **入口 intake（审计 / 工程分析 → 画布）** | [references/intake.md](references/intake.md) |
| 套件完整 API（组件 props、tone 枚举、钩子签名、CanvasAction） | [references/kit.md](references/kit.md) |
| 四类画布范式（看板 / 门禁 / 时间线 / 对比）与关键片段 | [references/patterns.md](references/patterns.md) |
| 诊断码逐条修法（`E_PARSE` / `E_DATA_NOT_LITERAL` / `W_LARGE_FILE` ...） | [references/troubleshooting.md](references/troubleshooting.md) |
| **截断 / 换会话后怎么接手**（`brief` 读取配方、过期判断、写回纪律） | [references/resume.md](references/resume.md) |
| 可直接运行的起步模板 | [templates/board.canvas.tsx](templates/board.canvas.tsx)、[templates/gates.canvas.tsx](templates/gates.canvas.tsx)、[templates/blank.canvas.tsx](templates/blank.canvas.tsx) |
