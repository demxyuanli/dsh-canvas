/** @canvas
 * title: Canvas plugin self-check
 * description: Every kit surface the host test suite compiles, rendered as one board.
 * icon: board
 */
import {
  H1, H2, Text, Code, Stack, Grid, Row, Divider, Card, CardBody, CardHeader,
  Callout, Stat, Table, BarChart, HeatMatrix, TodoList, Pill, Button, CollapsibleSection,
  Progress, KeyValue, Timeline,
  useCanvasState, useCanvasOverlay, useCanvasAction, useMemo,
} from "dsh/canvas";

type Status = "pending" | "in_progress" | "completed" | "cancelled";
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const DATA = {
  checks: [
    { id: "c1", title: "compile -> serve -> import -> render", status: "completed",
      host: "test/serve.test.mjs", note: "22 assertions" },
    { id: "c2", title: "literal DATA extraction", status: "completed",
      host: "test/core.test.mjs", note: "15 assertions" },
    { id: "c3", title: "client bundle served and rendered by the GUI", status: "completed",
      host: "/plugins/@demxyuanli/dsh-canvas/client.js", note: "renders in the running page" },
    { id: "c4", title: "sidecar overlay round-trip", status: "completed",
      host: ".canvas/<stem>.state.json", note: "verified on disk" },
    { id: "c5", title: "human edits merge back into DATA", status: "completed",
      host: "test/merge.test.mjs + test/tools.test.mjs", note: "20 assertions" },
    { id: "c6", title: "canvas intent entry on agent/pre-step", status: "completed",
      host: "test/intent.test.mjs", note: "13 assertions" },
    { id: "c7", title: "canvas tab owns its scroll container and padding", status: "completed",
      host: "test/client.test.mjs", note: "asserted on both render paths" },
    { id: "c8", title: "typography mapped to the harness scale", status: "completed",
      host: "test/client.test.mjs", note: "13px base, no multiplier" },
    { id: "c9", title: "startTurn passes mode + AbortSignal", status: "completed",
      host: "test/serve.test.mjs", note: "the button really queues a turn" },
    { id: "c10", title: "action envelope matches on both halves", status: "completed",
      host: "test/client.test.mjs", note: "client body asserted, host tolerant" },
    { id: "c11", title: "runCommand verified on the live host", status: "completed",
      host: "POST /canvas/action", note: "gate:tests + gate:templates exit=0" },
    { id: "c12", title: "intent entry ignores canvas-submitted tasks", status: "completed",
      host: "test/intent.test.mjs", note: "canvas-* rpcId filtered" },
  ],
  series: [
    { name: "host tests", data: [16, 15, 0] , tone: "info" },
    { name: "browser tests", data: [0, 0, 0], tone: "warning" },
  ],
  // Heat-matrix demo: how many times each check was touched, per round. A real
  // board derives the same shape from its own records (see patterns.md).
  iterations: {
    columns: ["R1", "R2", "R3", "R4", "R5"],
    rows: [
      { id: "c1", values: [3, 1, 0, 1, 0], status: "completed" },
      { id: "c2", values: [2, 0, 0, 0, 0], status: "completed" },
      { id: "c6", values: [0, 2, 3, 1, 0], status: "completed" },
      { id: "c7", values: [1, 4, 2, 0, 0], status: "completed" },
      { id: "c11", values: [0, 0, 1, 2, 3], status: "completed" },
      { id: "c12", values: [0, 0, 0, 1, 2], status: "completed" },
    ],
  },
  stages: ["host e2e", "host core", "browser"],
  activity: [
    { id: "a1", at: "2026-09-27", title: "host pipeline verified", tone: "success", detail: "compile / module / action / sidecar over HTTP", ref: "test/serve.test.mjs" },
    { id: "a2", at: "2026-09-28", title: "canvas tab renders in the GUI", tone: "success", detail: "kit v1.1 components render; tab body now owns its scroll container", ref: "lib/client.js" },
    { id: "a3", at: "2026-09-28", title: "typography mapped to the harness scale", tone: "success", detail: "sidebar base is 13px; the invalid --dsw-font-mono token is gone", ref: "lib/client.js" },
  ],
} as const;

const STATUS_TONE: Record<Status, Tone> = {
  pending: "neutral", in_progress: "warning", completed: "success", cancelled: "danger",
};

function label(s: Status) {
  if (s === "completed") return "done";
  if (s === "in_progress") return "active";
  if (s === "cancelled") return "cancelled";
  return "todo";
}

