import { ramp } from './palette';
import { TRANSPARENT } from './raster';
import type { Sprite } from './raster';

/**
 * Hand-placed pixel art for the toolbar and window-tab icons. Each drawing is built from
 * whole-pixel rectangles, discs, strokes and scanline polygons on a 24×24 grid with a one-pixel
 * outline, drawing from the shared palette ramps so every icon keeps one look.
 */

const SIZE = 24;
const outline = ramp('outline')[0];
const tone = (family: string, shade: number): number => ramp(family)[shade];

type Point = readonly [number, number];

class Canvas {
  readonly pixels = new Uint8Array(SIZE * SIZE).fill(TRANSPARENT);

  px(x: number, y: number, color: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) this.pixels[y * SIZE + x] = color;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color);
  }

  /** A filled rectangle with a one-pixel outline drawn outside it. */
  box(x: number, y: number, w: number, h: number, fill: number, light?: number, dark?: number) {
    this.rect(x - 1, y - 1, w + 2, h + 2, outline);
    this.rect(x, y, w, h, fill);
    if (light !== undefined) this.rect(x, y, w, 1, light);
    if (dark !== undefined) this.rect(x, y + h - 1, w, 1, dark);
  }

  disc(cx: number, cy: number, r: number, color: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.px(x, y, color);
  }

  /** Round blob with an outline ring one pixel wide. */
  ball(cx: number, cy: number, r: number, fill: number, light?: number): void {
    this.disc(cx, cy, r + 1, outline);
    this.disc(cx, cy, r, fill);
    if (light !== undefined) this.px(cx - r * 0.4, cy - r * 0.4, light);
  }

  line(a: Point, b: Point, color: number, width = 1): void {
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * i) / steps);
      const y = Math.round(a[1] + ((b[1] - a[1]) * i) / steps);
      this.rect(x, y, width, width, color);
    }
  }

  /** A stroke with an outline: the outline pass is one pixel wider on every side. */
  stroke(points: readonly Point[], color: number, width = 2, shade?: number): void {
    for (let i = 0; i + 1 < points.length; i++)
      this.line(
        [points[i][0] - 1, points[i][1] - 1],
        [points[i + 1][0] - 1, points[i + 1][1] - 1],
        outline,
        width + 2,
      );
    for (let i = 0; i + 1 < points.length; i++) {
      this.line(points[i], points[i + 1], color, width);
      if (shade !== undefined)
        this.line(
          [points[i][0], points[i][1] + width - 1],
          [points[i + 1][0], points[i + 1][1] + width - 1],
          shade,
          1,
        );
    }
  }

  fill(points: readonly Point[], color: number): void {
    const ys = points.map((p) => p[1]);
    for (
      let y = Math.max(0, Math.floor(Math.min(...ys)));
      y <= Math.min(23, Math.max(...ys));
      y++
    ) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        const yy = y + 0.5;
        if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy))
          xs.push(x0 + ((yy - y0) * (x1 - x0)) / (y1 - y0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.px(x, y, color);
    }
  }

  /** A filled polygon with a one-pixel outline. */
  poly(points: readonly Point[], color: number): void {
    this.fill(points, outline);
    for (let i = 0; i < points.length; i++)
      this.line(points[i], points[(i + 1) % points.length], outline, 1);
    this.fill(shrink(points), color);
  }

  sprite(): Sprite {
    return {
      width: SIZE,
      height: SIZE,
      anchor: { x: SIZE / 2, y: SIZE / 2 },
      pixels: this.pixels,
    };
  }
}

function shrink(points: readonly Point[]): Point[] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([x, y]) => [x + Math.sign(cx - x) * 0.9, y + Math.sign(cy - y) * 0.9]);
}

function shovel(c: Canvas): void {
  c.rect(2, 20, 20, 2, outline);
  c.rect(3, 19, 18, 2, tone('dirt', 3));
  c.rect(6, 18, 12, 2, tone('dirt', 3));
  c.rect(4, 20, 16, 1, tone('dirt', 1));
  c.rect(7, 17, 10, 1, outline);
  c.box(7, 1, 10, 3, tone('wood', 3), tone('wood', 4), tone('wood', 1));
  c.box(11, 4, 2, 8, tone('wood', 3), tone('wood', 4));
  c.poly(
    [
      [6, 11],
      [18, 11],
      [17, 18],
      [12, 20],
      [7, 18],
    ],
    tone('steel', 3),
  );
  c.rect(8, 12, 2, 5, tone('steel', 4));
  c.rect(14, 12, 3, 5, tone('steel', 2));
  c.rect(11, 12, 2, 7, tone('steel', 2));
}

