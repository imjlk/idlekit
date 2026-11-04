import type {
  ChartDataV1,
  ChartPoint,
  ChartSeries,
  CompareChartData,
  ProgressionChartData,
  SensitivityChartData,
} from "./chart";

/**
 * Dependency-free SVG rendering of chart data.
 * Output is a pure function of the input: fixed decimals, no ids from a counter shared across calls,
 * no clock, and no locale formatting, so golden snapshots stay byte-stable.
 */

const WIDTH = 960;
const MARGIN = { left: 76, right: 28 } as const;
const FONT = "font-family=\"ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif\"";
const COLORS = {
  money: "#2563eb",
  netWorth: "#16a34a",
  growthRate: "#9333ea",
  milestone: "#d97706",
  grid: "#e5e7eb",
  axis: "#6b7280",
  text: "#111827",
  muted: "#6b7280",
  a: "#2563eb",
  b: "#dc2626",
  better: "#16a34a",
  worse: "#ea580c",
  neutral: "#9ca3af",
} as const;
const MAX_LABELED_MILESTONES = 12;

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Fixed decimals without a trailing `.00` or a negative zero. */
function num(value: number, digits = 2): string {
  const fixed = Number(value.toFixed(digits));
  return Object.is(fixed, -0) ? "0" : String(fixed);
}

function sig(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-3) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = value / 10 ** exponent;
    return `${num(mantissa, digits - 1)}e${exponent}`;
  }
  return String(Number(value.toPrecision(digits)));
}

/** Seconds as a short duration label. */
export function formatDurationLabel(sec: number): string {
  const abs = Math.abs(sec);
  if (abs < 120) return `${num(sec, 1)}s`;
  if (abs < 7200) return `${num(sec / 60, 1)}m`;
  if (abs < 86400) return `${num(sec / 3600, 1)}h`;
  return `${num(sec / 86400, 1)}d`;
}

/** Amount label from a log10 coordinate. */
function amountLabel(log10: number): string {
  if (Math.abs(log10) < 6) return sig(10 ** log10, 3);
  const exponent = Math.floor(log10);
  const mantissa = 10 ** (log10 - exponent);
  return `${num(mantissa, 2)}e${exponent}`;
}

function niceStep(range: number, targetTicks: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const raw = range / Math.max(1, targetTicks);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function ticks(min: number, max: number, target: number, integer = false): number[] {
  let step = niceStep(max - min, target);
  if (integer) step = Math.max(1, Math.round(step));
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = first, guard = 0; value <= max + step * 1e-9 && guard < 64; value += step, guard += 1) {
    out.push(Number(value.toPrecision(12)));
  }
  return out;
}

const TIME_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800,
] as const;

/** Time axis ticks on whole seconds, minutes, hours, or days. */
function timeTicks(min: number, max: number, target: number): number[] {
  const raw = (max - min) / Math.max(1, target);
  const step = TIME_STEPS.find((candidate) => candidate >= raw) ?? Math.ceil(raw / 604800) * 604800;
  return stepTicks(min, max, step);
}

function stepTicks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first, guard = 0; value <= max + step * 1e-9 && guard < 64; value += step, guard += 1) out.push(value);
  return out;
}

type Extent = Readonly<{ min: number; max: number }>;

function extent(values: readonly number[], pad = 0.05): Extent {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 0.5, max: max + 0.5 };
  const span = max - min;
  return { min: min - span * pad, max: max + span * pad };
}

type Panel = Readonly<{ x0: number; x1: number; y0: number; y1: number; tx: Extent; ty: Extent }>;

function px(panel: Panel, t: number): number {
  return panel.x0 + ((t - panel.tx.min) / (panel.tx.max - panel.tx.min || 1)) * (panel.x1 - panel.x0);
}

function py(panel: Panel, y: number): number {
  return panel.y1 - ((y - panel.ty.min) / (panel.ty.max - panel.ty.min || 1)) * (panel.y1 - panel.y0);
}

function linePath(panel: Panel, points: readonly ChartPoint[]): string {
  const parts: string[] = [];
  let pen = false;
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      pen = false;
      continue;
    }
    parts.push(`${pen ? "L" : "M"}${num(px(panel, point.t))} ${num(py(panel, point.y))}`);
    pen = true;
  }
  return parts.join(" ");
}

