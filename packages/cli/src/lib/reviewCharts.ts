import { PNG } from "pngjs";

export type ReviewChartPoint = Readonly<{
  x: number;
  y: number;
}>;

export type ReviewChartSeries = Readonly<{
  color: readonly [number, number, number];
  points: readonly ReviewChartPoint[];
}>;

export type ReviewChartDefinition = Readonly<{
  title: string;
  width?: number;
  height?: number;
  series: readonly ReviewChartSeries[];
}>;

const GRID = [232, 236, 241] as const;
const AXIS = [148, 163, 184] as const;
const BACKGROUND = [15, 23, 42] as const;

function setPixel(png: PNG, x: number, y: number, color: readonly [number, number, number], alpha = 255): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (png.width * y + x) * 4;
  png.data[index] = color[0];
  png.data[index + 1] = color[1];
  png.data[index + 2] = color[2];
  png.data[index + 3] = alpha;
}

function drawLine(
  png: PNG,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: readonly [number, number, number],
): void {
  let x0 = Math.round(fromX);
  let y0 = Math.round(fromY);
  const x1 = Math.round(toX);
  const y1 = Math.round(toY);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    setPixel(png, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function numericExtent(values: readonly number[]): Readonly<{ min: number; max: number }> {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const delta = min === 0 ? 1 : Math.abs(min) * 0.1;
    return { min: min - delta, max: max + delta };
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

export function encodeLineChartPng(definition: ReviewChartDefinition): Uint8Array {
  const width = definition.width ?? 720;
  const height = definition.height ?? 240;
  const png = new PNG({ width, height });
  png.data.fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(png, x, y, BACKGROUND);
    }
  }

  const allPoints = definition.series.flatMap((series) => series.points).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const xExtent = numericExtent(allPoints.map((point) => point.x));
  const yExtent = numericExtent(allPoints.map((point) => point.y));

  const margin = { top: 16, right: 16, bottom: 20, left: 28 };
  const plotWidth = Math.max(32, width - margin.left - margin.right);
  const plotHeight = Math.max(32, height - margin.top - margin.bottom);

  const scaleX = (value: number) => margin.left + ((value - xExtent.min) / (xExtent.max - xExtent.min)) * plotWidth;
  const scaleY = (value: number) => margin.top + (1 - (value - yExtent.min) / (yExtent.max - yExtent.min)) * plotHeight;

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const x = Math.round(margin.left + plotWidth * ratio);
    const y = Math.round(margin.top + plotHeight * ratio);
    drawLine(png, x, margin.top, x, margin.top + plotHeight, GRID);
    drawLine(png, margin.left, y, margin.left + plotWidth, y, GRID);
  }

  drawLine(png, margin.left, margin.top, margin.left, margin.top + plotHeight, AXIS);
  drawLine(png, margin.left, margin.top + plotHeight, margin.left + plotWidth, margin.top + plotHeight, AXIS);

  for (const series of definition.series) {
    const points = series.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const current = points[i];
      if (!previous || !current) continue;
      drawLine(png, scaleX(previous.x), scaleY(previous.y), scaleX(current.x), scaleY(current.y), series.color);
    }
  }

  return PNG.sync.write(png);
}

export function log10FromNumberish(value: unknown): number {
  if (typeof value === "number") {
    return value > 0 ? Math.log10(value) : 0;
  }
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.log10(asNumber);
  }
  const scientific = /^([0-9]+(?:\.[0-9]+)?)e([+-]?\d+)$/i.exec(trimmed);
  if (scientific) {
    const mantissa = Number(scientific[1]);
    const exponent = Number(scientific[2]);
    return Math.log10(mantissa) + exponent;
  }
  const normalized = trimmed.replace(/^0+/, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 0;
  if (normalized.includes(".")) {
    const numeric = Number(normalized);
    return numeric > 0 ? Math.log10(numeric) : 0;
  }
  return normalized.length - 1;
}
