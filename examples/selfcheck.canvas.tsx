/** @canvas
 * title: Canvas plugin self-check
 * description: Every kit surface the host test suite compiles, rendered as one board.
 * icon: board
 */
import {
  H1, H2, Text, Code, Stack, Row, Grid, Divider, Card, CardBody, CardHeader,
  Callout, Stat, Table, BarChart, TodoList, Pill, Button, CollapsibleSection,
  useCanvasState, useCanvasOverlay, useCanvasAction, useMemo,
} from "dsh/canvas";

type Status = "pending" | "in_progress" | "completed" | "cancelled";
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const DATA = {
  checks: [
    { id: "c1", title: "compile -> serve -> import -> render", status: "completed",
      host: "test/serve.test.mjs", note: "13 assertions" },
    { id: "c2", title: "literal DATA extraction", status: "completed",
      host: "test/core.test.mjs", note: "15 assertions" },
    { id: "c3", title: "client bundle served by the GUI", status: "pending",
      host: "/plugins/@local/dsh-canvas/client.js", note: "needs a GUI restart" },
    { id: "c4", title: "sidecar overlay round-trip", status: "completed",
      host: ".canvas/<stem>.state.json", note: "verified on disk" },
  ],
  series: [
    { name: "host tests", data: [13, 15, 0] , tone: "info" },
    { name: "browser tests", data: [0, 0, 0], tone: "warning" },
  ],
  stages: ["host e2e", "host core", "browser"],
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

      <Grid columns={3} gap={12}>
        <Stat value={String(done) + "/" + String(rows.length)} label="Stages verified" tone="success" />
        <Stat value="28" label="Host assertions" tone="info" />
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

      <Row gap={8} wrap>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>All {rows.length}</Pill>
        <Pill active={filter === "open"} onClick={() => setFilter("open")}>Open {open.length}</Pill>
        <Pill onClick={() => overlay.set("c1", { status: "pending" })}>Reset c1</Pill>
      </Row>

      <Grid columns="minmax(0, 1fr) minmax(0, 0.85fr)" gap={16} align="start">
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
                <Text size="small">Harness: <Code>{active.host}</Code></Text>
                <Text size="small" tone="tertiary">{active.note}</Text>
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
      </Grid>

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
    </Stack>
  );
}