function droplet(c: Canvas): void {
  const pts: Point[] = [
    [12, 1],
    [14, 6],
    [17, 11],
    [18, 15],
    [16, 19],
    [12, 21],
    [8, 19],
    [6, 15],
    [7, 11],
    [10, 6],
  ];
  c.poly(pts, tone('blue', 3));
  c.fill(
    [
      [12, 12],
      [18, 12],
      [18, 15],
      [16, 19],
      [12, 20],
      [8, 19],
      [6, 15],
      [6, 12],
    ],
    tone('blue', 2),
  );
  c.rect(9, 8, 1, 4, tone('foam', 3));
  c.px(10, 6, tone('foam', 3));
}

function axe(c: Canvas): void {
  c.rect(3, 19, 14, 3, outline);
  c.rect(4, 20, 12, 1, tone('dirt', 3));
  c.stroke(
    [
      [6, 18],
      [16, 8],
    ],
    tone('wood', 3),
    2,
    tone('wood', 1),
  );
  c.poly(
    [
      [9, 2],
      [20, 2],
      [21, 9],
      [15, 11],
      [12, 8],
    ],
    tone('steel', 3),
  );
  c.rect(11, 4, 8, 1, tone('steel', 4));
  c.rect(18, 4, 2, 4, tone('steel', 2));
}

function path(c: Canvas): void {
  const tile = (nudge: number): Point[] => [
    [12, 3 + nudge],
    [22, 9 + nudge],
    [12, 15 + nudge],
    [2, 9 + nudge],
  ];
  c.poly(tile(5), tone('paving', 0));
  c.poly(tile(3), tone('paving', 3));
  for (const [x, y, shade] of [
    [11, 7, 4],
    [8, 9, 2],
    [14, 9, 2],
    [11, 11, 4],
    [17, 8, 2],
    [5, 8, 2],
  ] as const)
    c.rect(x, y, 3, 1, tone('paving', shade));
  c.line([12, 6], [12, 10], tone('paving', 4));
}

function wheel(c: Canvas): void {
  const cx = 12;
  const cy = 10;
  c.line([cx - 1, cy], [6, 20], outline, 3);
  c.line([cx + 1, cy], [18, 20], outline, 3);
  c.line([cx - 1, cy], [6, 20], tone('steel', 3), 1);
  c.line([cx, cy], [18, 20], tone('steel', 3), 1);
  c.line([cx, cy], [6, 20], tone('steel', 3), 1);
  c.line([cx - 1, cy], [18, 20], tone('steel', 3), 1);
  c.disc(cx, cy, 8.5, outline);
  c.disc(cx, cy, 6.5, TRANSPARENT);
  for (let a = 0; a < 8; a++) {
    const t = (a * Math.PI) / 4;
    c.line([cx, cy], [cx + Math.cos(t) * 7, cy + Math.sin(t) * 7], tone('steel', 4));
  }
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - cy - 0.5);
      if (d >= 6.5 && d < 8.3 && c.pixels[y * SIZE + x] === outline) c.px(x, y, tone('yellow', 3));
    }
  const cabs = ['red', 'blue', 'green', 'orange', 'pink', 'purple', 'red', 'blue'];
  cabs.forEach((family, a) => {
    const t = (a * Math.PI) / 4;
    c.box(
      Math.round(cx + Math.cos(t) * 7.4 - 1),
      Math.round(cy + Math.sin(t) * 7.4 - 1),
      3,
      3,
      tone(family, 3),
    );
  });
  c.ball(cx, cy, 2, tone('red', 3), tone('red', 4));
}

function coasterCurve(c: Canvas, withBadge: boolean): void {
  const hump = (x: number): number => 15 - 11 * Math.sin((Math.PI * (x - 2)) / 18);
  for (const x of [5, 10, 15, 19]) {
    const y = Math.round(hump(x)) + 2;
    c.rect(x - 1, y, 3, 22 - y, outline);
    c.rect(x, y, 1, 22 - y, tone('steel', 3));
  }
  const pts: Point[] = [];
  for (let x = 2; x <= 20; x++) pts.push([x, Math.round(hump(x))]);
  c.stroke(pts, tone('red', 3), 2, tone('red', 1));
  c.box(8, 3, 7, 4, tone('yellow', 3), tone('yellow', 4), tone('yellow', 1));
  c.rect(9, 7, 2, 1, outline);
  c.rect(12, 7, 2, 1, outline);
  if (withBadge) {
    c.box(17, 17, 5, 5, tone('green', 3));
    c.rect(19, 18, 1, 3, tone('green', 4));
    c.rect(18, 19, 3, 1, tone('green', 4));
  }
}

