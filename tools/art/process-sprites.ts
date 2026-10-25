import { deflateSync, inflateSync } from 'node:zlib';
import { basename, dirname, join, parse } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type Png = { width: number; height: number; pixels: Buffer };

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const DIRECTIONS = ['front', 'right', 'back', 'left'] as const;
const GUEST_SHIRTS = [
  [215, 69, 74],
  [237, 198, 66],
  [61, 157, 93],
  [57, 132, 195],
  [137, 89, 173],
  [219, 216, 200],
  [223, 135, 68],
  [36, 166, 161],
] as const;
const GUEST_TROUSERS = [
  [65, 74, 91],
  [84, 96, 113],
  [99, 91, 73],
  [86, 107, 89],
  [101, 85, 115],
  [84, 76, 67],
  [115, 83, 67],
  [89, 71, 61],
] as const;
const PIXEL_PALETTE = [
  [24, 28, 35],
  [43, 48, 55],
  [64, 69, 72],
  [91, 79, 60],
  [119, 91, 59],
  [151, 114, 66],
  [184, 139, 77],
  [220, 172, 90],
  [245, 202, 112],
  [88, 132, 62],
  [111, 160, 73],
  [144, 181, 88],
  [46, 103, 113],
  [44, 130, 137],
  [73, 160, 156],
  [46, 94, 143],
  [67, 125, 177],
  [116, 85, 133],
  [151, 113, 166],
  [167, 101, 66],
  [202, 133, 82],
  [225, 169, 124],
  [236, 195, 161],
  [246, 219, 187],
] as const;

/** Largest share of a cell's width and height a figure may fill; the feet sit one pixel above the cell bottom. */
const FIGURE_WIDTH = 0.75;
const FIGURE_HEIGHT = 0.72;

