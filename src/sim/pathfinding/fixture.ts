import type { PathGraph } from './graph';

/** Test/bench fixture: a path graph parsed from ASCII rows where '#' is path and anything else is empty. */
export class GridPathGraph implements PathGraph {
  pathVersion = 0;
  readonly width: number;
  readonly height: number;
  private readonly cells: Uint8Array;

  constructor(rows: readonly string[]) {
    this.height = rows.length;
    this.width = rows[0].length;
    this.cells = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++)
        this.cells[y * this.width + x] = rows[y][x] === '#' ? 1 : 0;
    }
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  setPath(x: number, y: number, on: boolean): void {
    this.cells[this.index(x, y)] = on ? 1 : 0;
    this.pathVersion++;
  }

  edgeMask(i: number): number {
    if (this.cells[i] === 0) return 0;
    const x = i % this.width;
    const y = (i / this.width) | 0;
    let m = 0;
    if (x + 1 < this.width && this.cells[i + 1]) m |= 1;
    if (y + 1 < this.height && this.cells[i + this.width]) m |= 2;
    if (x > 0 && this.cells[i - 1]) m |= 4;
    if (y > 0 && this.cells[i - this.width]) m |= 8;
    return m;
  }
}
