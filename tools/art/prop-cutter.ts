export interface CutProp {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CutOptions {
  /** Alpha at or above which a pixel counts as part of a sprite body. */
  alphaThreshold?: number;
  /** Gap, in pixels, that still joins detached parts to their sprite. */
  mergeRadius?: number;
  /** Smallest group kept, as a fraction of the largest group in the same cell. */
  minimumGroupFraction?: number;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dx = Math.max(0, x - radius); dx <= Math.min(width - 1, x + radius); dx++)
        horizontal[y * width + dx] = 1;
    }
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!horizontal[y * width + x]) continue;
      for (let dy = Math.max(0, y - radius); dy <= Math.min(height - 1, y + radius); dy++)
        output[dy * width + x] = 1;
    }
  return output;
}

/**
 * Cuts a sheet of props laid out roughly on a grid into one sprite per cell.
 * Props are found as connected groups of opaque pixels, so a prop that overhangs
 * its nominal cell stays whole and the overhang of a neighbour is never
 * mistaken for part of this cell's prop. A group belongs to the cell that holds
 * its centroid; small groups are dropped from each cell as stray specks.
 */
export function cutProps(
  rgba: Uint8Array,
  width: number,
  height: number,
  columns: number,
  rows: number,
  options: CutOptions = {},
): CutProp[] {
  if (rgba.length !== width * height * 4) throw new Error('RGBA buffer dimensions do not match');
  const threshold = options.alphaThreshold ?? 16;
  const radius = options.mergeRadius ?? 4;
  const minimumFraction = options.minimumGroupFraction ?? 0.02;
  const body = new Uint8Array(width * height);
  for (let i = 0; i < body.length; i++) body[i] = rgba[i * 4 + 3]! >= threshold ? 1 : 0;
  const joined = dilate(body, width, height, radius);

  const label = new Int32Array(width * height).fill(-1);
  const groups: { area: number; sumX: number; sumY: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < joined.length; start++) {
    if (!joined[start] || label[start]! >= 0) continue;
    const id = groups.length;
    const group = { area: 0, sumX: 0, sumY: 0 };
    groups.push(group);
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      if (body[index]) {
        group.area++;
        group.sumX += x;
        group.sumY += y;
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (joined[next] && label[next]! < 0) {
            label[next] = id;
            stack.push(next);
          }
        }
    }
  }

  const owner = groups.map((group) => {
    if (group.area === 0) return -1;
    const column = Math.min(columns - 1, Math.floor((group.sumX / group.area / width) * columns));
    const row = Math.min(rows - 1, Math.floor((group.sumY / group.area / height) * rows));
    return row * columns + column;
  });
  const largest = new Array<number>(columns * rows).fill(0);
  groups.forEach((group, id) => {
    const cell = owner[id]!;
    if (cell >= 0) largest[cell] = Math.max(largest[cell]!, group.area);
  });
  const kept = groups.map((group, id) => {
    const cell = owner[id]!;
    return cell >= 0 && group.area >= largest[cell]! * minimumFraction;
  });

  const sprites: CutProp[] = [];
  for (let cell = 0; cell < columns * rows; cell++) {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    const belongs = (index: number): boolean => {
      const id = label[index]!;
      return id >= 0 && owner[id] === cell && kept[id]! && rgba[index * 4 + 3]! > 0;
    };
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!belongs(y * width + x)) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    if (right < left) throw new Error(`Source sheet contains an empty prop cell ${cell}`);
    const spriteWidth = right - left + 1;
    const spriteHeight = bottom - top + 1;
    const data = new Uint8Array(spriteWidth * spriteHeight * 4);
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const index = y * width + x;
        if (!belongs(index)) continue;
        data.set(
          rgba.subarray(index * 4, index * 4 + 4),
          ((y - top) * spriteWidth + (x - left)) * 4,
        );
      }
    sprites.push({ width: spriteWidth, height: spriteHeight, data });
  }
  return sprites;
}