function decodePng(bytes: Buffer): Png {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Input is not a PNG file');
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0)
    throw new Error('Sprite sources must be non-interlaced 8-bit RGBA PNGs');
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * stride;
    const inputStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const value = raw[inputStart + x];
      const left = x >= 4 ? pixels[rowStart + x - 4] : 0;
      const above = y > 0 ? pixels[rowStart + x - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[rowStart + x - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[rowStart + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const diagonalDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= diagonalDistance
    ? left
    : aboveDistance <= diagonalDistance
      ? above
      : upperLeft;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(image: Png): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(image.height * (image.width * 4 + 1));
  for (let y = 0; y < image.height; y++) {
    const outputOffset = y * (image.width * 4 + 1);
    scanlines[outputOffset] = 0;
    image.pixels.copy(scanlines, outputOffset + 1, y * image.width * 4, (y + 1) * image.width * 4);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function colorDistance(r: number, g: number, b: number, color: readonly number[]): number {
  return (r - color[0]!) ** 2 + (g - color[1]!) ** 2 + (b - color[2]!) ** 2;
}

function quantize(r: number, g: number, b: number): readonly number[] {
  let nearest = PIXEL_PALETTE[0]!;
  let distance = Number.POSITIVE_INFINITY;
  for (const color of PIXEL_PALETTE) {
    const next = colorDistance(r, g, b, color);
    if (next < distance) {
      nearest = color;
      distance = next;
    }
  }
  return nearest;
}

function clothingMask(
  r: number,
  g: number,
  b: number,
  localY: number,
  cellHeight: number,
): 0 | 1 | 2 {
  if (g > r * 1.16 && b > r * 1.08 && g < 205) return 1;
  if (localY > cellHeight * 0.47 && localY < cellHeight * 0.91 && r < 190 && g > b * 1.2) return 2;
  return 0;
}

function spriteCell(source: Png, column: number, row: number, columns: number, rows: number) {
  const left = Math.floor((column * source.width) / columns);
  const right = Math.floor(((column + 1) * source.width) / columns);
  const top = Math.floor((row * source.height) / rows);
  const bottom = Math.floor(((row + 1) * source.height) / rows);
  const width = right - left;
  const height = bottom - top;
  const pixels = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(width * height * 4);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const input = ((top + y) * source.width + left + x) * 4;
      const output = (y * width + x) * 4;
      const alpha = source.pixels[input + 3]!;
      if (alpha < 128) continue;
      const r = source.pixels[input]!;
      const g = source.pixels[input + 1]!;
      const b = source.pixels[input + 2]!;
      const group = clothingMask(r, g, b, y, height);
      const base = quantize(r, g, b);
      pixels[output] = base[0]!;
      pixels[output + 1] = base[1]!;
      pixels[output + 2] = base[2]!;
      pixels[output + 3] = 255;
      const shade = Math.max(64, Math.min(255, Math.round((r + g + b) / 3)));
      if (group === 1) mask[output] = shade;
      if (group === 2) mask[output + 1] = shade;
      if (group !== 0) mask[output + 3] = 255;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY)
    throw new Error(`Grid cell ${column},${row} has no opaque pixels`);
  return { pixels, mask, width, height, bounds: { minX, maxX, minY, maxY } };
}

function nearestResize(
  cell: ReturnType<typeof spriteCell>,
  cellSize: number,
  shirt: readonly number[] | null,
  trousers: readonly number[] | null,
): { pixels: Buffer; mask: Buffer } {
  const cropWidth = cell.bounds.maxX - cell.bounds.minX + 1;
  const cropHeight = cell.bounds.maxY - cell.bounds.minY + 1;
  const fit = Math.min(
    (cellSize * FIGURE_WIDTH) / cropWidth,
    (cellSize * FIGURE_HEIGHT) / cropHeight,
  );
  const width = Math.max(1, Math.round(cropWidth * fit));
  const height = Math.max(1, Math.round(cropHeight * fit));
  const xOffset = Math.floor((cellSize - width) / 2);
  const yOffset = cellSize - height - 1;
  const pixels = Buffer.alloc(cellSize * cellSize * 4);
  const mask = Buffer.alloc(cellSize * cellSize * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = cell.bounds.minY + Math.floor((y * cropHeight) / height);
    for (let x = 0; x < width; x++) {
      const sourceX = cell.bounds.minX + Math.floor((x * cropWidth) / width);
      const from = (sourceY * cell.width + sourceX) * 4;
      const to = ((y + yOffset) * cellSize + x + xOffset) * 4;
      pixels[to] = cell.pixels[from]!;
      pixels[to + 1] = cell.pixels[from + 1]!;
      pixels[to + 2] = cell.pixels[from + 2]!;
      pixels[to + 3] = cell.pixels[from + 3]!;
      const shirtValue = cell.mask[from]!;
      const trouserValue = cell.mask[from + 1]!;
      if (shirtValue && shirt) {
        const shade = shirtValue / 174;
        pixels[to] = Math.min(255, Math.round(shirt[0]! * shade));
        pixels[to + 1] = Math.min(255, Math.round(shirt[1]! * shade));
        pixels[to + 2] = Math.min(255, Math.round(shirt[2]! * shade));
      } else if (trouserValue && trousers) {
        const shade = trouserValue / 174;
        pixels[to] = Math.min(255, Math.round(trousers[0]! * shade));
        pixels[to + 1] = Math.min(255, Math.round(trousers[1]! * shade));
        pixels[to + 2] = Math.min(255, Math.round(trousers[2]! * shade));
      }
      if (shirtValue || trouserValue) {
        mask[to] = shirtValue;
        mask[to + 1] = trouserValue;
        mask[to + 3] = 255;
      }
    }
  }
  return { pixels, mask };
}

function metadata(name: string, width: number, height: number, frames: unknown[]) {
  const firstFrame = frames[0] as { height: number; width: number } | undefined;
  return {
    name,
    image: { width, height },
    anchor: { x: Math.floor((firstFrame?.width ?? 0) / 2), y: firstFrame?.height ?? 0 },
    footprint: { width: 1, height: 1 },
    frames,
  };
}

export function processSpriteSheet(
  inputPath: string,
  outputPath: string,
  name: string,
  columns: number,
  rows: number,
  cellSize: number,
  paletteVariants = 1,
  maskOutputPath?: string,
): void {
  const source = decodePng(readFileSync(inputPath));
  if (columns !== 4 || rows !== 4)
    throw new Error('Current sprite prompts use a four by four source grid');
  if (paletteVariants !== 1 && name !== 'guest-walk')
    throw new Error('Palette variants are currently defined only for guest-walk');
  const outColumns = paletteVariants === 1 ? columns : columns * rows;
  const outRows = paletteVariants === 1 ? rows : paletteVariants;
  const output = {
    width: outColumns * cellSize,
    height: outRows * cellSize,
    pixels: Buffer.alloc(outColumns * outRows * cellSize * cellSize * 4),
  };
  const maskImage = {
    width: columns * cellSize,
    height: rows * cellSize,
    pixels: Buffer.alloc(columns * rows * cellSize * cellSize * 4),
  };
  const frames: Array<Record<string, unknown>> = [];
  const maskFrames: Array<Record<string, unknown>> = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = spriteCell(source, column, row, columns, rows);
      const base = nearestResize(cell, cellSize, null, null);
      const maskColumn = column * cellSize;
      const maskRow = row * cellSize;
      for (let y = 0; y < cellSize; y++) {
        const from = y * cellSize * 4;
        const to = ((maskRow + y) * maskImage.width + maskColumn) * 4;
        base.mask.copy(maskImage.pixels, to, from, from + cellSize * 4);
      }
      const direction = DIRECTIONS[column]!;
      const walkingFrame = row;
      const maskIndex = row * columns + column;
      maskFrames.push({
        x: maskColumn,
        y: maskRow,
        width: cellSize,
        height: cellSize,
        index: maskIndex,
        direction,
        walkingFrame,
      });

      for (let tint = 0; tint < paletteVariants; tint++) {
        const variant =
          paletteVariants === 1
            ? base
            : nearestResize(cell, cellSize, GUEST_SHIRTS[tint]!, GUEST_TROUSERS[tint]!);
        const outputColumn = paletteVariants === 1 ? column : column * rows + walkingFrame;
        const outputRow = paletteVariants === 1 ? row : tint;
        for (let y = 0; y < cellSize; y++) {
          const from = y * cellSize * 4;
          const to = ((outputRow * cellSize + y) * output.width + outputColumn * cellSize) * 4;
          variant.pixels.copy(output.pixels, to, from, from + cellSize * 4);
        }
        const index = outputRow * outColumns + outputColumn;
        frames.push({
          x: outputColumn * cellSize,
          y: outputRow * cellSize,
          width: cellSize,
          height: cellSize,
          index,
          direction,
          walkingFrame,
          tint,
        });
      }
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, encodePng(output));
  const metadataPath = join(dirname(outputPath), `${parse(outputPath).name}.json`);
  writeFileSync(
    metadataPath,
    `${JSON.stringify(metadata(name, output.width, output.height, frames), null, 2)}\n`,
  );
  if (paletteVariants > 1) {
    const maskPath =
      maskOutputPath ?? join(dirname(outputPath), `${parse(outputPath).name}-mask.png`);
    mkdirSync(dirname(maskPath), { recursive: true });
    writeFileSync(maskPath, encodePng(maskImage));
    writeFileSync(
      join(dirname(maskPath), `${parse(maskPath).name}.json`),
      `${JSON.stringify(metadata(`${name}-mask`, maskImage.width, maskImage.height, maskFrames), null, 2)}\n`,
    );
  }
}

function parseArgs(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || value === undefined)
      throw new Error('Expected --option value pairs');
    options.set(key.slice(2), value);
  }
  return options;
}

if (process.argv[1] && basename(process.argv[1]) === 'process-sprites.ts') {
  const options = parseArgs(process.argv.slice(2));
  const input = options.get('input');
  const output = options.get('output');
  const name = options.get('name');
  if (!input || !output || !name)
    throw new Error('Usage: process-sprites.ts --input FILE --output FILE --name NAME');
  processSpriteSheet(
    input,
    output,
    name,
    Number(options.get('columns') ?? 4),
    Number(options.get('rows') ?? 4),
    Number(options.get('cell-size') ?? 64),
    Number(options.get('palette-variants') ?? (name === 'guest-walk' ? 8 : 1)),
    options.get('mask-output'),
  );
}