export default function SelfCheck() {
  const dispatch = useCanvasAction();
  const [filter, setFilter] = useCanvasState("filter", "all");
  const [activeId, setActiveId] = useCanvasState("active", "c1");
  const overlay = useCanvasOverlay("checks", DATA.checks as unknown as Array<{ id: string; status: Status }>);

  const rows = useMemo(
    () => overlay.items.map((row) => ({ ...row, status: (row.status ?? "pending") as Status })),
    [overlay.items],
  );
  const open = rows.filter((row) => row.status !== "completed" && row.status !== "cancelled");
  const visible = filter === "open" ? open : rows;
  const active = rows.find((row) => row.id === activeId) ?? rows[0];
  const done = rows.filter((row) => row.status === "completed").length;

  return (
    <Stack gap={20}>
      <H1>Canvas plugin self-check</H1>
      <Text tone="secondary">
        The host compiles this file and renders it live. Edit it and the tab updates;
        the buttons below hand work back to the agent.
      </Text>

      {/* 概览卡只有「一个数字 + 一句标签」，允许并排 */}
      <Grid columns="repeat(auto-fit, minmax(120px, 1fr))" gap={12}>
        <Stat value={String(done) + "/" + String(rows.length)} label="Stages verified" tone="success" />
        <Stat value="94" label="Host assertions" tone="info" />
        <Stat value="0" label="Browser assertions" tone="warning" hint="no browser control in this session" />
      </Grid>

      <Callout tone="warning" title="What is NOT verified yet">
        The client bundle is only served after the GUI restarts, because the running page
        composed its module graph before this plugin was installed.
      </Callout>

      <H2>Assertions per stage</H2>
      <BarChart
        categories={DATA.stages as unknown as string[]}
        series={DATA.series.map((s) => ({ name: s.name, data: s.data as unknown as number[], tone: s.tone as Tone }))}
        beginAtZero
        height={200}
      />

      <H2>Iterations per round</H2>
      <Text size="caption" tone="tertiary">
        同一份数据两种 layout：matrix 保留时间维度（行 = 任务，列 = 轮次），grid 把每行折成一格、按得色深浅铺开。
      </Text>
      <HeatMatrix
        columns={DATA.iterations.columns as unknown as string[]}
        rows={DATA.iterations.rows as unknown as Array<{ id: string; values: number[] }>}
        layout="matrix"
      />
      <HeatMatrix
        columns={DATA.iterations.columns as unknown as string[]}
        rows={DATA.iterations.rows as unknown as Array<{ id: string; values: number[] }>}
        layout="grid"
      />

      <Row gap={8} wrap>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>All {rows.length}</Pill>
        <Pill active={filter === "open"} onClick={() => setFilter("open")}>Open {open.length}</Pill>
        <Pill onClick={() => overlay.set("c1", { status: "pending" })}>Reset c1</Pill>
      </Row>

      <Stack gap={16}>
        <Stack gap={10}>
          <H2>Checks</H2>
          <TodoList
            todos={visible.map((row) => ({ id: row.id, status: row.status, content: row.title }))}
            onTodoClick={(todo) => setActiveId(todo.id)}
          />
          <CollapsibleSection title="Why the sidecar exists" count={1}>
            <Text size="small" tone="secondary">
              Clicking a row writes to the canvas sidecar, which the agent reads through
              canvas_read. Without it, human clicks would be invisible to the agent.
            </Text>
          </CollapsibleSection>
        </Stack>

        {active ? (
          <Card>
            <CardHeader trailing={<Pill size="sm" tone={STATUS_TONE[active.status]}>{label(active.status)}</Pill>}>
              {active.id.toUpperCase()}
            </CardHeader>
            <CardBody>
              <Stack gap={10}>
                <Text weight="semibold">{active.title}</Text>
                <Progress
                  value={active.status === "completed" ? 100 : active.status === "in_progress" ? 50 : 0}
                  size="sm"
                  showValue
                  label="check progress"
                />
                <KeyValue
                  dense
                  items={[
                    { label: "Harness", value: <Code>{active.host}</Code> },
                    { label: "Note", value: active.note },
                  ]}
                />
                <Divider />
                <Row gap={8} wrap>
                  <Button
                    variant="primary"
                    onClick={() => dispatch({
                      type: "startTurn",
                      prompt: "继续把 canvas 插件做完：" + active.title + "（" + active.host + "）。先跑现有测试确认基线，再改代码。",
                    })}
                  >
                    Start in chat
                  </Button>
                  <Button onClick={() => overlay.set(active.id, { status: "in_progress" })}>Mark active</Button>
                  <Button variant="ghost" onClick={() => overlay.set(active.id, { status: "completed" })}>Mark done</Button>
                  <Button variant="ghost" onClick={() => dispatch({ type: "openFile", path: active.host })}>Open file</Button>
                </Row>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
      </Stack>

      <H2>Detail</H2>
      <Table
        headers={["id", "check", "harness", "status"]}
        columnAlign={["left", "left", "left", "right"]}
        striped
        stickyHeader
        rowTone={rows.map((row) => STATUS_TONE[row.status])}
        rows={rows.map((row) => [row.id, row.title, row.host, row.status])}
        onRowClick={(index) => setActiveId(rows[index].id)}
      />

      <CollapsibleSection title="Activity" count={DATA.activity.length} defaultOpen>
        <Timeline
          events={DATA.activity.map((event) => ({
            id: event.id, at: event.at, title: event.title,
            tone: event.tone, detail: event.detail, ref: event.ref,
          }))}
        />
      </CollapsibleSection>
    </Stack>
  );
}
