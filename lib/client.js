/**
 * Canvas client half: the dsh/canvas kit, its hooks, and the sidebar tab that
 * compiles and mounts agent-authored *.canvas.tsx files.
 *
 * Loaded by the DSH web client module loader. Zero dependencies beyond React
 * from the platform module table: no DSH client package is imported, so the kit
 * survives those packages changing.
 */
window.__ModuleLoader__.load({
  id: "@demxyuanli/dsh-canvas",
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
      // --dsw-font-mono does not exist in the theme, and a bare var() is an invalid
      // font-family - so Code silently rendered in the UI font. The real token is
      // --ds-font-family-code (the one markdown code uses).
      mono: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
      focus: "var(--dsw-focus-ring-color)",
      // Typography is the harness scale, referenced through the LONGHAND tokens.
      // The shorthand tokens (--dsw-font-xs-13 = "13px/20px family") are invalid as
      // font-size, which is why small/caption used to fall back to the base size.
      // A canvas lives in the right sidebar, whose base is the SECONDARY content
      // size (13px, same as the file tree), not the chat's 14px.
      contentFont: "var(--dsh-content-font-size-secondary, 13px)",
      lineBase: "var(--dsw-font-xs-13-line-height, 20px)",
      fontSmall: "var(--dsw-font-xxs-12-font-size, 12px)",
      lineSmall: "var(--dsw-font-xxs-12-line-height, 18px)",
      fontCaption: "var(--dsw-font-xxxs-11-font-size, 11px)",
      lineCaption: "var(--dsw-font-xxxs-11-line-height, 14px)",
      fontLarge: "var(--dsw-font-s-14-font-size, 14px)",
      lineLarge: "var(--dsw-font-s-14-line-height, 22px)",
      fontH1: "var(--dsw-font-l-20-font-size, 20px)",
      lineH1: "var(--dsw-font-l-20-line-height, 28px)",
      fontH2: "var(--dsw-font-base-strong-16-font-size, 16px)",
      lineH2: "var(--dsw-font-base-strong-16-line-height, 24px)",
      fontCode: "var(--dsw-font-markdown-code-font-size, 12px)",
      lineCode: "var(--dsw-font-markdown-code-line-height, 19px)",
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

    /** Font size for one Text size step: always a harness token, never a multiplier. */
    function font(size) {
      if (size === "small") return T.fontSmall;
      if (size === "large") return T.fontLarge;
      if (size === "caption") return T.fontCaption;
      return T.contentFont;
    }

    /** The line height that belongs to that size; a size without it is half a token. */
    function lineOf(size) {
      if (size === "small") return T.lineSmall;
      if (size === "large") return T.lineLarge;
      if (size === "caption") return T.lineCaption;
      return T.lineBase;
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
          color: T.labelPrimary, fontFamily: T.font, fontSize: T.contentFont, lineHeight: T.lineBase, textAlign: "left",
        },
      },
        h("span", { style: { display: "inline-block", width: "12px", color: T.labelTertiary, transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" } }, "\u25B8"),
        h("span", { style: { fontWeight: 500 } }, props.title),
        props.count === undefined ? null : h("span", { style: { color: T.labelTertiary, fontSize: T.fontSmall, lineHeight: T.lineSmall } }, "(" + props.count + ")"),
        h("span", { style: { marginLeft: "auto" } }, props.trailing)
      );
      return h("div", { style: { display: "flex", flexDirection: "column" } }, header, open ? h("div", { style: { paddingTop: "6px" } }, props.children) : null);
    }

    // ------------------------------------------------------------- typography

    function H1(props) {
      return h("div", { style: Object.assign({ fontSize: T.fontH1, lineHeight: T.lineH1, fontWeight: 500, color: T.labelPrimary, fontFamily: T.font, letterSpacing: "-0.01em" }, props.style) }, props.children);
    }

    function H2(props) {
      return h("div", { style: Object.assign({ fontSize: T.fontH2, lineHeight: T.lineH2, fontWeight: 500, color: T.labelPrimary, fontFamily: T.font, marginTop: "4px" }, props.style) }, props.children);
    }

    function Text(props) {
      const weight = props.weight === "semibold" ? 600 : props.weight === "bold" ? 700 : 400;
      return h("div", {
        style: Object.assign({
          fontSize: font(props.size),
          lineHeight: lineOf(props.size),
          fontWeight: weight,
          color: textTone(props.tone),
          fontFamily: T.font,
          minWidth: 0,
          overflowWrap: "anywhere",
        }, props.style),
      }, props.children);
    }

    function Code(props) {
      return h("code", {
        style: {
          fontFamily: T.mono, fontSize: T.fontCode, lineHeight: T.lineCode,
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
          fontSize: T.contentFont, lineHeight: T.lineBase, fontWeight: 500,
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
        props.title === undefined ? null : h("div", { style: { color: c.fg, fontWeight: 500, fontFamily: T.font, fontSize: T.contentFont, lineHeight: T.lineBase } }, props.title),
        h("div", { style: { color: T.labelSecondary, fontFamily: T.font, fontSize: font(props.size), lineHeight: lineOf(props.size), overflowWrap: "anywhere" } }, props.children)
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
        h("div", { style: { fontSize: T.fontH1, lineHeight: T.lineH1, fontWeight: 600, color: props.tone === undefined || props.tone === "neutral" ? T.labelPrimary : c.fg, fontFamily: T.font } }, String(props.value)),
        h("div", { style: { fontSize: T.fontSmall, lineHeight: T.lineSmall, color: T.labelSecondary, fontFamily: T.font, overflowWrap: "anywhere" } }, props.label),
        props.hint === undefined ? null : h("div", { style: { fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelTertiary, fontFamily: T.font } }, props.hint)
      );
    }

    /**
     * Horizontal progress bar. value/100 by default; max overrides the scale.
     * Sits above Table/TodoList in a tracking board so "how far along" is a
     * shape rather than a number the reader has to compare.
     */
    function Progress(props) {
      const max = typeof props.max === "number" && props.max > 0 ? props.max : 100;
      const raw = typeof props.value === "number" && isFinite(props.value) ? props.value : 0;
      const pct = Math.max(0, Math.min(100, (raw / max) * 100));
      const c = tone(props.tone === undefined ? "info" : props.tone);
      const height = props.size === "sm" ? 6 : 10;
      const header = (props.label === undefined && props.showValue !== true) ? null : h("div", {
        style: { display: "flex", alignItems: "baseline", gap: "8px", fontFamily: T.font, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelSecondary, minWidth: 0 },
      },
        h("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, props.label),
        props.showValue === true ? h("span", { style: { marginLeft: "auto", color: c.fg, fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, Math.round(pct) + "%") : null
      );
      return h("div", { style: Object.assign({ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }, props.style) },
        header,
        h("div", { style: { height: height + "px", background: T.bg3, borderRadius: "999px", overflow: "hidden", minWidth: 0 } },
          h("div", { style: { width: pct + "%", height: "100%", background: c.fg, borderRadius: "999px", transition: "width 160ms" } })
        )
      );
    }

    /**
     * Aligned label/value rows for a detail pane. Keeps the labels in one column
     * so a long field list reads as a table, not as a pile of sentences.
     */
    function KeyValue(props) {
      const items = props.items || [];
      const dense = props.dense === true;
      const columns = props.columns === undefined ? 1 : props.columns;
      return h("div", {
        style: { display: "grid", gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))", gap: dense ? "6px 18px" : "9px 18px", minWidth: 0 },
      }, items.map(function (item, i) {
        return h("div", {
          key: i,
          style: { display: "grid", gridTemplateColumns: "minmax(56px, 88px) minmax(0, 1fr)", gap: "10px", alignItems: "baseline", minWidth: 0 },
        },
          h("span", { style: { fontFamily: T.font, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelTertiary, letterSpacing: "0.02em" } }, item.label),
          h("span", {
            style: {
              fontFamily: T.font, fontSize: T.contentFont, lineHeight: T.lineBase, minWidth: 0, overflowWrap: "anywhere",
              color: item.tone === undefined ? T.labelPrimary : tone(item.tone).fg,
            },
          }, item.value)
        );
      }));
    }

    /**
     * Vertical activity rail: what happened, when, and the evidence for it.
     * A tracking board needs this because status alone says nothing about drift.
     */
    function Timeline(props) {
      const events = props.events || [];
      const dense = props.dense === true;
      if (events.length === 0) return h("div", { style: { color: T.labelTertiary, fontSize: T.fontSmall, lineHeight: T.lineSmall, fontFamily: T.font } }, "No activity");
      return h("div", { style: { display: "flex", flexDirection: "column", minWidth: 0 } }, events.map(function (event, i) {
        const c = tone(event.tone === undefined ? "neutral" : event.tone);
        const last = i === events.length - 1;
        return h("div", {
          key: event.id === undefined ? i : event.id,
          style: { display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: "10px", minWidth: 0 },
        },
          h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "5px" } },
            h("span", { style: { width: "8px", height: "8px", borderRadius: "999px", background: c.fg, flex: "0 0 auto", boxShadow: "0 0 0 3px " + c.bg } }),
            last ? null : h("span", { style: { flex: "1 1 auto", width: "1px", background: T.border1, marginTop: "2px" } })
          ),
          h("div", { style: { paddingBottom: last ? "0" : (dense ? "8px" : "14px"), display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 } },
            h("div", { style: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap", minWidth: 0 } },
              h("span", { style: { fontFamily: T.mono, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelTertiary } }, event.at),
              h("span", { style: { fontFamily: T.font, fontSize: T.contentFont, lineHeight: T.lineBase, fontWeight: 500, color: T.labelPrimary } }, event.title),
              event.ref === undefined ? null : h(Code, null, event.ref)
            ),
            event.detail === undefined ? null : h("div", { style: { fontFamily: T.font, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelSecondary, overflowWrap: "anywhere" } }, event.detail)
          )
        );
      }));
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
        fontSize: size === "sm" ? T.fontSmall : T.contentFont,
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
          fontSize: size === "sm" ? T.fontSmall : T.contentFont,
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
          fontSize: T.contentFont,
          lineHeight: T.lineBase,
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
            fontWeight: 500,
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
        rows.length > maxRows ? h("div", { style: { padding: "6px 10px", color: T.labelTertiary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font } }, "showing " + shown.length + " of " + rows.length + " rows \u2014 filter or split the canvas") : null
      );
    }

    function BarChart(props) {
      const categories = props.categories || [];
      const series = props.series || [];
      const height = props.height === undefined ? 240 : props.height;
      if (categories.length === 0 || series.length === 0) {
        return h("div", { style: { padding: "14px", color: T.labelTertiary, fontSize: T.fontSmall, lineHeight: T.lineSmall, fontFamily: T.font, border: "1px dashed " + T.border2, borderRadius: T.radiusMd } }, "No chart data");
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
          h("text", { x: 30, y: y + 4, textAnchor: "end", fontSize: 11, fill: T.labelTertiary, fontFamily: T.font }, String(value))
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
          textAnchor: "middle", fontSize: 11, fill: T.labelSecondary, fontFamily: T.font,
        }, name.length > 10 ? name.slice(0, 9) + "\u2026" : name));
      });
      const legend = h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", paddingTop: "6px" } }, shownSeries.map(function (s, i) {
        const c = tone(s.tone === undefined ? "info" : s.tone);
        return h("span", { key: i, style: { display: "inline-flex", alignItems: "center", gap: "5px", fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelSecondary, fontFamily: T.font } },
          h("span", { style: { width: "9px", height: "9px", borderRadius: "2px", background: c.fg, display: "inline-block" } }),
          s.name
        );
      }));
      return h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
        h("div", { style: { overflowX: "auto" } },
          h("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "img" }, gridLines, bars)
        ),
        legend,
        categories.length > maxSize ? h("div", { style: { color: T.labelTertiary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font } }, "showing " + shown.length + " of " + categories.length + " categories") : null
      );
    }

    /**
     * Heat matrix / heat grid.
     *
     * Cell depth encodes a COUNT (how many times a task was iterated), so the
     * component answers "which cells kept moving" rather than "how many" - that
     * is Stat / BarChart's job. One hue, varying alpha: per-row tones would
     * double-encode the same fact.
     *
     * layout "matrix" keeps the time dimension (one column per round);
     * layout "grid" folds each row into a single cell and lets the cells pack, so
     * the number of tasks reads off the area instead.
     */
    function HeatMatrix(props) {
      const columns = props.columns || [];
      const rows = props.rows || [];
      const declared = props.layout === "grid" ? "grid" : "matrix";
      // switchable: the READER picks the view. The choice lives in useCanvasState,
      // so it sticks per canvas and stays invisible to the agent - a view is UI
      // state, not a fact about the data. The hook is called unconditionally
      // because React forbids conditional hooks.
      const layoutState = useCanvasState("heat-layout", declared);
      const chosen = layoutState[0];
      const layout = props.switchable === true && (chosen === "grid" || chosen === "matrix") ? chosen : declared;
      const unit = typeof props.unit === "string" && props.unit !== "" ? props.unit : "次";
      const maxColumns = typeof props.maxColumns === "number" && props.maxColumns > 0 ? props.maxColumns : 16;
      const maxRows = typeof props.maxRows === "number" && props.maxRows > 0 ? props.maxRows : 24;
      const capStyle = { color: T.labelTertiary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font };
      const toggle = props.switchable !== true ? null : h("div", { style: { display: "flex", alignItems: "center", gap: "6px", paddingBottom: "6px", flexWrap: "wrap" } },
        h(Pill, { size: "sm", active: layout === "matrix", onClick: function () { layoutState[1]("matrix"); } }, "矩阵"),
        h(Pill, { size: "sm", active: layout === "grid", onClick: function () { layoutState[1]("grid"); } }, "格子"),
        h("span", { style: capStyle }, "视图只存本机，agent 看不到")
      );
      if (rows.length === 0) {
        return h("div", { style: { padding: "14px", color: T.labelTertiary, fontSize: T.fontSmall, lineHeight: T.lineSmall, fontFamily: T.font, border: "1px dashed " + T.border2, borderRadius: T.radiusMd } }, "No matrix data");
      }
      const valuesOf = function (row) { return Array.isArray(row.values) ? row.values : []; };
      const totalOf = function (row) {
        return valuesOf(row).reduce(function (sum, v) { return sum + (typeof v === "number" && isFinite(v) && v > 0 ? v : 0); }, 0);
      };
      const shownColumns = columns.length > maxColumns ? columns.slice(0, maxColumns) : columns;
      const shownRows = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
      let peak = 0;
      let peakAt = null;
      shownRows.forEach(function (row) {
        valuesOf(row).forEach(function (v, i) {
          if (typeof v === "number" && isFinite(v) && v > peak) { peak = v; peakAt = { id: row.id, column: columns[i] }; }
        });
      });
      if (peak <= 0) peak = 1;
      const completed = shownRows.filter(function (row) { return row.status === "completed"; }).length;
      const total = shownRows.reduce(function (sum, row) { return sum + totalOf(row); }, 0);
      const hue = tone("info").fg;
      const mixAt = function (value, top) {
        const level = typeof value === "number" && isFinite(value) && top > 0 ? Math.max(0, Math.min(1, value / top)) : 0;
        if (level <= 0) return T.bg2;
        return "color-mix(in srgb, " + hue + " " + String(Math.round(10 + level * 75)) + "%, transparent)";
      };
      const mix = function (value) { return mixAt(value, peak); };
      const statusDot = function (row) {
        if (typeof row.status !== "string" || row.status === "") return null;
        const c = row.status === "completed" ? tone("success") : row.status === "in_progress" ? tone("warning") : row.status === "blocked" ? tone("danger") : tone("neutral");
        const label = row.status === "completed" ? "完成" : row.status === "in_progress" ? "进行中" : row.status === "blocked" ? "阻塞" : row.status === "cancelled" ? "取消" : "待办";
        return h("span", { style: { display: "inline-flex", alignItems: "center", gap: "4px", color: T.labelTertiary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font, whiteSpace: "nowrap" } },
          h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: c.fg, display: "inline-block" } }),
          label
        );
      };
      const legend = h("div", { style: { display: "flex", alignItems: "center", gap: "6px", paddingTop: "6px", color: T.labelSecondary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font } },
        "0",
        [0.25, 0.5, 0.75, 1].map(function (frac, i) {
          return h("span", { key: i, title: String(Math.max(1, Math.round(peak * frac))) + " " + unit, style: { width: "14px", height: "12px", borderRadius: "2px", background: mix(peak * frac), border: "1px solid " + T.border1, display: "inline-block" } });
        }),
        String(peak) + " " + unit,
        h("span", { style: { color: T.labelTertiary, paddingLeft: "6px" } }, "颜色越深 = " + unit + "数越多")
      );
      const summaryText = shownRows.length + " 个任务 · 完成 " + String(completed) + " · 总" + unit + " " + String(total) + (peakAt === null ? "" : " · 最深一格 " + String(peak) + " " + unit + "（" + String(peakAt.id) + " · " + String(peakAt.column) + "）");
      const summary = props.showSummary === false ? null
        : h("div", { style: { paddingTop: "4px", color: T.labelSecondary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font } }, summaryText);
      const caps = [];
      if (columns.length > shownColumns.length && layout === "matrix") caps.push("列只显示前 " + String(shownColumns.length) + " / " + String(columns.length));
      if (rows.length > shownRows.length) caps.push("行只显示前 " + String(shownRows.length) + " / " + String(rows.length));
      const capHint = caps.length === 0 ? null : h("div", { style: capStyle }, caps.join(" · ") + " —— 先筛选再画");

      if (layout === "grid") {
        // One cell per row, so the cells pack into a block whose AREA is the task
        // count. Colour still means iterations (normalised against the busiest
        // row); the bottom edge carries status, which a single cell would
        // otherwise have nowhere to show.
        const gridPeak = Math.max(1, shownRows.reduce(function (best, row) { return Math.max(best, totalOf(row)); }, 0));
        const cell = function (row, i) {
          const totalRow = totalOf(row);
          const border = row.status === "completed" ? tone("success").fg
            : row.status === "in_progress" ? tone("warning").fg
            : row.status === "blocked" ? tone("danger").fg
            : row.status === "cancelled" ? T.labelTertiary
            : tone("neutral").fg;
          return h("span", {
            key: row.id === undefined ? i : row.id,
            title: String(row.id === undefined ? "" : row.id) + (row.label === undefined ? "" : " · " + String(row.label)) + " · " + String(totalRow) + " " + unit + (row.status === undefined ? "" : " · " + String(row.status)),
            style: {
              width: "18px", height: "18px", borderRadius: "3px",
              background: mixAt(totalRow, gridPeak), border: "1px solid " + T.border1,
              borderBottom: "3px solid " + border, boxSizing: "border-box", display: "inline-block",
            },
          });
        };
        return h("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          toggle,
          h("div", { style: capStyle }, "每格一个任务：深浅 = 累计" + unit + "，下沿 = 状态（悬停看 id）"),
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: "3px", paddingTop: "4px" } }, shownRows.map(cell)),
          legend,
          summary,
          capHint
        );
      }

      const cellSize = 18;
      const headStyle = { color: T.labelTertiary, fontSize: T.fontCaption, lineHeight: T.lineCaption, fontFamily: T.font, fontWeight: 400, textAlign: "center" };
      const head = h("tr", null,
        h("th", { style: Object.assign({}, headStyle, { textAlign: "left", minWidth: "86px" }) }, "任务"),
        shownColumns.map(function (name, i) { return h("th", { key: i, style: Object.assign({}, headStyle, { padding: "0 2px" }) }, name); }),
        h("th", { style: Object.assign({}, headStyle, { paddingLeft: "8px" }) }, "合计")
      );
      const body = shownRows.map(function (row, ri) {
        const values = valuesOf(row);
        return h("tr", { key: row.id === undefined ? ri : row.id },
          h("td", { style: { padding: "2px 8px 2px 0", whiteSpace: "nowrap" } },
            h("span", { style: { color: T.labelPrimary, fontSize: T.fontSmall, lineHeight: T.lineSmall, fontFamily: T.font, display: "inline-flex", alignItems: "center", gap: "6px" } },
              h("span", { style: { fontFamily: T.fontCode, fontSize: T.fontCode, color: T.labelSecondary } }, String(row.id === undefined ? "" : row.id)),
              statusDot(row)
            )
          ),
          shownColumns.map(function (name, ci) {
            const v = typeof values[ci] === "number" && isFinite(values[ci]) ? values[ci] : 0;
            return h("td", { key: ci, style: { padding: "2px" } },
              h("span", {
                title: String(row.id === undefined ? "" : row.id) + " · " + String(name) + " · " + String(v) + " " + unit,
                style: { width: String(cellSize) + "px", height: String(cellSize) + "px", borderRadius: "3px", background: mix(v), border: "1px solid " + T.border1, display: "inline-block" },
              })
            );
          }),
          h("td", { style: { paddingLeft: "8px", textAlign: "right", color: T.labelPrimary, fontSize: T.fontSmall, lineHeight: T.lineSmall, fontFamily: T.font } }, String(totalOf(row)))
        );
      });
      return h("div", { style: { display: "flex", flexDirection: "column", gap: "2px" } },
        toggle,
        h("div", { style: { overflowX: "auto" } },
          h("table", { style: { borderCollapse: "collapse" } },
            h("thead", null, head),
            h("tbody", null, body)
          )
        ),
        legend,
        summary,
        capHint
      );
    }

    function TodoList(props) {
      const todos = props.todos || [];
      const dense = props.dense === true;
      if (todos.length === 0) return h("div", { style: { color: T.labelTertiary, fontSize: T.fontSmall, lineHeight: T.lineSmall, fontFamily: T.font } }, "Nothing here");
      return h("div", { style: { display: "flex", flexDirection: "column" } }, todos.map(function (todo, i) {
        const t = todo.status;
        const c = t === "completed" ? tone("success") : t === "in_progress" ? tone("warning") : t === "blocked" ? tone("danger") : t === "cancelled" ? tone("danger") : tone("neutral");
        const glyph = t === "completed" ? "\u2713" : t === "in_progress" ? "\u25CF" : t === "blocked" ? "!" : t === "cancelled" ? "\u2715" : "\u25CB";
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
          h("span", { style: { color: c.fg, flex: "0 0 auto", lineHeight: T.lineSmall, fontSize: T.fontSmall } }, glyph),
          h("span", {
            style: {
              color: t === "completed" ? T.labelTertiary : T.labelPrimary,
              textDecoration: t === "cancelled" ? "line-through" : "none",
              fontFamily: T.font, fontSize: T.contentFont, lineHeight: T.lineBase, minWidth: 0, overflowWrap: "anywhere",
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

    /**
     * POST one action to the host.
     *
     * The body shape is the frozen contract (INTERFACE section 3):
     * `{ canvas, sessionId?, root?, action }`. This used to spread the action
     * flat into the body, which the host cannot read - so every button came back
     * as "unsupported action undefined" while the client-side tests stayed green.
     */
    async function postAction(action) {
      const res = await fetch("/canvas/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canvas: runtime.canvasPath, sessionId: runtime.sessionId, root: runtime.root, action: action }),
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
     * An action's outcome must be visible. A swallowed failure is
     * indistinguishable from a broken button - and so is a silent success:
     * "Start in chat" with no acknowledgement reads as "nothing happened".
     */
    function reportOutcome(result, action) {
      const type = action === null || action === undefined ? "action" : String(action.type);
      if (result !== null && typeof result === "object" && result.ok === false) {
        const message = String(result.message === undefined ? result.code : result.message);
        try { console.warn("[dsh-canvas] action failed", type, result); } catch (error) { /* ignore */ }
        runtime.notify({ tone: "danger", message: type + ": " + message });
      } else if (result !== null && typeof result === "object" && result.ok === true && type === "startTurn") {
        runtime.notify({ tone: "info", message: "已交给 agent（" + String(result.detail === undefined ? "queued" : result.detail) + "）；切到会话即可看到这一轮" });
      }
      return result;
    }

    function useCanvasAction() {
      return useCallback(function (action) {
        return runAction(action).then(
          function (result) { return reportOutcome(result, action); },
          function (error) {
            return reportOutcome({ ok: false, code: "failed", message: String(error && error.message ? error.message : error) }, action);
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
      Stat: Stat, Table: Table, BarChart: BarChart, HeatMatrix: HeatMatrix, TodoList: TodoList,
      Progress: Progress, KeyValue: KeyValue, Timeline: Timeline,
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
          h("div", { style: { fontFamily: T.mono, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: d.severity === "error" ? T.danger : T.warnLabel } }, d.code + where),
          h("div", { style: { fontFamily: T.font, fontSize: T.fontSmall, lineHeight: T.lineSmall, color: T.labelPrimary, overflowWrap: "anywhere" } }, d.message),
          d.hint === undefined ? null : h("div", { style: { fontFamily: T.font, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelTertiary, overflowWrap: "anywhere" } }, d.hint)
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
          stack === "" ? null : h("pre", { style: { margin: 0, fontFamily: T.mono, fontSize: T.fontCaption, lineHeight: T.lineCaption, color: T.labelTertiary, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, stack),
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

    /**
     * The tab seat is a column flex box with a definite height and
     * `overflow: hidden` (SidebarRight's tabBody). Without a scroll container of
     * our own a tall canvas is simply clipped - no scrollbar, no way to reach
     * the rest. Every CanvasBody return goes through this frame.
     */
    const FRAME_STYLE = {
      height: "100%",
      minHeight: 0,
      flex: "auto",
      minWidth: 0,
      overflowY: "auto",
      overflowX: "hidden",
      scrollbarGutter: "stable",
      // Breathing room: the seat itself has no padding, so without this the canvas
      // is flush against the pane on all four sides.
      padding: "12px 16px 24px",
      boxSizing: "border-box",
    };

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
        return h(Stack, { gap: 12, style: FRAME_STYLE }, noticeBar, h(CanvasDirectory, null), h(Text, { size: "caption", tone: "tertiary" }, diag));
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

      return h(Stack, { gap: 12, style: FRAME_STYLE },
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
      name: "@demxyuanli/dsh-canvas",
      inject: ["slots", "sidebarRightTabs", "sidebarRight"],
      apply(ctx) {
        runtime.ctx = ctx;
        const TYPE_ID = "@demxyuanli/dsh-canvas/canvas";
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