function rideCar(c: Canvas): void {
  c.rect(1, 20, 22, 3, outline);
  c.rect(2, 21, 20, 1, tone('steel', 3));
  c.box(2, 8, 20, 8, tone('red', 3), tone('red', 4), tone('red', 1));
  c.box(4, 4, 7, 4, tone('red', 2), tone('red', 3));
  c.box(13, 4, 7, 4, tone('red', 2), tone('red', 3));
  c.rect(4, 10, 16, 2, tone('yellow', 3));
  c.ball(6, 18, 2, tone('steel', 2));
  c.ball(17, 18, 2, tone('steel', 2));
}

function dropTower(c: Canvas): void {
  c.box(10, 5, 4, 15, tone('steel', 3), tone('steel', 4), tone('steel', 1));
  c.box(3, 20, 18, 2, tone('stone', 2));
  c.box(4, 12, 16, 4, tone('red', 3), tone('red', 4), tone('red', 1));
  c.rect(7, 13, 2, 1, tone('white', 4));
  c.rect(15, 13, 2, 1, tone('white', 4));
  c.rect(11, 1, 1, 3, outline);
  c.rect(12, 1, 3, 2, tone('yellow', 3));
}

function transportTrain(c: Canvas): void {
  c.rect(1, 20, 22, 3, outline);
  c.rect(2, 21, 20, 1, tone('steel', 3));
  c.box(3, 4, 18, 13, tone('blue', 3), tone('blue', 4), tone('blue', 1));
  c.box(5, 6, 6, 5, tone('glass', 4));
  c.box(13, 6, 6, 5, tone('glass', 4));
  c.rect(3, 13, 18, 1, tone('yellow', 3));
  c.rect(7, 15, 2, 2, tone('yellow', 4));
  c.rect(15, 15, 2, 2, tone('yellow', 4));
  c.rect(3, 17, 18, 1, tone('blue', 1));
}

function boat(c: Canvas): void {
  c.line([12, 2], [12, 12], outline, 3);
  c.line([12, 3], [12, 12], tone('wood', 3), 1);
  c.poly(
    [
      [13, 3],
      [20, 12],
      [13, 12],
    ],
    tone('white', 4),
  );
  c.poly(
    [
      [2, 13],
      [22, 13],
      [19, 19],
      [5, 19],
    ],
    tone('red', 3),
  );
  c.rect(4, 14, 16, 1, tone('red', 4));
  for (const y of [20, 22]) {
    c.rect(1, y, 22, 1, tone('blue', 3));
    for (let x = 1; x < 24; x += 4) c.rect(x, y, 2, 1, tone('foam', 4));
  }
}

function iceCream(c: Canvas): void {
  c.poly(
    [
      [7, 12],
      [17, 12],
      [12, 21],
    ],
    tone('orange', 3),
  );
  c.line([9, 12], [13, 20], tone('orange', 2));
  c.line([13, 12], [11, 17], tone('orange', 4));
  c.ball(8, 8, 3, tone('pink', 3), tone('pink', 4));
  c.ball(16, 8, 3, tone('white', 3), tone('white', 4));
  c.ball(12, 5, 3, tone('pink', 4), tone('white', 4));
}

function toilet(c: Canvas): void {
  c.box(2, 4, 20, 16, tone('blue', 3), tone('blue', 4), tone('blue', 1));
  const w: Point[] = [
    [4, 8],
    [6, 14],
    [8, 10],
    [10, 14],
    [12, 8],
  ];
  c.stroke(w, tone('white', 4), 1);
  c.rect(14, 8, 5, 1, tone('white', 4));
  c.rect(14, 14, 5, 1, tone('white', 4));
  c.rect(14, 8, 1, 7, tone('white', 4));
}

function chart(c: Canvas): void {
  c.box(2, 2, 20, 20, tone('white', 3), tone('white', 4), tone('white', 1));
  c.box(5, 13, 3, 6, tone('blue', 3));
  c.box(10, 9, 3, 10, tone('green', 3));
  c.box(15, 5, 3, 14, tone('orange', 3));
}

