/** @canvas
 * title: Task board
 * description: 多状态任务的监控看板：概览 + 筛选 + 待办 + 明细 + 详情 + 动作
 * icon: board
 */
import {
  H1,
  H2,
  Text,
  Code,
  Stack,
  Row,
  Grid,
  Divider,
  Card,
  CardBody,
  CardHeader,
  Callout,
  Stat,
  Table,
  TodoList,
  Pill,
  Button,
  CollapsibleSection,
  useMemo,
  useCanvasState,
  useCanvasOverlay,
  useCanvasAction,
} from "dsh/canvas";

type Status = "pending" | "in_progress" | "completed" | "cancelled";

// 注：overlay 只能覆盖 DATA 里出现过的字面量（DATA 用了 as const）。
// 下面四种 status 都至少出现一次，所以任意方向的 overlay.set 都能通过类型检查。
// 只内联"当前窗口"：未完成 + 最近完成。历史属于另一个文件，不属于这张画布。
export const DATA = {
  goal: "把导出管线对齐到参考基线",
  lanes: ["gate", "kernel", "hygiene"],
  tasks: [
    {
      id: "T-01",
      lane: "gate",
      title: "把端口自造阈值换成关系式",
      status: "in_progress",
      owner: "worker",
      occt: "BOPAlgo_Tools::...",
      write: "crates/topo/src/bop/p02.rs",
      goal: "断言只引用既有基线，不自造阈值",
      note: "见 t04",
    },
    {
      id: "T-02",
      lane: "kernel",
      title: "未移植的极值搜索窗口",
      status: "pending",
      owner: "-",
      occt: "Analysis_Surface.cxx:1340-1352",
      write: "crates/topo/src/pcurve/p01.rs",
      goal: "把窗口扩张分支移植进去",
      note: "见 t323",
    },
    {
      id: "T-03",
      lane: "gate",
      title: "parity 掉了一条",
      status: "pending",
      owner: "-",
      occt: "-",
      write: "crates/topo/src/export.rs",
      goal: "定位回归来源并恢复",
      note: "见 t326",
    },
    {
      id: "T-04",
      lane: "hygiene",
      title: "删除遗留的调试门",
      status: "completed",
      owner: "worker",
      occt: "-",
      write: "crates/topo/src/mesh/healer.rs",
      goal: "移除编译进产物的临时探针",
      note: "已完成",
    },
    {
      id: "T-05",
      lane: "kernel",
      title: "已放弃的旧方案",
      status: "cancelled",
      owner: "-",
      occt: "-",
      write: "crates/topo/src/legacy.rs",
      goal: "只记录为何不做",
      note: "见 t19",
    },
  ],
} as const;

const STATUS_TONE: Record<Status, "neutral" | "warning" | "success" | "danger"> = {
  pending: "neutral",
  in_progress: "warning",
  completed: "success",
  cancelled: "danger",
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "todo",
  in_progress: "active",
  completed: "done",
  cancelled: "cancelled",
};

