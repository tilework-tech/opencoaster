import { gameDate } from '../sim/economy/calendar';

export function formatMoney(cents: number): string {
  const abs = (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? '-' : ''}$${abs}`;
}

/** Whole dollars, for tables where cents only add width. */
export function formatWholeMoney(cents: number): string {
  const abs = Math.round(Math.abs(cents) / 100).toLocaleString('en-US');
  return `${cents < 0 && Math.round(Math.abs(cents) / 100) > 0 ? '-' : ''}$${abs}`;
}

export function formatDate(tick: number): string {
  const date = gameDate(tick);
  return `${date.day} ${date.monthName}, Year ${date.year}`;
}

export const PRICE_STEP_CENTS = 10;
export const MAX_PRICE_CENTS = 65_535;

/** One step of a price spinner, clamped to what the simulation accepts. */
export function stepPrice(cents: number, direction: 1 | -1, max: number): number {
  return Math.max(0, Math.min(max, cents + direction * PRICE_STEP_CENTS));
}

/** Whole cents for a typed dollar amount, or null when it is not a valid price. */
export function parsePriceCents(text: string): number | null {
  const value = Number(text.replace(/^\s*\$/, '').trim());
  if (text.trim() === '' || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return cents <= MAX_PRICE_CENTS ? cents : null;
}

/** Client-side history for the graph tabs: one value per `interval` ticks, newest last. */
export class SampleSeries {
  private data: number[] = [];
  private lastTick = -Infinity;

  constructor(
    private readonly capacity: number,
    private readonly interval: number,
  ) {}

  record(tick: number, value: number): void {
    if (tick < this.lastTick) this.data = [];
    else if (tick - this.lastTick < this.interval && this.data.length > 0) return;
    this.lastTick = tick;
    this.data.push(value);
    if (this.data.length > this.capacity) this.data.shift();
  }

  values(): readonly number[] {
    return this.data;
  }
}

/** Draws a filled line chart scaled to the data's range. */
export function drawChart(
  canvas: HTMLCanvasElement,
  values: readonly number[],
  color = '#9be28a',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#10181d';
  ctx.fillRect(0, 0, width, height);
  if (values.length < 2) return;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, min + 1);
  const x = (i: number): number => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number): number => height - 4 - ((v - min) / (max - min)) * (height - 8);
  ctx.strokeStyle = '#2b3b44';
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  ctx.lineTo(width, y(0));
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.stroke();
}
