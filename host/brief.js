/**
 * Cold-start digest of a canvas's DATA.
 *
 * A canvas is the durable summary of a project. After a context truncation, or in
 * a fresh session, an agent should re-hydrate from a few KB rather than the whole
 * file -- and it should be able to do so without re-litigating settled ground.
 * The digest therefore answers four questions in a fixed order:
 *
 *   1. where are we going   -> goal / asOf / revision / staleDays
 *   2. what must not break  -> constraints
 *   3. what is already decided -> decisions (chose vs rejected)
 *   4. what now             -> nextAction + the rows still in flight
 *
 * Everything else stays behind canvas_read's dataPath slices.
 */

/** Statuses that still need someone's attention. */
const OPEN_STATUSES = new Set(["in_progress", "blocked", "pending"]);

/** Fields kept per in-flight row: enough to act, short enough to stay cheap. */
const FOCUS_FIELDS = [
  "id", "lane", "title", "status", "priority", "owner", "progress",
  "updatedAt", "blocker", "dependsOn", "next", "acceptance",
];

/**
 * Copy only the defined, non-empty fields, so the digest has no blank noise.
 * @param row - Source object.
 * @param fields - Field names to keep, in order.
 * @returns A new object holding just those fields.
 */
function pick(row, fields) {
  const out = {};
  if (row === null || typeof row !== "object") return out;
  for (const field of fields) {
    const value = row[field];
    if (value === undefined || value === "" || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[field] = value;
  }
  return out;
}

/**
 * Whole days from an ISO date (or date-time) to now.
 * @param iso - Date string from DATA.
 * @param now - Epoch milliseconds used as "today".
 * @returns Day count, or undefined when the value is absent or unparseable.
 */
function daysSince(iso, now) {
  if (typeof iso !== "string" || iso === "") return undefined;
  const then = Date.parse(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((now - then) / 86400000));
}

/**
 * Compose the resume digest: a self-contained, ordered answer to "where are we".
 * @param data - The canvas DATA object, with sidecar overlays already merged.
 * @param options - `now` (Date), `focusLimit` and `activityLimit` (row caps).
 * @returns A plain object ready to JSON-serialize into the tool result.
 */
export function briefDigest(data, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const focusLimit = Number.isInteger(options.focusLimit) ? options.focusLimit : 20;
  const activityLimit = Number.isInteger(options.activityLimit) ? options.activityLimit : 3;
  const tasks = Array.isArray(data.tasks) ? data.tasks.filter((t) => t !== null && typeof t === "object") : [];
  const ids = new Set(tasks.map((t) => t.id));
  const notes = [];

  const focus = tasks.filter((t) => OPEN_STATUSES.has(t.status)).slice(0, focusLimit).map((t) => pick(t, FOCUS_FIELDS));

  const nextAction = data.nextAction === undefined || data.nextAction === null
    ? data.nextAction
    : pick(data.nextAction, ["taskId", "action", "why"]);
  if (data.nextAction === undefined || data.nextAction === null) {
    notes.push("no nextAction in DATA: after a truncation the agent cannot tell which single step comes first");
  } else {
    if (typeof data.nextAction.action !== "string" || data.nextAction.action === "") notes.push("nextAction.action is empty");
    if (typeof data.nextAction.taskId === "string" && !ids.has(data.nextAction.taskId)) {
      notes.push("nextAction.taskId " + data.nextAction.taskId + " does not exist in tasks[]");
    }
  }
  for (const task of tasks) {
    if (!Array.isArray(task.dependsOn)) continue;
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) notes.push("task " + String(task.id) + " dependsOn unknown task " + String(dependency));
    }
  }
  if (tasks.length > 0) {
    if (data.constraints === undefined) notes.push("no constraints in DATA: red lines are not recorded where a resuming agent will read them");
    if (data.decisions === undefined) notes.push("no decisions in DATA: settled trade-offs can be re-litigated after a truncation");
  }

  const activity = Array.isArray(data.activity) ? data.activity : [];
  return {
    goal: data.goal,
    asOf: data.asOf,
    asOfAgeDays: daysSince(data.asOf, now),
    revision: data.revision,
    staleDays: data.staleDays,
    nextAction,
    constraints: Array.isArray(data.constraints) ? data.constraints : [],
    decisions: Array.isArray(data.decisions) ? data.decisions : [],
    focus,
    counts: { tasks: tasks.length, focus: focus.length, closed: tasks.length - focus.length },
    recentActivity: activity.slice(0, activityLimit)
      .filter((row) => row !== null && typeof row === "object")
      .map((row) => pick(row, ["id", "at", "title", "tone", "detail", "ref"])),
    notes,
  };
}