export default function TaskBoard() {
  const dispatch = useCanvasAction();
  // 筛选器与当前选中项是纯 UI 态：agent 不需要知道，刷新后保留即可。
  const [filter, setFilter] = useCanvasState<string>("filter", "open");
  const [activeId, setActiveId] = useCanvasState<string>("active", "T-01");
  // 人的状态改动必须走 overlay：它落在 sidecar 里，agent 下一轮 canvas_read 就能看到。
  const overlay = useCanvasOverlay("tasks", DATA.tasks);

  const tasks = overlay.items;
  const open = useMemo(
    () => tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
    [tasks],
  );
  const closed = useMemo(
    () => tasks.filter((t) => t.status === "completed" || t.status === "cancelled"),
    [tasks],
  );
  const visible = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "open") return open;
    if (filter === "closed") return closed;
    return open.filter((t) => t.lane === filter);
  }, [tasks, open, closed, filter]);

  const active = tasks.find((t) => t.id === activeId) ?? visible[0] ?? tasks[0];
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const done = tasks.filter((t) => t.status === "completed").length;

  const startTurn = (t: (typeof DATA.tasks)[number]) =>
    dispatch({
      type: "startTurn",
      prompt:
        "处理 " + t.id + "：" + t.title +
        "\n目标：" + t.goal +
        "\n参考：" + t.occt +
        "\n改动位置：" + t.write +
        "\n遵守项目既有约束；只改与本任务相关的代码。",
    });

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>Task board</H1>
        <Text tone="secondary">{DATA.goal}</Text>
      </Stack>

      <Grid columns={4} gap={16}>
        <Stat value={tasks.length} label="tracked" />
        <Stat value={open.length} label="open" tone="warning" />
        <Stat value={inProgress} label="in progress" tone="info" />
        <Stat value={done} label="done" tone="success" />
      </Grid>

      <Callout tone="info" title="人与 agent 共用一份真相">
        面板上的状态改动落进 sidecar，agent 下一轮就能读到；筛选器只是本机 UI，不影响数据。
        明细里的数字来自真实产物，不要手抄。
      </Callout>

      <Row gap={8} wrap>
        <Pill active={filter === "open"} onClick={() => setFilter("open")}>
          Open {open.length}
        </Pill>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>
          All {tasks.length}
        </Pill>
        <Pill active={filter === "closed"} onClick={() => setFilter("closed")}>
          Closed {closed.length}
        </Pill>
        <Divider />
        {DATA.lanes.map((lane) => (
          <Pill key={lane} active={filter === lane} onClick={() => setFilter(lane)}>
            {lane}
          </Pill>
        ))}
      </Row>

      <Grid columns="minmax(0, 1.1fr) minmax(0, 0.9fr)" gap={20} align="start">
        <Stack gap={12}>
          <H2>Todo</H2>
          <TodoList
            todos={visible.map((t) => ({ id: t.id, status: t.status, content: t.title }))}
            onTodoClick={(todo) => setActiveId(todo.id)}
          />
          <CollapsibleSection title="Closed" count={closed.length}>
            <TodoList
              dense
              todos={closed.map((t) => ({ id: t.id, status: t.status, content: t.title }))}
              onTodoClick={(todo) => setActiveId(todo.id)}
            />
          </CollapsibleSection>
        </Stack>

        {active ? (
          <Card>
            <CardHeader trailing={<Pill size="sm" tone={STATUS_TONE[active.status]}>{STATUS_LABEL[active.status]}</Pill>}>
              {active.id}
            </CardHeader>
            <CardBody>
              <Stack gap={12}>
                <Text weight="semibold">{active.title}</Text>
                <Text>{active.goal}</Text>
                <Text size="small">
                  分组：<Code>{active.lane}</Code> · 负责人：<Code>{active.owner}</Code>
                </Text>
                <Text size="small">
                  参考：<Code>{active.occt}</Code>
                </Text>
                <Text size="small">
                  改动：<Code>{active.write}</Code>
                </Text>
                <Text size="small" tone="tertiary">
                  {active.note}
                </Text>
                <Divider />
                <Row gap={8} wrap>
                  <Button variant="primary" onClick={() => startTurn(active)}>
                    Start in chat
                  </Button>
                  <Button onClick={() => overlay.set(active.id, { status: "in_progress" })}>
                    Mark active
                  </Button>
                  <Button onClick={() => overlay.set(active.id, { status: "completed" })}>
                    Mark done
                  </Button>
                  <Button variant="ghost" onClick={() => overlay.clear(active.id)}>
                    Reset to source
                  </Button>
                  <Button variant="ghost" onClick={() => dispatch({ type: "openFile", path: active.write })}>
                    Open file
                  </Button>
                </Row>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
      </Grid>

      <H2>Detail</H2>
      <Table
        headers={["ID", "分组", "标题", "状态", "负责人", "改动文件"]}
        columnAlign={["left", "left", "left", "left", "left", "left"]}
        striped
        stickyHeader
        emptyText="没有条目"
        onRowClick={(index) => {
          const row = visible[index];
          if (row) setActiveId(row.id);
        }}
        rows={visible.map((t) => [
          <Code>{t.id}</Code>,
          t.lane,
          t.title,
          <Pill size="sm" tone={STATUS_TONE[t.status]}>
            {STATUS_LABEL[t.status]}
          </Pill>,
          t.owner,
          <Code>{t.write}</Code>,
        ])}
        rowTone={visible.map((t) => STATUS_TONE[t.status])}
      />

      <Text size="small" tone="tertiary">
        这张画布只保留当前窗口。要归档，把已完成条目移到另一个画布或外置文件。
      </Text>
    </Stack>
  );
}
