export const enum Surface {
  Grass = 0,
  Sand = 1,
  Water = 2,
  Path = 3,
}

export const MAX_HEIGHT = 31;

/** Dense tile grid in row-major order: index = y * width + x. One height level per tile corner-flat tile. */
export class TileMap {
  readonly heights: Uint8Array;
  readonly surface: Uint8Array;
  /** Per-tile bitfield; bit meanings are owned by the module that sets them (see map/docs.md). */
  readonly flags: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.heights = new Uint8Array(width * height);
    this.surface = new Uint8Array(width * height);
    this.flags = new Uint8Array(width * height);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  setHeight(x: number, y: number, h: number): void {
    if (!this.inBounds(x, y)) return;
    this.heights[this.index(x, y)] = Math.max(0, Math.min(MAX_HEIGHT, h));
  }
}