function frame(panel: Panel, args: Readonly<{ yLabel: (value: number) => string; yTicks: number[]; xTicks: number[]; title: string }>): string[] {
  const out: string[] = [];
  out.push(`<rect x="${num(panel.x0)}" y="${num(panel.y0)}" width="${num(panel.x1 - panel.x0)}" height="${num(panel.y1 - panel.y0)}" fill="#ffffff" stroke="${COLORS.grid}"/>`);
  for (const value of args.yTicks) {
    const y = py(panel, value);
    out.push(`<line x1="${num(panel.x0)}" y1="${num(y)}" x2="${num(panel.x1)}" y2="${num(y)}" stroke="${COLORS.grid}"/>`);
    out.push(`<text x="${num(panel.x0 - 6)}" y="${num(y + 4)}" text-anchor="end" font-size="11" fill="${COLORS.muted}">${escapeXml(args.yLabel(value))}</text>`);
  }
  for (const value of args.xTicks) {
    const x = px(panel, value);
    out.push(`<line x1="${num(x)}" y1="${num(panel.y0)}" x2="${num(x)}" y2="${num(panel.y1)}" stroke="${COLORS.grid}"/>`);
    out.push(`<text x="${num(x)}" y="${num(panel.y1 + 16)}" text-anchor="middle" font-size="11" fill="${COLORS.muted}">${escapeXml(formatDurationLabel(value))}</text>`);
  }
  out.push(`<text x="${num(panel.x0)}" y="${num(panel.y0 - 8)}" font-size="12" font-weight="600" fill="${COLORS.text}">${escapeXml(args.title)}</text>`);
  return out;
}

/** The 1st-99th percentile band of sorted values, when the full range is more than three times wider. */
function robustBand(sorted: readonly number[]): Readonly<{ lo: number; hi: number }> | undefined {
  if (sorted.length < 20) return undefined;
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;
  const lo = at(0.01);
  const hi = at(0.99);
  const full = sorted[sorted.length - 1]! - sorted[0]!;
  return hi > lo && full > 3 * (hi - lo) ? { lo, hi } : undefined;
}

function seriesById(data: ProgressionChartData, id: string): ChartSeries | undefined {
  return data.series.find((series) => series.id === id);
}

