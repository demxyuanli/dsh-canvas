/**
 * Canvas client half: the dsh/canvas kit, its hooks, and the sidebar tab that
 * compiles and mounts agent-authored *.canvas.tsx files.
 *
 * Loaded by the DSH web client module loader. Zero dependencies beyond React
 * from the platform module table: no DSH client package is imported, so the kit
 * survives those packages changing.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-canvas",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useMemo = React.useMemo;
    const useCallback = React.useCallback;
    const useRef = React.useRef;

    /** Real DSH theme tokens; nothing here invents a colour. */
    const T = {
      labelPrimary: "var(--dsw-alias-label-primary)",
      labelSecondary: "var(--dsw-alias-label-secondary)",
      labelTertiary: "var(--dsw-alias-label-tertiary)",
      labelCaption: "var(--dsw-alias-label-caption)",
      labelInverted: "var(--dsw-alias-label-primary-inverted)",
      bgBase: "var(--dsw-alias-bg-base)",
      bg1: "var(--dsw-alias-bg-layer-1)",
      bg2: "var(--dsw-alias-bg-layer-2)",
      bg3: "var(--dsw-alias-bg-layer-3)",
      border1: "var(--dsw-alias-border-l1)",
      border2: "var(--dsw-alias-border-l2)",
      border3: "var(--dsw-alias-border-l3)",
      hover: "var(--dsw-alias-interactive-bg-hover)",
      info: "var(--dsw-alias-state-business-primary)",
      success: "var(--dsw-alias-state-success-primary)",
      warning: "var(--dsw-alias-state-warn-primary)",
      warnLabel: "var(--dsw-alias-state-warn-label)",
      danger: "var(--dsw-alias-state-error-primary)",
      brand: "var(--dsw-alias-brand-primary)",
      radiusXs: "var(--dsw-radius-xs)",
      radiusSm: "var(--dsw-radius-sm)",
      radiusMd: "var(--dsw-radius-md)",
      radiusLg: "var(--dsw-radius-lg)",
      font: "var(--dsw-font-family)",
      mono: "var(--dsw-font-mono)",
      focus: "var(--dsw-focus-ring-color)",
      contentFont: "var(--dsh-content-font-size, 14px)",
      fontSmall: "var(--dsw-font-xs-13, 13px)",
      fontCaption: "var(--dsw-font-xxs-12, 12px)",
    };

    const TONES = ["neutral", "info", "success", "warning", "danger"];

    /** tone -> { fg, bg, border }. bg is a token mixed towards transparent. */
    function tone(t) {
      const fg = t === "info" ? T.info
        : t === "success" ? T.success
        : t === "warning" ? T.warnLabel
        : t === "danger" ? T.danger
        : T.labelSecondary;
      return {
        fg,
        bg: t === "neutral" ? T.bg2 : "color-mix(in srgb, " + fg + " 12%, transparent)",
        border: t === "neutral" ? T.border2 : "color-mix(in srgb, " + fg + " 45%, transparent)",
      };
    }

    function font(size) {
      if (size === "small") return T.fontSmall;
      if (size === "large") return "calc(" + T.contentFont + " * 1.12)";
      if (size === "caption") return T.fontCaption;
      return T.contentFont;
    }

    function textTone(t) {
      if (t === "secondary") return T.labelSecondary;
      if (t === "tertiary") return T.labelTertiary;
      if (t === "caption") return T.labelCaption;
      return tone(t).fg;
    }

    function radius(r) {
      if (r === "sm") return T.radiusSm;
      if (r === "lg") return T.radiusLg;
      if (r === "xs") return T.radiusXs;
      return T.radiusMd;
    }

    // ---------------------------------------------------------------- layout

    function Stack(props) {
      return h("div", {
        style: Object.assign({
          display: "flex",
          flexDirection: "column",
          gap: (props.gap === undefined ? 12 : props.gap) + "px",
          alignItems: props.align === undefined ? "stretch" : props.align === "start" ? "flex-start" : props.align === "end" ? "flex-end" : props.align,
          minWidth: 0,
        }, props.style),
      }, props.children);
    }

    function Row(props) {
      return h("div", {
        style: Object.assign({
          display: "flex",
          flexDirection: "row",
          gap: (props.gap === undefined ? 8 : props.gap) + "px",
          flexWrap: props.wrap === true ? "wrap" : "nowrap",
          alignItems: props.align === undefined ? "center" : props.align === "start" ? "flex-start" : props.align === "end" ? "flex-end" : props.align,
          justifyContent: props.justify === undefined ? "flex-start" : props.justify === "center" ? "center" : props.justify === "end" ? "flex-end" : props.justify === "between" ? "space-between" : props.justify,
          minWidth: 0,
        }, props.style),
      }, props.children);
    }

    function Grid(props) {
      const columns = props.columns === undefined ? 2 : props.columns;
      return h("div", {
        style: Object.assign({
          display: "grid",
          gridTemplateColumns: typeof columns === "number" ? "repeat(" + columns + ", minmax(0, 1fr))" : columns,
          gap: (props.gap === undefined ? 16 : props.gap) + "px",
          alignItems: props.align === undefined ? "stretch" : props.align,
          minWidth: 0,
        }, props.style),
      }, props.children);
    }

    function Divider(props) {
      const vertical = props !== undefined && props.orientation === "vertical";
      if (vertical) {
        return h("div", { style: { width: "1px", background: T.border1, alignSelf: "stretch", minHeight: "16px" } });
      }
      return h("div", { style: { height: "1px", background: T.border1, width: "100%" } });
    }

    function CollapsibleSection(props) {
      const openState = useState(props.defaultOpen === true);
      const open = openState[0];
      const setOpen = openState[1];
      const header = h("button", {
        type: "button",
        onClick: function () { setOpen(!open); },
        style: {
          display: "flex", alignItems: "center", gap: "8px", width: "100%",
          background: "transparent", border: "none", padding: "6px 0", cursor: "pointer",
          color: T.labelPrimary, fontFamily: T.font, fontSize: T.contentFont, textAlign: "left",
        },
      },
        h("span", { style: { display: "inline-block", width: "12px", color: T.labelTertiary, transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" } }, "\u25B8"),
        h("span", { style: { fontWeight: 600 } }, props.title),
        props.count === undefined ? null : h("span", { style: { color: T.labelTertiary, fontSize: T.fontSmall } }, "(" + props.count + ")"),
        h("span", { style: { marginLeft: "auto" } }, props.trailing)
      );
      return h("div", { style: { display: "flex", flexDirection: "column" } }, header, open ? h("div", { style: { paddingTop: "6px" } }, props.children) : null);
    }

    // ------------------------------------------------------------- typography

    function H1(props) {
      return h("div", { style: Object.assign({ fontSize: "calc(" + T.contentFont + " * 1.6)", fontWeight: 600, color: T.labelPrimary, fontFamily: T.font, letterSpacing: "-0.01em" }, props.style) }, props.children);
    }

    function H2(props) {
      return h("div", { style: Object.assign({ fontSize: "calc(" + T.contentFont + " * 1.22)", fontWeight: 600, color: T.labelPrimary, fontFamily: T.font, marginTop: "4px" }, props.style) }, props.children);
    }

    function Text(props) {
      const weight = props.weight === "semibold" ? 600 : props.weight === "bold" ? 700 : 400;
      return h("div", {
        style: Object.assign({
          fontSize: font(props.size),
          fontWeight: weight,
          color: textTone(props.tone),
          fontFamily: T.font,
          lineHeight: 1.6,
          minWidth: 0,
          overflowWrap: "anywhere",
        }, props.style),
      }, props.children);
    }

    function Code(props) {
      return h("code", {
        style: {
          fontFamily: T.mono, fontSize: "0.94em",
          background: T.bg2, color: T.labelPrimary,
          border: "1px solid " + T.border1, borderRadius: T.radiusXs,
          padding: "1px 5px", whiteSpace: "nowrap",
        },
      }, props.children);
    }

    // ------------------------------------------------------------- containers

    function Card(props) {
      return h("div", {
        style: Object.assign({
          background: T.bg1, border: "1px solid " + T.border1,
          borderRadius: radius(props.radius), minWidth: 0, overflow: "hidden",
        }, props.style),
      }, props.children);
    }

    function CardHeader(props) {
      return h("div", {
        style: {
          display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px", borderBottom: "1px solid " + T.border1,
          background: T.bg2, color: T.labelPrimary, fontFamily: T.font,
          fontSize: T.contentFont, fontWeight: 600,
        },
      },
        h("span", { style: { minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis" } }, props.children),
        props.trailing === undefined ? null : h("span", { style: { flex: "0 0 auto" } }, props.trailing)
      );
    }

    function CardBody(props) {
      return h("div", { style: Object.assign({ padding: "14px", minWidth: 0 }, props.style) }, props.children);
    }

    function Callout(props) {
      const c = tone(props.tone === undefined ? "info" : props.tone);
      return h("div", {
        style: {
          border: "1px solid " + c.border, background: c.bg,
          borderRadius: T.radiusMd, padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: "4px", minWidth: 0,
        },
      },
        props.title === undefined ? null : h("div", { style: { color: c.fg, fontWeight: 600, fontFamily: T.font, fontSize: T.contentFont } }, props.title),
        h("div", { style: { color: T.labelSecondary, fontFamily: T.font, fontSize: font(props.size), lineHeight: 1.6, overflowWrap: "anywhere" } }, props.children)
      );
    }

    function Stat(props) {
      const c = tone(props.tone === undefined ? "neutral" : props.tone);
      return h("div", {
        style: {
          border: "1px solid " + T.border1, background: T.bg1,
          borderRadius: T.radiusMd, padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: "2px", minWidth: 0,
        },
      },
        h("div", { style: { fontSize: "calc(" + T.contentFont + " * 1.5)", fontWeight: 600, color: props.tone === undefined || props.tone === "neutral" ? T.labelPrimary : c.fg, fontFamily: T.font } }, String(props.value)),
        h("div", { style: { fontSize: T.fontSmall, color: T.labelSecondary, fontFamily: T.font, overflowWrap: "anywhere" } }, props.label),
        props.hint === undefined ? null : h("div", { style: { fontSize: T.fontCaption, color: T.labelTertiary, fontFamily: T.font } }, props.hint)
      );
    }

    // --------------------------------------------------------------- controls

    function Button(props) {
      const variant = props.variant === undefined ? "secondary" : props.variant;
      const size = props.size === "sm" ? "sm" : "md";
      const pendingState = useState(false);
      const pending = pendingState[0];
      const setPending = pendingState[1];
      const disabled = props.disabled === true || pending === true;
      const base = {
        fontFamily: T.font,
        fontSize: size === "sm" ? T.fontCaption : T.fontSmall,
        fontWeight: 500,
        borderRadius: T.radiusSm,
        padding: size === "sm" ? "3px 8px" : "5px 12px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        border: "1px solid " + T.border2,
        background: T.bg2,
        color: T.labelPrimary,
        transition: "background 120ms",
      };
      if (variant === "primary") {
        base.background = T.brand;
        base.color = T.labelInverted;
        base.border = "1px solid " + T.brand;
      } else if (variant === "ghost") {
        base.background = "transparent";
        base.border = "1px solid transparent";
        base.color = T.labelSecondary;
      }
      return h("button", {
        type: "button",
        disabled: disabled,
        onClick: function () {
          if (disabled) return;
          const out = props.onClick === undefined ? undefined : props.onClick();
          if (out !== null && typeof out === "object" && typeof out.then === "function") {
            setPending(true);
            out.then(function () { setPending(false); }, function () { setPending(false); });
          }
        },
        style: base,
      }, pending ? "..." : props.children);
    }

    function Pill(props) {
      const size = props.size === "sm" ? "sm" : "md";
      const c = props.tone === undefined ? null : tone(props.tone);
      const active = props.active === true;
      return h("button", {
        type: "button",
        onClick: props.onClick,
        style: {
          fontFamily: T.font,
          fontSize: size === "sm" ? T.fontCaption : T.fontSmall,
          padding: size === "sm" ? "2px 8px" : "4px 11px",
          borderRadius: "999px",
          border: "1px solid " + (active ? T.brand : c === null ? T.border2 : c.border),
          background: active ? T.brand : c === null ? T.bg2 : c.bg,
          color: active ? T.labelInverted : c === null ? T.labelSecondary : c.fg,
          cursor: props.onClick === undefined ? "default" : "pointer",
          whiteSpace: "nowrap",
        },
      }, props.children);
    }

    // ------------------------------------------------------------------ data

    function Table(props) {
      const headers = props.headers || [];
      const rows = props.rows || [];
      // Soft truncation at 300 keeps a canvas readable; the host cap is the
      // hard ceiling, so config.maxRenderRows is honoured rather than decorative.
      const hardCap = runtime.limits !== null && typeof runtime.limits.maxRenderRows === "number" ? runtime.limits.maxRenderRows : 5000;
      const requested = props.maxRows === undefined ? 300 : props.maxRows;
      const maxRows = Math.max(1, Math.min(requested, hardCap));
      const align = props.columnAlign || [];
      const rowTone = props.rowTone || [];
      const shown = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
      const cellStyle = function (i) {
        return {
          padding: "6px 10px",
          textAlign: align[i] === undefined ? "left" : align[i],
          borderBottom: "1px solid " + T.border1,
          fontFamily: T.font,
          fontSize: T.fontSmall,
          verticalAlign: "top",
          overflowWrap: "anywhere",
        };
      };
      const head = h("thead", null, h("tr", null, headers.map(function (label, i) {
        return h("th", {
          key: i,
          style: Object.assign(cellStyle(i), {
            position: props.stickyHeader === true ? "sticky" : "static",
            top: 0,
            zIndex: 1,
            background: T.bg2,
            color: T.labelSecondary,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }),
        }, label);
      })));
      const body = h("tbody", null, shown.length === 0
        ? h("tr", null, h("td", {
            colSpan: Math.max(1, headers.length),
            style: Object.assign(cellStyle(0), { color: T.labelTertiary, textAlign: "center", padding: "14px" }),
          }, props.emptyText === undefined ? "No rows" : props.emptyText))
        : shown.map(function (row, r) {
            const c = rowTone[r] === undefined ? null : tone(rowTone[r]);
            return h("tr", {
              key: r,
              onClick: props.onRowClick === undefined ? undefined : function () { props.onRowClick(r); },
              style: {
                background: props.striped === true && r % 2 === 1 ? T.bg2 : c === null ? "transparent" : c.bg,
                cursor: props.onRowClick === undefined ? "default" : "pointer",
              },
            }, row.map(function (cell, i) {
              return h("td", { key: i, style: cellStyle(i) }, cell);
            }));
          }));
      return h("div", { style: { overflow: "auto", maxHeight: props.maxHeight === undefined ? "none" : props.maxHeight, border: "1px solid " + T.border1, borderRadius: T.radiusMd } },
        h("table", { style: { borderCollapse: "collapse", width: "100%", color: T.labelPrimary } }, head, body),
        rows.length > maxRows ? h("div", { style: { padding: "6px 10px", color: T.labelTertiary, fontSize: T.fontCaption, fontFamily: T.font } }, "showing " + shown.length + " of " + rows.length + " rows \u2014 filter or split the canvas") : null
      );
    }

    function BarChart(props) {
      const categories = props.categories || [];
      const series = props.series || [];
      const height = props.height === undefined ? 240 : props.height;
      if (categories.length === 0 || series.length === 0) {
        return h("div", { style: { padding: "14px", color: T.labelTertiary, fontSize: T.fontSmall, fontFamily: T.font, border: "1px dashed " + T.border2, borderRadius: T.radiusMd } }, "No chart data");
      }
      const maxSize = 40;
      const shown = categories.length > maxSize ? categories.slice(0, maxSize) : categories;
      const shownSeries = series.map(function (s) { return Object.assign({}, s, { data: (s.data || []).slice(0, shown.length) }); });
      let max = 0;
      shownSeries.forEach(function (s) { s.data.forEach(function (v) { if (typeof v === "number" && isFinite(v) && v > max) max = v; }); });
      if (props.beginAtZero !== false) max = Math.max(max, 0);
      if (max <= 0) max = 1;
      const slotWidth = 56;
      const gap = 14;
      const axisHeight = 26;
      const labelHeight = 34;
      const plotHeight = height - axisHeight - labelHeight;
      const width = shown.length * slotWidth + gap * 2 + 40;
      const groupWidth = slotWidth - 10;
      const barWidth = Math.max(3, Math.floor(groupWidth / shownSeries.length) - 2);
      const yOf = function (v) { return labelHeight + plotHeight - (Math.max(0, v) / max) * plotHeight; };
      const gridLines = h("g", null, [0, 0.25, 0.5, 0.75, 1].map(function (frac, i) {
        const y = labelHeight + plotHeight * frac;
        const value = Math.round(max * (1 - frac));
        return h("g", { key: i },
          h("line", { x1: 34, x2: width - gap, y1: y, y2: y, stroke: T.border1, strokeWidth: 1 }),
          h("text", { x: 30, y: y + 4, textAnchor: "end", fontSize: 10, fill: T.labelTertiary, fontFamily: T.font }, String(value))
        );
      }));
      const bars = [];
      shown.forEach(function (name, ci) {
        shownSeries.forEach(function (s, si) {
          const v = typeof s.data[ci] === "number" && isFinite(s.data[ci]) ? s.data[ci] : 0;
          const x = gap + 34 + ci * slotWidth + si * (barWidth + 2);
          const y = yOf(v);
          const c = tone(s.tone === undefined ? "info" : s.tone);
          bars.push(h("rect", { key: name + ":" + si, x: x, y: y, width: barWidth, height: Math.max(0, labelHeight + plotHeight - y), fill: c.fg, rx: 2 }));
        });
        bars.push(h("text", {
          key: "label:" + ci,
          x: gap + 34 + ci * slotWidth + groupWidth / 2,
          y: height - labelHeight + 18,
          textAnchor: "middle", fontSize: 10, fill: T.labelSecondary, fontFamily: T.font,
        }, name.length > 10 ? name.slice(0, 9) + "\u2026" : name));
      });
      const legend = h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", paddingTop: "6px" } }, shownSeries.map(function (s, i) {
        const c = tone(s.tone === undefined ? "info" : s.tone);
        return h("span", { key: i, style: { display: "inline-flex", alignItems: "center", gap: "5px", fontSize: T.fontCaption, color: T.labelSecondary, fontFamily: T.font } },
          h("span", { style: { width: "9px", height: "9px", borderRadius: "2px", background: c.fg, display: "inline-block" } }),
          s.name
        );
      }));
      return h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
        h("div", { style: { overflowX: "auto" } },
          h("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "img" }, gridLines, bars)
        ),
        legend,
        categories.length > maxSize ? h("div", { style: { color: T.labelTertiary, fontSize: T.fontCaption, fontFamily: T.font } }, "showing " + shown.length + " of " + categories.length + " categories") : null
      );
    }

    function TodoList(props) {
      const todos = props.todos || [];
      const dense = props.dense === true;
      if (todos.length === 0) return h("div", { style: { color: T.labelTertiary, fontSize: T.fontSmall, fontFamily: T.font } }, "Nothing here");
      return h("div", { style: { display: "flex", flexDirection: "column" } }, todos.map(function (todo, i) {
        const t = todo.status;
        const c = t === "completed" ? tone("success") : t === "in_progress" ? tone("warning") : t === "cancelled" ? tone("danger") : tone("neutral");
        const glyph = t === "completed" ? "\u2713" : t === "in_progress" ? "\u25CF" : t === "cancelled" ? "\u2715" : "\u25CB";
        return h("div", {
          key: todo.id === undefined ? i : todo.id,
          onClick: props.onTodoClick === undefined ? undefined : function () { props.onTodoClick(todo); },
          style: {
            display: "flex", alignItems: "flex-start", gap: "8px",
            padding: dense ? "3px 6px" : "6px 8px",
            borderRadius: T.radiusSm,
            cursor: props.onTodoClick === undefined ? "default" : "pointer",
            background: "transparent",
          },
          onMouseEnter: function (e) { if (props.onTodoClick !== undefined) e.currentTarget.style.background = T.hover; },
          onMouseLeave: function (e) { e.currentTarget.style.background = "transparent"; },
        },
          h("span", { style: { color: c.fg, flex: "0 0 auto", lineHeight: 1.5, fontSize: T.fontSmall } }, glyph),
          h("span", {
            style: {
              color: t === "completed" ? T.labelTertiary : T.labelPrimary,
              textDecoration: t === "cancelled" ? "line-through" : "none",
              fontFamily: T.font, fontSize: T.fontSmall, lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere",
            },
          }, todo.content)
        );
      }));
    }

    // ----------------------------------------------------------------- hooks

    /**
     * Runtime capabilities the canvas hooks need. The tab body fills this in
     * before mounting a canvas; hooks read it, canvas code never touches it.
     */
    const runtime = { ctx: null, tabActions: null, canvasPath: null, sessionId: null, root: null, notify: null, limits: null };
    const CanvasContext = React.createContext(null);

    function useCanvasContext() {
      return React.useContext(CanvasContext);
    }

    function safeStorage() {
      try {
        const probe = window.localStorage;
        if (probe === undefined || probe === null) return null;
        return probe;
      } catch (e) {
        return null;
      }
    }

    function storageKey(key) {
      const id = runtime.canvasPath === null ? "global" : runtime.canvasPath;
      return "dsh.canvas." + id + "." + key;
    }

    /**
     * Local, UI-only state (filters, selection). The agent cannot see it:
     * use useCanvasOverlay when the agent must observe the value.
     */
    function useCanvasState(key, initial) {
      const pair = useState(function () {
        const store = safeStorage();
        if (store === null) return initial;
        try {
          const raw = store.getItem(storageKey(key));
          if (raw === null) return initial;
          return JSON.parse(raw);
        } catch (e) {
          return initial;
        }
      });
      const value = pair[0];
      const setValue = pair[1];
      const set = useCallback(function (next) {
        setValue(function (prev) {
          const resolved = typeof next === "function" ? next(prev) : next;
          const store = safeStorage();
          if (store !== null) {
            try {
              if (resolved === initial) store.removeItem(storageKey(key));
              else store.setItem(storageKey(key), JSON.stringify(resolved));
            } catch (e) { /* quota or blocked storage: keep the in-memory value */ }
          }
          return resolved;
        });
      }, [key]);
      return [value, set];
    }

    /** Carry the calling Session so the host can resolve its workspace root. */
    function sessionQuery() {
      const parts = [];
      if (runtime.sessionId !== null && runtime.sessionId !== undefined && runtime.sessionId !== "") parts.push("session=" + encodeURIComponent(String(runtime.sessionId)));
      if (runtime.root !== null && runtime.root !== undefined && runtime.root !== "") parts.push("root=" + encodeURIComponent(String(runtime.root)));
      return parts.length === 0 ? "" : "&" + parts.join("&");
    }

    async function postAction(action) {
      const res = await fetch("/canvas/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ canvas: runtime.canvasPath, sessionId: runtime.sessionId, root: runtime.root }, action)),
      });
      return await res.json();
    }

    /**
     * Human edits that stay visible to the agent: they land in the canvas
     * sidecar, so canvas_read reports them on the next turn.
     */
    function useCanvasOverlay(key, initial) {
      const rows = initial || [];
      const versionState = useState(0);
      const version = versionState[0];
      const bump = versionState[1];
      const patchesState = useState({});
      const patches = patchesState[0];
      const setPatches = patchesState[1];
      const pendingState = useState(false);
      const pending = pendingState[0];
      const setPending = pendingState[1];

      useEffect(function () {
        let alive = true;
        if (runtime.canvasPath === null) return undefined;
        fetch("/canvas/overlay?canvas=" + encodeURIComponent(runtime.canvasPath) + sessionQuery())
          .then(function (r) { return r.json(); })
          .then(function (doc) {
            if (!alive) return;
            const bucket = doc && doc.overlays ? doc.overlays[key] : null;
            setPatches(bucket && typeof bucket === "object" ? bucket : {});
          })
          .catch(function () { /* a missing sidecar is not an error */ });
        return function () { alive = false; };
      }, [key, version]);

      const items = useMemo(function () {
        return rows.map(function (row) {
          if (row === null || typeof row !== "object" || typeof row.id !== "string") return row;
          const patch = patches[row.id];
          if (patch === undefined) return row;
          const merged = Object.assign({}, row);
          Object.keys(patch).forEach(function (k) { if (k !== "at" && k !== "by") merged[k] = patch[k]; });
          merged.__overlay = { at: patch.at, by: patch.by };
          return merged;
        });
      }, [rows, patches]);

      const set = useCallback(function (id, patch) {
        setPending(true);
        setPatches(function (prev) {
          const optimistic = Object.assign({}, prev);
          optimistic[id] = Object.assign({}, optimistic[id], patch, { at: new Date().toISOString(), by: "user" });
          return optimistic;
        });
        return postAction({ type: "overlaySet", key: key, id: id, patch: patch })
          .then(function () { bump(function (v) { return v + 1; }); setPending(false); },
                function () { bump(function (v) { return v + 1; }); setPending(false); });
      }, [key]);

      const clear = useCallback(function (id) {
        setPending(true);
        setPatches(function (prev) {
          const next = Object.assign({}, prev);
          if (id === undefined) return {};
          delete next[id];
          return next;
        });
        return postAction({ type: "overlayClear", key: key, id: id })
          .then(function () { bump(function (v) { return v + 1; }); setPending(false); },
                function () { bump(function (v) { return v + 1; }); setPending(false); });
      }, [key]);

      return {
        items: items,
        get: function (id) { return items.filter(function (r) { return r && r.id === id; })[0]; },
        set: set,
        clear: clear,
        pending: pending,
      };
    }

    /** Component-encode one id or path segment, keeping ":" literal for drive letters. */
    function encodeSegment(segment) {
      return encodeURIComponent(String(segment)).replace(/%3A/gi, ":");
    }

    /** dsh-resource://file/session/<sid>/<path>, mirroring the workspace-path helper. */
    function sessionFileAddress(sessionId, path) {
      const normalized = String(path).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
      return "dsh-resource://file/session/" + encodeSegment(sessionId) + "/" + normalized.split("/").map(encodeSegment).join("/");
    }

    /**
     * The Session behind this canvas: the tab's own when the tab is a file, else the
     * mounted seat's. A wrong session id opens nothing, silently, so return null rather
     * than guess.
     */
    function currentSessionId() {
      if (runtime.sessionId !== null && runtime.sessionId !== undefined && runtime.sessionId !== "") return runtime.sessionId;
      try {
        const snapshot = runtime.ctx === null ? null : runtime.ctx.sidebarRight.mounted;
        if (snapshot !== null && snapshot !== undefined) {
          if (typeof snapshot === "string") return snapshot;
          if (typeof snapshot.get === "function") {
            const value = snapshot.get();
            if (typeof value === "string" && value !== "") return value;
          }
        }
      } catch (error) { /* no seat mounted, or the service is absent here */ }
      return null;
    }

    /**
     * Open a resource address. The tab's own bound actions win because they already name
     * their Session; the navigation controller is the fallback and must be declared in
     * inject, because reading an uninjected service throws instead of returning undefined.
     */
    function openAddress(address, params) {
      const options = params === undefined ? undefined : { params: params };
      const reasons = [];
      try {
        if (runtime.tabActions !== null && typeof runtime.tabActions.openResource === "function") {
          runtime.tabActions.openResource(address, options);
          return { ok: true };
        }
        reasons.push("tab actions: openResource is absent");
      } catch (error) {
        reasons.push("tab actions threw: " + String(error && error.message ? error.message : error));
      }
      try {
        const controller = runtime.ctx === null ? null : runtime.ctx.sidebarRight;
        if (controller !== null && controller !== undefined && typeof controller.openResource === "function") {
          controller.openResource(address, options);
          return { ok: true };
        }
        reasons.push("controller: openResource is absent");
      } catch (error) {
        reasons.push("controller threw: " + String(error && error.message ? error.message : error));
      }
      return { ok: false, code: "failed", message: reasons.join(" | ") };
    }

    /** Dispatch a canvas action. Client-side actions never reach the host. */
    /**
     * A failed action must be visible. A swallowed failure is indistinguishable
     * from a broken button, which is exactly how this was debugged the hard way.
     */
    function reportFailure(result, action) {
      if (result !== null && typeof result === "object" && result.ok === false) {
        const message = String(result.message === undefined ? result.code : result.message);
        try { console.warn("[dsh-canvas] action failed", action === null ? null : action.type, result); } catch (error) { /* ignore */ }
        runtime.notify({ tone: "danger", message: String(action === null ? "action" : action.type) + ": " + message });
      }
      return result;
    }

    function useCanvasAction() {
      return useCallback(function (action) {
        return runAction(action).then(
          function (result) { return reportFailure(result, action); },
          function (error) {
            return reportFailure({ ok: false, code: "failed", message: String(error && error.message ? error.message : error) }, action);
          }
        );
      }, []);
    }

    function runAction(action) {
        if (action === null || typeof action !== "object") {
          return Promise.resolve({ ok: false, code: "unsupported", message: "action must be an object" });
        }
        if (action.type === "openFile") {
          const sessionId = currentSessionId();
          if (sessionId === null) {
            return Promise.resolve({ ok: false, code: "unsupported", message: "no Session is available to open " + String(action.path) });
          }
          return Promise.resolve(openAddress(sessionFileAddress(sessionId, action.path), action.line === undefined ? undefined : { line: action.line }));
        }
        if (action.type === "openResource") {
          return Promise.resolve(openAddress(action.address, action.params));
        }
        if (action.type === "copy") {
          try {
            if (navigator.clipboard !== undefined) navigator.clipboard.writeText(String(action.text));
            return Promise.resolve({ ok: true });
          } catch (e) {
            return Promise.resolve({ ok: false, code: "failed", message: "clipboard unavailable" });
          }
        }
        if (action.type === "notify") {
          if (runtime.notify !== null) runtime.notify(action);
          return Promise.resolve({ ok: true });
        }
        if (action.type === "startTurn" || action.type === "overlaySet" || action.type === "overlayClear" || action.type === "runCommand") {
          return postAction(action).then(function (r) { return r; }, function (e) {
            return { ok: false, code: "failed", message: String(e && e.message ? e.message : e) };
          });
        }
        return Promise.resolve({ ok: false, code: "unsupported", message: "unknown action type " + String(action.type) });
    }

    const themeState = {};

    /** Token values for inline SVG and artwork. Components use CSS vars directly. */
    function useHostTheme() {
      const dark = useMemo(function () {
        try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
      }, []);
      if (themeState.value === undefined) {
        themeState.value = {
          dark: dark,
          token: T,
          tone: tone,
          text: { primary: T.labelPrimary, secondary: T.labelSecondary, tertiary: T.labelTertiary },
        };
      }
      themeState.value.dark = dark;
      return themeState.value;
    }

    /** Read a workspace file through the host. */
    function useCanvasResource(path) {
      const state = useState({ status: "loading" });
      useEffect(function () {
        let alive = true;
        if (path === undefined || path === null) { state[1]({ status: "none" }); return undefined; }
        fetch("/canvas/source?path=" + encodeURIComponent(path) + sessionQuery())
          .then(function (r) { return r.json(); })
          .then(function (body) { if (alive) state[1](body.ok ? { status: "ready", text: body.text } : { status: "error", error: body.message }); })
          .catch(function (e) { if (alive) state[1]({ status: "error", error: String(e && e.message ? e.message : e) }); });
        return function () { alive = false; };
      }, [path]);
      return state[0];
    }

    const kit = {
      Stack: Stack, Row: Row, Grid: Grid, Divider: Divider, CollapsibleSection: CollapsibleSection,
      H1: H1, H2: H2, Text: Text, Code: Code,
      Card: Card, CardHeader: CardHeader, CardBody: CardBody, Callout: Callout,
      Stat: Stat, Table: Table, BarChart: BarChart, TodoList: TodoList,
      Button: Button, Pill: Pill,
      useState: useState, useEffect: useEffect, useMemo: useMemo, useCallback: useCallback, useRef: useRef,
      useCanvasState: useCanvasState, useCanvasOverlay: useCanvasOverlay,
      useCanvasAction: useCanvasAction, useHostTheme: useHostTheme, useCanvasResource: useCanvasResource,
    };

    // The compiled canvas module reads the kit, React and the JSX factory from
    // this global, which must be set before its dynamic import runs.
    globalThis.__DSH_CANVAS__ = Object.assign({ version: "1" }, kit, {
      h: h, Fragment: React.Fragment, React: React, CanvasContext: CanvasContext, runtime: runtime,
    });

    // ---------------------------------------------------------------- notifier

    const notifier = { listeners: [] };
    runtime.notify = function (action) {
      notifier.listeners.slice().forEach(function (fn) { fn(action); });
    };

    function useNotices() {
      const pair = useState([]);
      const items = pair[0];
      const setItems = pair[1];
      useEffect(function () {
        const fn = function (action) {
          const id = Math.random().toString(36).slice(2);
          setItems(function (prev) { return prev.concat([{ id: id, action: action }]); });
          setTimeout(function () { setItems(function (prev) { return prev.filter(function (x) { return x.id !== id; }); }); }, 4000);
        };
        notifier.listeners.push(fn);
        return function () { notifier.listeners = notifier.listeners.filter(function (x) { return x !== fn; }); };
      }, []);
      return items;
    }

    // ------------------------------------------------------------ addressing

    function basename(address) {
      const s = String(address === undefined || address === null ? "" : address);
      const tail = s.slice(s.lastIndexOf("/") + 1);
      let decoded = tail;
      try { decoded = decodeURIComponent(tail); } catch (e) { /* keep raw */ }
      return decoded.replace(/\.canvas\.tsx$/, "") || "Canvas";
    }

    /** dsh-resource://file/session/<sid>/<path> -> { sessionId, path } */
    function pathFromAddress(address) {
      const m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(String(address === undefined ? "" : address));
      if (m === null) return null;
      let p = m[2];
      try { p = decodeURIComponent(p); } catch (e) { /* keep raw */ }
      return { sessionId: m[1], path: p };
    }

    /** The live resource value may be text, bytes, or a wrapper; accept them all. */
    function pickText(meta) {
      if (meta === undefined || meta === null) return null;
      if (typeof meta === "string") return meta;
      const direct = [meta.text, meta.value, meta.content, meta.contents, meta.body, meta.source];
      for (const candidate of direct) {
        if (typeof candidate === "string") return candidate;
      }
      if (typeof meta.bytes === "object" && meta.bytes !== null && typeof meta.bytes.length === "number") {
        try { return new TextDecoder("utf-8").decode(meta.bytes); } catch (e) { return null; }
      }
      if (typeof meta.value === "object" && meta.value !== null) return pickText(meta.value);
      return null;
    }

    // -------------------------------------------------------------- compiling

    /**
     * Compile the source on the host, then import the content-addressed module.
     * The module URL changes whenever the source does, so the browser cache is
     * never stale and an unchanged save reuses the previous module.
     */
    function useCanvasView(canvasPath, sessionId, source) {
      const pair = useState({ status: "waiting" });
      const state = pair[0];
      const setState = pair[1];
      useEffect(function () {
        if (source === undefined || source === null || canvasPath === null) {
          setState({ status: "waiting" });
          return undefined;
        }
        let alive = true;
        runtime.canvasPath = canvasPath;
        runtime.sessionId = sessionId;
        setState({ status: "compiling" });
        fetch("/canvas/compile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: canvasPath, source: source, sessionId: sessionId, root: runtime.root }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (!alive) return undefined;
            const diagnostics = res.diagnostics || [];
            if (!res.ok) {
              setState({ status: "error", diagnostics: diagnostics, sha: res.sha });
              return undefined;
            }
            return import(res.url)
              .then(function (mod) {
                if (!alive) return;
                setState({ status: "ready", Component: mod.default, diagnostics: diagnostics, sha: res.sha, url: res.url });
              })
              .catch(function (err) {
                if (!alive) return;
                setState({
                  status: "error", sha: res.sha,
                  diagnostics: diagnostics.concat([{ code: "E_PARSE", severity: "error", message: "module import failed: " + String(err && err.message ? err.message : err) }]),
                });
              });
          })
          .catch(function (err) {
            if (!alive) return;
            setState({
              status: "error",
              diagnostics: [{ code: "E_PARSE", severity: "error", message: "compile request failed: " + String(err && err.message ? err.message : err) }],
            });
          });
        return function () { alive = false; };
      }, [canvasPath, source]);
      return state;
    }

    // ----------------------------------------------------------- error cards

    function DiagnosticsCard(props) {
      const dispatch = useCanvasAction();
      const diagnostics = props.diagnostics || [];
      const errors = diagnostics.filter(function (d) { return d.severity === "error"; });
      const title = errors.length > 0 ? errors.length + " error(s) in this canvas" : "Canvas warnings";
      const lines = diagnostics.map(function (d, i) {
        const where = d.line === undefined ? "" : " :" + d.line + (d.col === undefined ? "" : ":" + d.col);
        return h("div", { key: i, style: { display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid " + T.border1 } },
          h("div", { style: { fontFamily: T.mono, fontSize: T.fontCaption, color: d.severity === "error" ? T.danger : T.warnLabel } }, d.code + where),
          h("div", { style: { fontFamily: T.font, fontSize: T.fontSmall, color: T.labelPrimary, overflowWrap: "anywhere" } }, d.message),
          d.hint === undefined ? null : h("div", { style: { fontFamily: T.font, fontSize: T.fontCaption, color: T.labelTertiary, overflowWrap: "anywhere" } }, d.hint)
        );
      });
      const askPrompt = "修一下 " + String(props.path) + " 这个画布：\n" + diagnostics.map(function (d) {
        return (d.severity === "error" ? "[error] " : "[warn] ") + d.code + (d.line === undefined ? "" : " line " + d.line) + ": " + d.message + (d.hint === undefined ? "" : " (" + d.hint + ")");
      }).join("\n") + "\n只改这个文件；改完用 canvas_check 自检。";
      return h(Callout, { tone: errors.length > 0 ? "danger" : "warning", title: title },
        h(Stack, { gap: 8 },
          h("div", null, lines),
          h(Row, { gap: 8, wrap: true },
            h(Button, { variant: "primary", size: "sm", onClick: function () { return dispatch({ type: "startTurn", prompt: askPrompt }); } }, "Ask the agent to fix"),
            h(Button, { size: "sm", variant: "ghost", onClick: function () { return dispatch({ type: "openFile", path: props.path }); } }, "Open the file")
          )
        )
      );
    }

    class CanvasErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      componentDidCatch(error, info) {
        try { console.error("[dsh-canvas] canvas crashed while rendering", error, info); } catch (e) { /* ignore */ }
      }
      render() {
        if (this.state.error !== null) {
          return h(RuntimeCrashCard, { error: this.state.error, path: this.props.canvasPath });
        }
        return this.props.children;
      }
    }

    function RuntimeCrashCard(props) {
      const dispatch = useCanvasAction();
      const message = String(props.error && props.error.message ? props.error.message : props.error);
      const stack = String(props.error && props.error.stack ? props.error.stack : "").split("\n").slice(0, 6).join("\n");
      return h(Callout, { tone: "danger", title: "This canvas threw while rendering" },
        h(Stack, { gap: 8 },
          h(Text, { size: "small" }, message),
          stack === "" ? null : h("pre", { style: { margin: 0, fontFamily: T.mono, fontSize: T.fontCaption, color: T.labelTertiary, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, stack),
          h(Row, { gap: 8, wrap: true },
            h(Button, { variant: "primary", size: "sm", onClick: function () { return dispatch({ type: "startTurn", prompt: "修一下 " + String(props.path) + " 这个画布的运行时错误：\n" + message + "\n" + stack }); } }, "Ask the agent to fix"),
            h(Button, { size: "sm", variant: "ghost", onClick: function () { return dispatch({ type: "openFile", path: props.path }); } }, "Open the file")
          )
        )
      );
    }

    function Skeleton() {
      const bar = function (width, height, key) {
        return h("div", { key: key, style: { width: width, height: height + "px", background: T.bg2, borderRadius: T.radiusSm } });
      };
      return h(Stack, { gap: 12 },
        bar("40%", 22, "a"),
        h(Row, { gap: 12 }, bar("30%", 56, "b"), bar("30%", 56, "c"), bar("30%", 56, "d")),
        bar("100%", 14, "e"),
        bar("100%", 140, "f")
      );
    }

    // ------------------------------------------------------- directory page

    function CanvasDirectory(props) {
      const dispatch = useCanvasAction();
      const pair = useState({ status: "loading" });
      const state = pair[0];
      const setState = pair[1];
      useEffect(function () {
        let alive = true;
        fetch("/canvas/list" + (runtime.sessionId === null || runtime.sessionId === undefined ? "" : "?session=" + encodeURIComponent(String(runtime.sessionId))))
          .then(function (r) { return r.json(); })
          .then(function (body) { if (alive) setState({ status: "ready", canvases: body.canvases || [] }); })
          .catch(function (e) { if (alive) setState({ status: "error", message: String(e && e.message ? e.message : e) }); });
        return function () { alive = false; };
      }, []);
      const canvases = state.canvases || [];
      return h(Stack, { gap: 16 },
        h(H1, null, "Canvases"),
        h(Text, { tone: "secondary" },
          "A canvas is a ",
          h(Code, null, "*.canvas.tsx"),
          " file the agent writes: the host compiles it and renders it here, and its buttons can hand work back to the agent."
        ),
        state.status === "error" ? h(Callout, { tone: "danger", title: "Could not list canvases" }, state.message) : null,
        state.status === "loading" ? h(Skeleton, null) : null,
        canvases.length === 0 && state.status === "ready"
          ? h(Callout, { tone: "info", title: "No canvas in this workspace yet" },
              h(Stack, { gap: 8 },
                h(Text, { size: "small" }, "Ask the agent to create one, or write a file yourself."),
                h(Button, { variant: "primary", size: "sm", onClick: function () { return dispatch({ type: "startTurn", prompt: "用 canvas_new 在本工作区建一个看板画布（kind: board），然后告诉我文件路径。" }); } }, "Ask the agent to create a canvas")
              )
            )
          : null,
        canvases.map(function (c, i) {
          return h(Card, { key: i },
            h(CardHeader, { trailing: h(Text, { size: "caption", tone: "tertiary" }, c.lines + " lines") }, c.title || basename(c.path)),
            h(CardBody, null,
              h(Stack, { gap: 8 },
                c.description === undefined ? null : h(Text, { size: "small", tone: "secondary" }, c.description),
                h(Text, { size: "caption" }, h(Code, null, c.path)),
                h(Row, { gap: 8 },
                  h(Button, { size: "sm", variant: "primary", onClick: function () { return dispatch({ type: "openFile", path: c.path }); } }, "Open canvas"),
                  h(Button, { size: "sm", variant: "ghost", onClick: function () { return dispatch({ type: "copy", text: c.path }); } }, "Copy path")
                )
              )
            )
          );
        })
      );
    }

    // ---------------------------------------------------------------- tab body

    function CanvasBody(props) {
      const api = props || {};
      const info = typeof api.useTabInfo === "function" ? api.useTabInfo() : null;
      const tab = info !== null && info.tab !== undefined ? info.tab : null;
      // sessionId and useSessions belong to the slot contract for this body (the shipped
      // file tree reads them the same way). Without the Session no file address can be
      // built, which is exactly how "Open canvas" died silently.
      const propSessionId = typeof api.sessionId === "string" && api.sessionId !== "" ? api.sessionId : null;
      if (propSessionId !== null) runtime.sessionId = propSessionId;
      const propCwd = api.useSessions(function (sessions) {
        if (sessions === null || sessions === undefined || sessions.byId === undefined || propSessionId === null) return undefined;
        const record = sessions.byId[propSessionId];
        return record === undefined ? undefined : record.cwd;
      });
      if (typeof propCwd === "string" && propCwd !== "") runtime.root = propCwd;
      runtime.tabActions = tab === null || tab.actions === undefined ? null : tab.actions;
      // The tab record may carry its Session; prefer it over the mounted-seat snapshot.
      if (tab !== null && typeof tab.sessionId === "string" && tab.sessionId !== "") runtime.sessionId = tab.sessionId;
      const address = tab === null ? null : tab.contentId;
      const parsed = address === null ? null : pathFromAddress(address);
      const meta = typeof api.useResource === "function" && address !== null ? api.useResource(address) : null;
      const notices = useNotices();

      useEffect(function () {
        let alive = true;
        fetch("/canvas/api")
          .then(function (r) { return r.json(); })
          .then(function (body) { if (alive && body !== null && body.limits !== undefined) runtime.limits = body.limits; })
          .catch(function () { /* built-in defaults apply */ });
        return function () { alive = false; };
      }, []);

      const fromResource = pickText(meta);
      const fallbackState = useState(null);
      const fallback = fallbackState[0];
      const setFallback = fallbackState[1];
      useEffect(function () {
        let alive = true;
        if (parsed === null || fromResource !== null) { setFallback(null); return undefined; }
        fetch("/canvas/source?address=" + encodeURIComponent(String(address)) + sessionQuery())
          .then(function (r) { return r.json(); })
          .then(function (body) { if (alive && body.ok) setFallback(body.text); })
          .catch(function () { /* reported by the view state below */ });
        return function () { alive = false; };
      }, [address, fromResource]);

      const source = fromResource !== null ? fromResource : fallback;
      const view = useCanvasView(parsed === null ? null : parsed.path, parsed === null ? null : parsed.sessionId, source);

      const noticeBar = notices.length === 0 ? null : h(Stack, { gap: 6 }, notices.map(function (n) {
        return h(Callout, { key: n.id, tone: n.action.tone === undefined ? "info" : n.action.tone }, n.action.message);
      }));

      if (parsed === null) {
        // One diagnostic line, because "nothing happened" must never be the answer.
        const diag = "diag: address=" + String(address) + "  session=" + String(currentSessionId()) + "  root=" + String(runtime.root) + "  tabActions=" + (runtime.tabActions === null ? "absent" : "present") + "  controller=" + (function () {
          try { return runtime.ctx === null || runtime.ctx.sidebarRight === undefined ? "absent" : "present"; } catch (error) { return "throws: " + String(error && error.message ? error.message : error); }
        })();
        return h(Stack, { gap: 12 }, noticeBar, h(CanvasDirectory, null), h(Text, { size: "caption", tone: "tertiary" }, diag));
      }

      const warnings = view.status === "ready" && view.diagnostics.length > 0
        ? h(DiagnosticsCard, { diagnostics: view.diagnostics, path: parsed.path })
        : null;

      let body;
      if (view.status === "waiting" || view.status === "compiling") body = h(Skeleton, null);
      else if (view.status === "error") body = h(DiagnosticsCard, { diagnostics: view.diagnostics, path: parsed.path });
      else if (view.status === "ready") {
        body = h(CanvasErrorBoundary, { key: view.sha, canvasPath: parsed.path },
          h(CanvasContext.Provider, { value: { canvasPath: parsed.path, sessionId: parsed.sessionId } },
            h(view.Component, null)
          )
        );
      } else body = h(Skeleton, null);

      return h(Stack, { gap: 12 },
        noticeBar,
        warnings,
        body,
        h(Row, { gap: 8, style: { paddingTop: "4px" } },
          h(Text, { size: "caption", tone: "tertiary" }, h(Code, null, parsed.path))
        )
      );
    }

    //==APPLY==

    return {
      name: "@local/dsh-canvas",
      inject: ["slots", "sidebarRightTabs", "sidebarRight"],
      apply(ctx) {
        runtime.ctx = ctx;
        const TYPE_ID = "@local/dsh-canvas/canvas";
        ctx.effect(function () {
          return ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: "canvas",
            patterns: ["*.canvas.tsx"],
            priority: "extension",
            title: function (address) { return basename(address); },
            guide: [{
              id: "canvas.directory",
              // The guide calls these: entry.title() and entry.description?.().
              // Strings here crash the whole guide body (verified).
              title: function () { return "Canvases"; },
              description: function () { return "Every *.canvas.tsx in this workspace, and how to make one"; },
            }],
            keepMounted: true,
          });
        }, "canvas: tab type");
        ctx.effect(function () {
          return ctx.slots.register({ name: "sidebar.right.pane.tab", key: TYPE_ID }, CanvasBody);
        }, "canvas: tab body");
      },
    };
  },
});
