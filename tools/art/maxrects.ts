export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** MaxRects bin packing with the best-short-side-fit heuristic; placement is deterministic. */
export class MaxRectsBin {
  private free: Rect[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.free = [{ x: 0, y: 0, width, height }];
  }

  /** Reserves a width x height rectangle, or returns null when none of the free space fits it. */
  insert(width: number, height: number): Rect | null {
    let best: Rect | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const free of this.free) {
      if (free.width < width || free.height < height) continue;
      const leftoverX = free.width - width;
      const leftoverY = free.height - height;
      const short = Math.min(leftoverX, leftoverY);
      const long = Math.max(leftoverX, leftoverY);
      if (
        short < bestShort ||
        (short === bestShort && long < bestLong) ||
        (short === bestShort &&
          long === bestLong &&
          best !== null &&
          (free.y < best.y || (free.y === best.y && free.x < best.x)))
      ) {
        best = free;
        bestShort = short;
        bestLong = long;
      }
    }
    if (!best) return null;
    const placed = { x: best.x, y: best.y, width, height };
    this.split(placed);
    return placed;
  }

  private split(used: Rect): void {
    const next: Rect[] = [];
    for (const free of this.free) {
      if (!intersects(free, used)) {
        next.push(free);
        continue;
      }
      if (used.x > free.x)
        next.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
      if (used.x + used.width < free.x + free.width)
        next.push({
          x: used.x + used.width,
          y: free.y,
          width: free.x + free.width - used.x - used.width,
          height: free.height,
        });
      if (used.y > free.y)
        next.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
      if (used.y + used.height < free.y + free.height)
        next.push({
          x: free.x,
          y: used.y + used.height,
          width: free.width,
          height: free.y + free.height - used.y - used.height,
        });
    }
    this.free = next.filter(
      (rect, index) =>
        !next.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            contains(other, rect) &&
            (!contains(rect, other) || otherIndex < index),
        ),
    );
  }
}
