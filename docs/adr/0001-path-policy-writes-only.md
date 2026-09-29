# 路径策略：读放开，写钉在工作区根内

`/canvas/*` 与画布工具的路径解析分成两类。**读**（`canvas_check` / `canvas_read` / `GET /canvas/source` / `GET /canvas/overlay` / `GET /canvas/list`）可以指向任意路径；**写**（`canvas_new`、`POST /canvas/overlay`、`overlaySet` / `overlayClear`、`canvas_state_merge`）必须落在该请求解析出的工作区根内，越界即拒绝。契约见 INTERFACE §3.1。

## Considered Options

- **全放开**：实现为零，但"任意目录造文件 / 写 sidecar / 回写源文件"三条都成立。
- **全钉住**（读也限制）：规则对称、最好解释；代价是跨仓引用与排查场景被误伤，而读的泄漏面很窄（只有能被当成画布解析的文件才会返回 `DATA`）。
- **只钉写**（本决定）：挡掉破坏性的那一半，读保持自由。
- **只钉写 + 允许列表**：多一份配置与文档；等真有"跨仓共享画布"的需求再开。

## Consequences

- 读写规则**不对称**，必须靠文档解释；将来若要给读加限制，那是**破坏性变更** —— 第三方画布可能已经依赖越界读。
- 权威根落到 `process.cwd()` 时写操作一律拒绝：Desktop 应用的 cwd 是 profile 目录，曾因此把画布建到了 `profiles/desktop/canvases/` 下。
- 容器检查是**路径前缀**级别，不解析符号链接：根内一个指向根外的链接仍可能被写入。要彻底挡住需要 realpath 处理，收益与成本不成比例。