function timeExtent(points: readonly ChartPoint[][]): Extent {
  let min = Infinity;
  let max = -Infinity;
  for (const list of points) {
    for (const point of list) {
      if (point.t < min) min = point.t;
      if (point.t > max) max = point.t;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return min === max ? { min, max: min + 1 } : { min, max };
}

function finiteYs(series: readonly (ChartSeries | undefined)[]): number[] {
  const out: number[] = [];
  for (const entry of series) {
    for (const point of entry?.points ?? []) if (point.y !== null && Number.isFinite(point.y)) out.push(point.y);
  }
  return out;
}

function legendWidth(items: readonly Readonly<{ label: string }>[]): number {
  return items.reduce((sum, item) => sum + 34 + item.label.length * 6.2, 0);
}

function legend(x: number, y: number, items: readonly Readonly<{ label: string; color: string; dash?: boolean }>[]): string[] {
  const out: string[] = [];
  let cursor = x;
  for (const item of items) {
    out.push(`<line x1="${num(cursor)}" y1="${num(y)}" x2="${num(cursor + 18)}" y2="${num(y)}" stroke="${item.color}" stroke-width="2.5"${item.dash ? " stroke-dasharray=\"4 3\"" : ""}/>`);
    out.push(`<text x="${num(cursor + 24)}" y="${num(y + 4)}" font-size="11" fill="${COLORS.text}">${escapeXml(item.label)}</text>`);
    cursor += 34 + item.label.length * 6.2;
  }
  return out;
}

function svgDocument(height: number, title: string, body: readonly string[], description: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${num(height, 0)}" viewBox="0 0 ${WIDTH} ${num(height, 0)}" role="img" aria-labelledby="chart-title chart-desc" ${FONT}>`,
    `<title id="chart-title">${escapeXml(title)}</title>`,
    `<desc id="chart-desc">${escapeXml(description)}</desc>`,
    `<rect width="100%" height="100%" fill="#f9fafb"/>`,
    `<text x="${MARGIN.left}" y="26" font-size="16" font-weight="700" fill="${COLORS.text}">${escapeXml(title)}</text>`,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

function progressionBody(data: ProgressionChartData, top: number, opts: Readonly<{ milestones: boolean }>): { body: string[]; bottom: number } {
  const body: string[] = [];
  const money = seriesById(data, "money");
  const netWorth = seriesById(data, "netWorth");
  const growth = seriesById(data, "growthRate");
  const tx = timeExtent([money?.points ?? [], netWorth?.points ?? []].map((list) => [...list]));
  const amountPanel: Panel = {
    x0: MARGIN.left,
    x1: WIDTH - MARGIN.right,
    y0: top + 22,
    y1: top + 262,
    tx,
    ty: extent(finiteYs([money, netWorth])),
  };
  const xTicks = timeTicks(tx.min, tx.max, 8);
  body.push(...frame(amountPanel, {
    title: `Progression (log10 ${money?.unit ?? ""})`.trim(),
    yLabel: amountLabel,
    yTicks: ticks(amountPanel.ty.min, amountPanel.ty.max, 6),
    xTicks,
  }));
  if (money) body.push(`<path d="${linePath(amountPanel, money.points)}" fill="none" stroke="${COLORS.money}" stroke-width="2"/>`);
  if (netWorth) body.push(`<path d="${linePath(amountPanel, netWorth.points)}" fill="none" stroke="${COLORS.netWorth}" stroke-width="2" stroke-dasharray="6 3"/>`);

  // A start-up spike can flatten the rest of the rate curve. When the full range is far wider than the
  // 1st-99th percentile band, the axis uses the band and the curve is clipped to the panel.
  const rates = finiteYs([growth]).sort((a, b) => a - b);
  const band = robustBand(rates);
  const growthPanel: Panel = {
    x0: MARGIN.left,
    x1: WIDTH - MARGIN.right,
    y0: amountPanel.y1 + 48,
    y1: amountPanel.y1 + 188,
    tx,
    ty: extent([0, ...(band ? [band.lo, band.hi] : rates)]),
  };
  body.push(`<clipPath id="growth-clip"><rect x="${num(growthPanel.x0)}" y="${num(growthPanel.y0)}" width="${num(growthPanel.x1 - growthPanel.x0)}" height="${num(growthPanel.y1 - growthPanel.y0)}"/></clipPath>`);
  body.push(...frame(growthPanel, {
    title: `${growth?.label ?? "Growth rate"} (log10 / sec)${band ? ", axis clipped to p1-p99" : ""}`,
    yLabel: (value) => sig(value, 3),
    yTicks: ticks(growthPanel.ty.min, growthPanel.ty.max, 4),
    xTicks,
  }));
  const zero = py(growthPanel, 0);
  body.push(`<line x1="${num(growthPanel.x0)}" y1="${num(zero)}" x2="${num(growthPanel.x1)}" y2="${num(zero)}" stroke="${COLORS.axis}" stroke-width="1"/>`);
  if (growth) body.push(`<path d="${linePath(growthPanel, growth.points)}" fill="none" stroke="${COLORS.growthRate}" stroke-width="1.5" clip-path="url(#growth-clip)"/>`);

  let bottom = growthPanel.y1 + 34;
  if (opts.milestones && data.milestones.length > 0) {
    const labeled = data.milestones.slice(0, MAX_LABELED_MILESTONES);
    // Badges that would overlap stack downward, so every labeled marker stays readable.
    const placed: { x: number; row: number }[] = [];
    data.milestones.forEach((milestone, index) => {
      if (milestone.t < tx.min || milestone.t > tx.max) return;
      const x = px(amountPanel, milestone.t);
      body.push(`<line x1="${num(x)}" y1="${num(amountPanel.y0)}" x2="${num(x)}" y2="${num(growthPanel.y1)}" stroke="${COLORS.milestone}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`);
      if (index < MAX_LABELED_MILESTONES) {
        let row = 0;
        while (placed.some((entry) => entry.row === row && Math.abs(entry.x - x) < 17)) row += 1;
        placed.push({ x, row });
        const cy = amountPanel.y0 + 10 + row * 18;
        body.push(`<circle cx="${num(x)}" cy="${num(cy)}" r="8" fill="${COLORS.milestone}"/>`);
        body.push(`<text x="${num(x)}" y="${num(cy + 3.5)}" text-anchor="middle" font-size="10" font-weight="700" fill="#ffffff">${index + 1}</text>`);
      }
    });
    body.push(`<text x="${MARGIN.left}" y="${num(bottom)}" font-size="12" font-weight="600" fill="${COLORS.text}">Milestones</text>`);
    bottom += 16;
    const columns = 3;
    const colWidth = (WIDTH - MARGIN.left - MARGIN.right) / columns;
    labeled.forEach((milestone, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const label = `${index + 1}. ${milestone.key} @ ${formatDurationLabel(milestone.t)}`;
      const clipped = label.length > 46 ? `${label.slice(0, 45)}…` : label;
      body.push(`<text x="${num(MARGIN.left + col * colWidth)}" y="${num(bottom + row * 15)}" font-size="11" fill="${COLORS.text}">${escapeXml(clipped)}</text>`);
    });
    bottom += Math.ceil(labeled.length / columns) * 15;
    const hidden = data.milestones.length - labeled.length + data.droppedMilestones;
    if (hidden > 0) {
      body.push(`<text x="${MARGIN.left}" y="${num(bottom)}" font-size="11" fill="${COLORS.muted}">+${hidden} more milestone(s) not labeled; see the chart data JSON.</text>`);
      bottom += 15;
    }
  }
  return { body, bottom };
}

export function renderProgressionSvg(data: ChartDataV1): string {
  const progression = data.progression;
  if (!progression) throw new Error("renderProgressionSvg requires progression data");
  const legendItems = [
    { label: "Money", color: COLORS.money },
    ...(seriesById(progression, "netWorth") ? [{ label: "Net worth", color: COLORS.netWorth, dash: true }] : []),
    { label: "Growth rate", color: COLORS.growthRate },
    ...(progression.milestones.length > 0 ? [{ label: "Milestone", color: COLORS.milestone, dash: true }] : []),
  ];
  const { body, bottom } = progressionBody(progression, 50, { milestones: true });
  const sampling = progression.sampling;
  const note = `Sampling: ${sampling.method}, ${sampling.retainedPoints}/${sampling.sourcePoints} points${sampling.traceEverySteps && sampling.traceEverySteps > 1 ? `, trace every ${sampling.traceEverySteps} steps` : ""}.`;
  const footer = bottom + 8;
  return svgDocument(
    footer + 30,
    data.title,
    [
      ...legend(WIDTH - MARGIN.right - legendWidth(legendItems), 48, legendItems),
      ...body,
      `<text x="${MARGIN.left}" y="${num(footer + 10)}" font-size="10" fill="${COLORS.muted}">${escapeXml(note)}</text>`,
    ],
    `Progression of money${seriesById(progression, "netWorth") ? " and net worth" : ""} on a log10 axis, growth rate, and ${progression.milestones.length} milestone marker(s).`,
  );
}

function kpiBars(compare: CompareChartData, top: number): { body: string[]; bottom: number } {
  const body: string[] = [];
  const rowHeight = 30;
  const labelWidth = 230;
  const x0 = MARGIN.left + labelWidth;
  const x1 = WIDTH - MARGIN.right - 150;
  const mid = (x0 + x1) / 2;
  const values = compare.kpis.map((row) => row.relativeChangePct).filter((v): v is number => v !== null);
  // Bars share one scale: the largest |change|, at least 1% and at most 1000% (larger changes are clipped).
  const limit = Math.min(1000, Math.max(1, ...values.map((v) => Math.abs(v))));
  body.push(`<text x="${MARGIN.left}" y="${num(top)}" font-size="12" font-weight="600" fill="${COLORS.text}">KPI change, B vs A (percent of A; bar color = better side)</text>`);
  const y0 = top + 14;
  body.push(`<line x1="${num(mid)}" y1="${num(y0)}" x2="${num(mid)}" y2="${num(y0 + compare.kpis.length * rowHeight)}" stroke="${COLORS.axis}"/>`);
  compare.kpis.forEach((row, index) => {
    const y = y0 + index * rowHeight;
    const color = row.better === "b" ? COLORS.better : row.better === "a" ? COLORS.worse : COLORS.neutral;
    body.push(`<text x="${MARGIN.left}" y="${num(y + 19)}" font-size="12" fill="${COLORS.text}">${escapeXml(row.metric)} (${row.preference})</text>`);
    if (row.relativeChangePct !== null) {
      const clamped = Math.max(-limit, Math.min(limit, row.relativeChangePct));
      const width = (Math.abs(clamped) / limit) * (mid - x0);
      const x = clamped >= 0 ? mid : mid - width;
      body.push(`<rect x="${num(x)}" y="${num(y + 6)}" width="${num(Math.max(1, width))}" height="18" fill="${color}" rx="2"/>`);
    }
    const change = row.relativeChangePct !== null
      ? `${row.relativeChangePct >= 0 ? "+" : ""}${sig(row.relativeChangePct, 3)}%`
      : row.log10Delta !== null
        ? `Δlog10 ${row.log10Delta >= 0 ? "+" : ""}${sig(row.log10Delta, 3)}`
        : "n/a";
    const better = row.better === "a" || row.better === "b" ? row.better.toUpperCase() : row.better;
    body.push(`<text x="${num(x1 + 10)}" y="${num(y + 19)}" font-size="12" fill="${COLORS.text}">${escapeXml(`${change} · better: ${better}`)}</text>`);
  });
  return { body, bottom: y0 + compare.kpis.length * rowHeight + 10 };
}

export function renderCompareSvg(data: ChartDataV1): string {
  const compare = data.compare;
  if (!compare) throw new Error("renderCompareSvg requires compare data");
  const body: string[] = [];
  body.push(`<text x="${MARGIN.left}" y="46" font-size="11" fill="${COLORS.muted}">${escapeXml(`A: ${compare.labels.a}`)}</text>`);
  body.push(`<text x="${MARGIN.left}" y="62" font-size="11" fill="${COLORS.muted}">${escapeXml(`B: ${compare.labels.b}`)}</text>`);
  const bars = kpiBars(compare, 92);
  body.push(...bars.body);
  let bottom = bars.bottom;
  if (compare.progression) {
    const a = compare.progression.a;
    const b = compare.progression.b;
    const primary = (data_: ProgressionChartData) => seriesById(data_, data_.primarySeries) ?? seriesById(data_, "money");
    const sa = primary(a);
    const sb = primary(b);
    const tx = timeExtent([[...(sa?.points ?? [])], [...(sb?.points ?? [])]]);
    const panel: Panel = {
      x0: MARGIN.left,
      x1: WIDTH - MARGIN.right,
      y0: bottom + 30,
      y1: bottom + 270,
      tx,
      ty: extent(finiteYs([sa, sb])),
    };
    body.push(...frame(panel, {
      title: `Economy run ${a.primarySeries === "netWorth" ? "net worth" : "money"} (log10 ${sa?.unit ?? ""})`.trim(),
      yLabel: amountLabel,
      yTicks: ticks(panel.ty.min, panel.ty.max, 6),
      xTicks: timeTicks(tx.min, tx.max, 8),
    }));
    if (sa) body.push(`<path d="${linePath(panel, sa.points)}" fill="none" stroke="${COLORS.a}" stroke-width="2"/>`);
    if (sb) body.push(`<path d="${linePath(panel, sb.points)}" fill="none" stroke="${COLORS.b}" stroke-width="2" stroke-dasharray="6 3"/>`);
    body.push(...legend(WIDTH - MARGIN.right - 100, panel.y0 - 10, [
      { label: "A", color: COLORS.a },
      { label: "B", color: COLORS.b, dash: true },
    ]));
    bottom = panel.y1 + 30;
  }
  return svgDocument(
    bottom + 16,
    data.title,
    body,
    `A/B comparison of ${compare.kpis.length} KPI(s)${compare.progression ? " with economy-run progression curves" : ""}.`,
  );
}

function mix(hex: string, t: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff;
    return Math.round(255 + (c - 255) * t);
  };
  const out = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${out.toString(16).padStart(6, "0")}`;
}

export function renderSensitivitySvg(data: ChartDataV1): string {
  const sensitivity: SensitivityChartData | undefined = data.sensitivity;
  if (!sensitivity) throw new Error("renderSensitivitySvg requires sensitivity data");
  const labelWidth = 260;
  const cellWidth = Math.max(90, Math.min(180, Math.floor((WIDTH - MARGIN.left - MARGIN.right - labelWidth) / Math.max(1, sensitivity.columns.length))));
  const cellHeight = 30;
  const top = 92;
  const body: string[] = [];
  body.push(`<text x="${MARGIN.left}" y="48" font-size="11" fill="${COLORS.muted}">One-at-a-time local elasticity: relative metric change / relative parameter change. Not a global or Sobol index.</text>`);
  body.push(`<text x="${MARGIN.left}" y="64" font-size="11" fill="${COLORS.muted}">Red = metric moves with the parameter, blue = against it. Color intensity is |elasticity| relative to the largest observed.</text>`);
  const maxAbs = Math.max(
    1e-12,
    ...sensitivity.cells.map((cell) => (cell.elasticity === null ? 0 : Math.abs(cell.elasticity))),
  );
  sensitivity.columns.forEach((column, index) => {
    const x = MARGIN.left + labelWidth + index * cellWidth + cellWidth / 2;
    const label = column.length > 20 ? `${column.slice(0, 19)}…` : column;
    body.push(`<text x="${num(x)}" y="${num(top - 8)}" text-anchor="middle" font-size="11" font-weight="600" fill="${COLORS.text}">${escapeXml(label)}</text>`);
  });
  sensitivity.rows.forEach((row, rowIndex) => {
    const y = top + rowIndex * cellHeight;
    const label = `${row.dimensionId} · ${row.candidateId}`;
    const clipped = label.length > 40 ? `${label.slice(0, 39)}…` : label;
    body.push(`<text x="${MARGIN.left}" y="${num(y + 19)}" font-size="11" fill="${COLORS.text}">${escapeXml(clipped)}</text>`);
    sensitivity.columns.forEach((column, colIndex) => {
      const x = MARGIN.left + labelWidth + colIndex * cellWidth;
      const cell = sensitivity.cells.find((entry) =>
        entry.dimensionId === row.dimensionId && entry.candidateId === row.candidateId && entry.metricId === column);
      const value = cell?.elasticity ?? null;
      const fill = value === null
        ? "#f3f4f6"
        : value === 0
          ? "#ffffff"
          : mix(value > 0 ? COLORS.b : COLORS.a, 0.15 + 0.85 * Math.min(1, Math.abs(value) / maxAbs));
      const strong = value !== null && Math.abs(value) / maxAbs > 0.6;
      body.push(`<rect x="${num(x + 1)}" y="${num(y + 1)}" width="${num(cellWidth - 2)}" height="${num(cellHeight - 2)}" fill="${fill}" stroke="${COLORS.grid}"/>`);
      const text = value === null ? (cell?.elasticityText ?? "n/a") : sig(value, 3);
      body.push(`<text x="${num(x + cellWidth / 2)}" y="${num(y + 19)}" text-anchor="middle" font-size="11" fill="${strong ? "#ffffff" : COLORS.text}">${escapeXml(text.length > 14 ? `${text.slice(0, 13)}…` : text)}</text>`);
    });
  });
  const bottom = top + sensitivity.rows.length * cellHeight;
  return svgDocument(
    bottom + 30,
    data.title,
    body,
    `Local sensitivity heatmap with ${sensitivity.rows.length} probe row(s) and ${sensitivity.columns.length} metric column(s).`,
  );
}

/** Render any chart data document to SVG. */
export function renderChartSvg(data: ChartDataV1): string {
  switch (data.kind) {
    case "progression":
      return renderProgressionSvg(data);
    case "compare":
      return renderCompareSvg(data);
    case "sensitivity":
      return renderSensitivitySvg(data);
  }
}
