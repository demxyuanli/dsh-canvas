# 截断之后怎么接上

会话被压缩、上下文被截断、或者换一个 agent 接手时：**先读画布，再读代码**。
画布是这份项目的持久摘要，`canvas_read brief` 一次给全 —— 目标就是用 1~2 KB 重建
"要去哪 / 什么不能碰 / 什么已经定了 / 现在做什么"。

## 四步，按这个顺序

| # | 调用 | 拿到什么 | 期望大小 |
|---|---|---|---|
| 1 | `canvas_read(path, brief: true)` | goal、asOfAgeDays、revision、**nextAction**、constraints、decisions、在办行、最近 3 条活动、notes | 1~3 KB |
| 2 | `canvas_read(path, dataPath:"tasks", ids:[nextAction.taskId])` | 那一条的 goal / next / acceptance / evidence / write / ref | < 1 KB |
| 3 | 需要再往前翻：`canvas_read(path, dataPath:"activity", limit:5)` | 刚发生了什么、谁改的 | ~1 KB |
| 4 | 动手前跑门禁画布（如果项目有） | 机器可验的真实状态 | — |

**不要**一上来把整份画布读进 context（省略 `dataPath` 就是全量）。先 brief，再按需下钻。

## 判断画布自己是否过期

`brief` 会给出 `asOfAgeDays` 和 `notes`，逐条对：

- `asOfAgeDays > staleDays` → 画布整体过期，先核对仓库再动手；
- notes 里有 `no nextAction` → 没有唯一动作，**先补上**，不要凭感觉挑活；
- notes 里有 `nextAction.taskId 不存在` / `dependsOn 指向未知任务` → 画布内部不一致，先修；
- 某条 `updatedAt` 已超过 `staleDays` 天 → 那一条的进度大概率不准，动手前先确认。

`revision` 是画布自己的版本号，**不是 commit sha**。要和仓库对账，看 `evidence` 里指向的 `file:line` 与运行号，以及门禁的退出码。

## 写回纪律

1. **先读后写**：改 `DATA` 之前先 `canvas_read` 一次，避免覆盖别人刚写的状态；
2. **只改自己的行**：状态、进度、`updatedAt`、`evidence`；不要顺手改别人的；
3. **人的裁决走 overlay**：画布上的按钮写进 sidecar，确认后由 agent 用 `canvas_state_merge` 固化回 `DATA`；
4. **新增决定就补一条** `decisions`（连同被否决的方案），不要只写结论；
5. **收尾时更新** `asOf` / `revision` / `nextAction`，并把刚做完的事写成 `activity` 的第一条。

## 反模式

- **凭记忆改 DATA** —— 画布里的数据是事实，不是提示；
- **重开 `decisions` 里已经否决过的方案** —— 先读那一节，再决定要不要推翻；
- **把 `evidence` 的自由文本当硬证据** —— 它会过期；硬证据是退出码与 `file:line`；
- **把历史全塞进当前窗口** —— 只保留当前窗口（在办 + 最近完成），更早的移出或归档。

## 相关

- 画布该有哪些字段才够接手：[patterns.md](patterns.md) 的看板范式
- 套件 API 与排版约定：[kit.md](kit.md)
- 意图入口与 7 问 intake：[intake.md](intake.md)
- 诊断码：[troubleshooting.md](troubleshooting.md)