function megaphone(c: Canvas): void {
  c.poly(
    [
      [3, 9],
      [10, 9],
      [20, 3],
      [20, 19],
      [10, 14],
      [3, 14],
    ],
    tone('red', 3),
  );
  c.rect(5, 10, 5, 1, tone('red', 4));
  c.box(5, 15, 3, 6, tone('steel', 3), tone('steel', 4));
  c.rect(20, 7, 3, 1, tone('yellow', 3));
  c.rect(20, 11, 3, 1, tone('yellow', 3));
  c.rect(20, 15, 3, 1, tone('yellow', 3));
}

function bag(c: Canvas): void {
  c.stroke(
    [
      [8, 8],
      [8, 4],
      [10, 2],
      [14, 2],
      [16, 4],
      [16, 8],
    ],
    tone('steel', 3),
    1,
  );
  c.poly(
    [
      [3, 8],
      [21, 8],
      [20, 22],
      [4, 22],
    ],
    tone('orange', 3),
  );
  c.rect(4, 9, 16, 2, tone('orange', 4));
  c.rect(8, 14, 8, 4, tone('yellow', 3));
}

function thought(c: Canvas): void {
  c.poly(
    [
      [2, 3],
      [22, 3],
      [22, 16],
      [14, 16],
      [8, 22],
      [8, 16],
      [2, 16],
    ],
    tone('white', 3),
  );
  c.rect(5, 6, 14, 2, tone('steel', 2));
  c.rect(5, 10, 10, 2, tone('steel', 2));
}

function rotate(c: Canvas, clockwise: boolean): void {
  const cx = clockwise ? 10.5 : 12.5;
  const cy = 12.5;
  const r = 6;
  const pts: Point[] = [];
  for (let d = 0; d <= 215; d += 6) {
    const t = ((clockwise ? 160 + d : 20 - d) * Math.PI) / 180;
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  c.stroke(pts, tone('yellow', 3), 3, tone('yellow', 1));
  const end = ((clockwise ? 160 + 215 : 20 - 215) * Math.PI) / 180;
  const dir = clockwise ? 1 : -1;
  const ex = cx + Math.cos(end) * r + 1;
  const ey = cy + Math.sin(end) * r + 1;
  const nx = Math.cos(end);
  const ny = Math.sin(end);
  const tx = -Math.sin(end) * dir;
  const ty = Math.cos(end) * dir;
  c.poly(
    [
      [ex + tx * 7, ey + ty * 7],
      [ex + nx * 6, ey + ny * 6],
      [ex - nx * 6, ey - ny * 6],
    ],
    tone('yellow', 4),
  );
}

const DRAWINGS: Record<string, (c: Canvas) => void> = {
  land: shovel,
  water: droplet,
  demolish: axe,
  paths: path,
  wheel,
  rides: rideCar,
  newRide: (c) => coasterCurve(c, true),
  coaster: (c) => coasterCurve(c, false),
  twist: dropTower,
  transport: transportTrain,
  boat,
  food: iceCream,
  toilet,
  chart,
  megaphone,
  bag,
  thought,
  rotateLeft: (c) => rotate(c, false),
  rotateRight: (c) => rotate(c, true),
};

export function hasPixelDrawing(name: string): boolean {
  return name in DRAWINGS;
}

/** The 24×24 hand-placed drawing for an icon, or null when the icon is generated elsewhere. */
export function drawIcon(name: string): Sprite | null {
  const draw = DRAWINGS[name];
  if (!draw) return null;
  const canvas = new Canvas();
  draw(canvas);
  return centered(canvas.sprite());
}

function centered(sprite: Sprite): Sprite {
  let minX = SIZE;
  let minY = SIZE;
  let maxX = -1;
  let maxY = -1;
  sprite.pixels.forEach((color, index) => {
    if (color === TRANSPARENT) return;
    minX = Math.min(minX, index % SIZE);
    maxX = Math.max(maxX, index % SIZE);
    minY = Math.min(minY, Math.floor(index / SIZE));
    maxY = Math.max(maxY, Math.floor(index / SIZE));
  });
  const dx = Math.floor((SIZE - (maxX - minX + 1)) / 2) - minX;
  const dy = Math.floor((SIZE - (maxY - minY + 1)) / 2) - minY;
  const pixels = new Uint8Array(SIZE * SIZE).fill(TRANSPARENT);
  sprite.pixels.forEach((color, index) => {
    if (color !== TRANSPARENT)
      pixels[(Math.floor(index / SIZE) + dy) * SIZE + (index % SIZE) + dx] = color;
  });
  return { ...sprite, pixels };
}
