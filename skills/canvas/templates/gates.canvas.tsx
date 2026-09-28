/** @canvas
 * title: Gate dashboard
 * description: 一组可复现检查的通过情况，并可当场重跑
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
  Pill,
  Button,
  CollapsibleSection,
  useCanvasState,
  useCanvasOverlay,
  useCanvasAction,
} from "dsh/canvas";

type GateStatus = "pass" | "fail" | "acked" | "missing";

// 注：overlay 只能覆盖 DATA 里出现过的字面量。因为 DATA 用了 as const，
// 上面 GateStatus 里的每个值都应该至少在一个 gate 上出现一次，
// 否则 overlay.set(id, { status: "..." }) 在编辑器里会报类型不匹配。
export const DATA = {
  baseline: "reference: data/occ-*.obj, deflection 0.1",
  gates: [
    {
      id: "phase19",
      runId: "gate:phase19",
      command: "cargo test -p occt-topo phase19",
      baseline: "5/5",
      last: "5/5",
      status: "pass",
      at: "2026-09-21 14:02",
    },
    {
      id: "parity",
      runId: "gate:parity",
      command: "cargo test -p occt-topo step_obj_parity",
      baseline: "14/14",
      last: "13/14",
      status: "fail",
      at: "2026-09-21 14:05",
    },
    {
      id: "export",
      runId: "gate:export",
      command: "cargo run --example export_data_obj",
      baseline: "16/16",
      last: "16/16",
      status: "pass",
      at: "2026-09-21 13:58",
    },
    {
      id: "flake",
      runId: "gate:flake",
      command: "cargo test -p occt-topo step_to_obj",
      baseline: "13/13",
      last: "12/13",
      status: "acked",
      at: "2026-09-21 13:40",
    },
  ],
} as const;

const TONE: Record<GateStatus, "success" | "danger" | "neutral" | "warning"> = {
  pass: "success",
  fail: "danger",
  acked: "neutral",
  missing: "warning",
};

const LABEL: Record<GateStatus, string> = {
  pass: "pass",
  fail: "fail",
  acked: "acked",
  missing: "not run",
};

export default function GateDashboard() {
  const dispatch = useCanvasAction();
  const [filter, setFilter] = useCanvasState<string>("filter", "all");
  // 人的确认走 overlay（不是 useCanvasState）：agent 必须能看见"这条红被接受了"。
  const overlay = useCanvasOverlay("gates", DATA.gates);

  const gates = overlay.items;
  const failing = gates.filter((g) => g.status === "fail");
  const visible = filter === "failing" ? failing : gates;
  const lastRun = gates.reduce((acc, g) => (g.at > acc ? g.at : acc), "");

  const run = async (g: (typeof DATA.gates)[number]) => {
    const r = await dispatch({ type: "runCommand", id: g.runId });
    if (!r.ok) {
      // 白名单未登记、ctx.shell 缺失或启动失败：在画布上说出来，不要静默失败。
      await dispatch({ type: "notify", tone: "warning", message: g.id + " 未执行: " + r.message });
      return;
    }
    // 动作成功 != 门禁通过：退出码才是结果，红门禁必须红着显示。
    await dispatch({
      type: "notify",
      tone: r.exitCode === 0 ? "success" : "warning",
      message: g.id + " exit=" + String(r.exitCode) + (r.timedOut === true ? "（超时）" : ""),
    });
  };

  // 顺序执行：门禁通常是重命令（编译 / 对拍），并发触发会互相抢资源。
  const runAll = async () => {
    // 顺序执行：门禁通常是重命令（编译 / 对拍），并发触发会互相抢资源。
    let denied = 0;
    let failed = 0;
    for (const g of gates) {
      const r = await dispatch({ type: "runCommand", id: g.runId });
      if (!r.ok) denied += 1;
      else if (r.exitCode !== 0) failed += 1;
    }
    await dispatch({
      type: "notify",
      tone: denied > 0 || failed > 0 ? "warning" : "info",
      message: denied > 0 || failed > 0
        ? String(denied) + " 条未执行（白名单 / 权限），" + String(failed) + " 条非零退出"
        : "全部门禁退出码为 0",
    });
  };

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>Gates</H1>
        <Text tone="secondary">
          基线：<Code>{DATA.baseline}</Code>
        </Text>
      </Stack>

      <Grid columns={4} gap={16}>
        <Stat value={gates.length} label="gates" />
        <Stat value={gates.filter((g) => g.status === "pass").length} label="pass" tone="success" />
        <Stat value={failing.length} label="fail" tone={failing.length > 0 ? "danger" : "neutral"} />
        <Stat value={gates.filter((g) => g.status === "acked").length} label="acked" tone="neutral" />
      </Grid>

      {failing.length > 0 ? (
        <Callout tone="danger" title={String(failing.length) + " 条门禁未通过"}>
          <Stack gap={4}>
            {failing.map((g) => (
              <Text key={g.id} size="small">
                <Code>{g.id}</Code> 基线 {g.baseline} → 最近 {g.last}
              </Text>
            ))}
          </Stack>
        </Callout>
      ) : (
        <Callout tone="success" title="全部门禁通过">
          保持基线：不要把数字抄进 DATA，让它来自真实运行结果。
        </Callout>
      )}

      <Row gap={8} wrap>
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>
          All {gates.length}
        </Pill>
        <Pill active={filter === "failing"} onClick={() => setFilter("failing")}>
          Failing {failing.length}
        </Pill>
        <Button onClick={runAll}>Run all</Button>
        {lastRun.length > 0 ? (
          <Text size="small" tone="tertiary">
            最近一次：{lastRun}
          </Text>
        ) : null}
      </Row>

      <Table
        headers={["Gate", "基线", "最近", "Δ", "状态", "操作"]}
        columnAlign={["left", "left", "left", "right", "left", "left"]}
        striped
        stickyHeader
        emptyText="没有门禁"
        rows={visible.map((g) => [
          <Code>{g.id}</Code>,
          g.baseline,
          g.last,
          g.baseline === g.last ? "0" : "changed",
          <Pill size="sm" tone={TONE[g.status]}>
            {LABEL[g.status]}
          </Pill>,
          <Button size="sm" onClick={() => run(g)}>
            Run
          </Button>,
        ])}
        rowTone={visible.map((g) => TONE[g.status])}
      />

      <Grid columns="minmax(0, 1.2fr) minmax(0, 0.8fr)" gap={20} align="start">
        <Card>
          <CardHeader trailing={<Pill size="sm" tone="neutral">人工确认</Pill>}>
            接受一条红门禁
          </CardHeader>
          <CardBody>
            <Stack gap={12}>
              <Text size="small" tone="secondary">
                确认只表示"我知道它红着，且现在接受"。改动落进 sidecar，agent 下一轮通过
                canvas_read 就能看到。
              </Text>
              <Row gap={8} wrap>
                {gates.map((g) => (
                  <Button
                    key={g.id}
                    size="sm"
                    variant={g.status === "acked" ? "primary" : "ghost"}
                    disabled={g.status === "acked"}
                    onClick={() => overlay.set(g.id, { status: "acked" })}
                  >
                    {g.id}
                  </Button>
                ))}
              </Row>
              <Divider />
              <Row gap={8} wrap>
                <Button
                  variant="ghost"
                  onClick={() => overlay.clear()}
                >
                  清空人工确认
                </Button>
              </Row>
            </Stack>
          </CardBody>
        </Card>

        <CollapsibleSection title="Run 按钮为什么会被拒绝" trailing={<Pill size="sm" tone="warning">需配置</Pill>}>
          <Stack gap={8}>
            <Text size="small">
              runCommand 默认全部拒绝。先在插件 Config 的 commandWhitelist 里登记，且要逐字匹配：
            </Text>
            <Code>{"commandWhitelist: [{ id: 'gate:phase19', command: 'cargo test -p occt-topo phase19' }]"}</Code>
            <Text size="small" tone="tertiary">
              被拒时动作返回 code: "denied" —— 画布要显式提示，而不是假装成功。
            </Text>
          </Stack>
        </CollapsibleSection>
      </Grid>

      <H2>口径</H2>
      <Text size="small" tone="tertiary">
        每行的基线与最近值都应来自真实运行输出；本画布只负责显示与触发。
      </Text>
    </Stack>
  );
}
