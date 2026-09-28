/** @canvas
 * title: Blank canvas
 * description: 最小可运行骨架：先改 DATA，再按需改渲染
 * icon: board
 */
import {
  H1,
  Text,
  Code,
  Stack,
  Grid,
  Stat,
  Callout,
  CollapsibleSection,
} from "dsh/canvas";

// DATA 必须是纯字面量（无函数调用 / 无拼接 / 无非字面量 spread），
// 宿主才能在不执行代码的前提下抽取它，供 canvas_read 切片。
export const DATA = {
  title: "Blank canvas",
  note: "把条目写进 DATA，再按 references/patterns.md 选一个范式补渲染。",
  items: [
    { id: "item-1", title: "first item", status: "pending" },
    { id: "item-2", title: "second item", status: "completed" },
  ],
} as const;

export default function BlankCanvas() {
  const total = DATA.items.length;
  const done = DATA.items.filter((i) => i.status === "completed").length;

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>{DATA.title}</H1>
        <Text tone="secondary">{DATA.note}</Text>
      </Stack>

      <Grid columns={3} gap={16}>
        <Stat value={total} label="items" />
        <Stat value={done} label="completed" tone="success" />
        <Stat value={total - done} label="open" tone="warning" />
      </Grid>

      <Callout tone="info" title="下一步">
        <Stack gap={4}>
          <Text size="small">
            1. 把数据写进 <Code>export const DATA</Code>，只用字面量。
          </Text>
          <Text size="small">
            2. 要看板 / 门禁 / 时间线 / 对比，照 <Code>references/patterns.md</Code> 补渲染。
          </Text>
          <Text size="small">
            3. 改完跑 <Code>canvas_check</Code>，再打开 tab 目视一次。
          </Text>
        </Stack>
      </Callout>

      <CollapsibleSection title="items" count={total} defaultOpen>
        <Stack gap={4}>
          {DATA.items.map((item) => (
            <Text key={item.id} size="small">
              <Code>{item.id}</Code> {item.title} - {item.status}
            </Text>
          ))}
        </Stack>
      </CollapsibleSection>
    </Stack>
  );
}
