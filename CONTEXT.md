# dsh-canvas

DeepSeek Harness 的**画布插件**：agent 写 `*.canvas.tsx`，宿主编译并渲染成右栏面板；面板上的动作能回灌 agent。本文件只是术语表 —— 不放设计、不放实现。

## Language

**画布（canvas）**：
一份 `*.canvas.tsx` —— 编译、渲染、可下钻、可回写的最小单位。
_Avoid_: 画板、dashboard、文档

**看板（board）**：
画布的一种**范式**：盯一批条目的状态与进度。
_Avoid_: 拿"看板"当画布的同义词 —— 门禁、时间线、对比同样是画布

**模板（template）**：
`canvas_new` 复制出去的起步骨架，随包发布，不属于任何项目的工作区内容。
_Avoid_: 样例、demo

**实例（instance）**：
工作区里承载真实项目数据的画布。
_Avoid_: 正式画布

**草稿（draft）**：
模板在本机的一份副本，只作起步用，不进版本库。
_Avoid_: 临时画布、测试画布

**锚点（anchor）**：
顶层三块 `constraints` / `decisions` / `nextAction` 的合称 —— 回答「什么不能碰、什么已经定了、现在做什么」，是会话被截断后还能接手的依据。
_Avoid_: 元数据、上下文块

**overlay**：
人在面板上做出的判断，在它被固化回源文件之前的形态。
_Avoid_: 缓存、草稿（草稿是画布，不是判断）

**固化（merge）**：
把 overlay 写回源文件、成为源头事实的动作。
_Avoid_: 同步、提交

**hidden**：
画布头部的一个标记，声明"这不是一张活画布"（草稿或归档）。被标记的画布不进 picker，但仍留在仓库里。
_Avoid_: 禁用、删除、忽略
