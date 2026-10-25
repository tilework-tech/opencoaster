import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PIECES } from '../../src/sim/track/catalog';
import type { Rotation } from '../../src/render/projection';
import { STEEL_SHOWCASE } from '../../e2e/support/steel-showcase';
import { transportSprites, waterTrackSprites } from './generate';
import { coasterSprites } from './models/coaster/sprites';
import { PALETTE } from './palette';
import { TRANSPARENT } from './raster';
import { chain, coasterKind, composeCells, neighbours } from './track-compose';
import type { Canvas, Placement, TrackKind } from './track-compose';

const outputDirectory = new URL('../../docs/art/', import.meta.url).pathname;
const BACKGROUND = [60, 110, 40] as const;
const ROTATIONS = [0, 1, 2, 3] as const;

/** Crops a canvas to its covered pixels plus a margin and returns RGBA. */
function toImage(canvas: Canvas, margin = 4): { width: number; height: number; data: Buffer } {
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (canvas.pixels[y * canvas.width + x] !== TRANSPARENT) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  const width = maxX - minX + 1 + margin * 2;
  const height = maxY - minY + 1 + margin * 2;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = BACKGROUND[0];
    data[i * 4 + 1] = BACKGROUND[1];
    data[i * 4 + 2] = BACKGROUND[2];
    data[i * 4 + 3] = 255;
  }
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const p = canvas.pixels[y * canvas.width + x];
      if (p === TRANSPARENT) continue;
      const at = ((y - minY + margin) * width + x - minX + margin) * 4;
      [data[at], data[at + 1], data[at + 2]] = PALETTE[p];
    }
  return { width, height, data };
}

type Tile = ReturnType<typeof toImage>;

/** Lays tiles out in a grid of `columns`, every cell sized to the largest tile. */
async function grid(tiles: Tile[], columns: number, scale: number): Promise<Buffer> {
  const cellWidth = Math.max(...tiles.map((t) => t.width));
  const cellHeight = Math.max(...tiles.map((t) => t.height));
  const rows = Math.ceil(tiles.length / columns);
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const sheet = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    sheet[i * 4] = BACKGROUND[0];
    sheet[i * 4 + 1] = BACKGROUND[1];
    sheet[i * 4 + 2] = BACKGROUND[2];
    sheet[i * 4 + 3] = 255;
  }
  tiles.forEach((tile, index) => {
    const ox = (index % columns) * cellWidth + Math.floor((cellWidth - tile.width) / 2);
    const oy =
      Math.floor(index / columns) * cellHeight + Math.floor((cellHeight - tile.height) / 2);
    for (let y = 0; y < tile.height; y++)
      tile.data.copy(
        sheet,
        ((oy + y) * width + ox) * 4,
        y * tile.width * 4,
        (y + 1) * tile.width * 4,
      );
  });
  return sharp(sheet, { raw: { width, height, channels: 4 } })
    .resize({ width: width * scale, height: height * scale, kernel: 'nearest' })
    .png()
    .toBuffer();
}

/** The steel showcase circuit as the renderer draws it, one tile per camera rotation. */
export async function circuitSheet(kind: TrackKind, lookup: Map<string, never>): Promise<Buffer> {
  const { buildCircuit, createCoaster, flatOwnedSim } =
    await import('../../src/sim/rides/coaster-fixtures');
  const { RideType } = await import('../../src/sim/rides/ride-types');
  const sim = flatOwnedSim(1);
  const ride = createCoaster(sim, RideType.SteelLoopingCoaster, 20, 10);
  buildCircuit(sim, ride, STEEL_SHOWCASE);
  const columns = sim.world.track.pieces.cols;
  const placed: Placement[] = [];
  for (let slot = 0; slot < sim.world.track.pieces.count; slot++)
    placed.push({
      piece: PIECES[columns.pieceType[slot]],
      x: columns.x[slot],
      y: columns.y[slot],
      z: columns.z[slot],
      dir: columns.dir[slot],
    });
  const tiles = ROTATIONS.map((rotation) => toImage(composeCells(kind, placed, rotation, lookup)));
  return grid(tiles, 2, 1);
}

/** Every piece of the kind between its matching straights, in each camera rotation. */
async function piecesSheet(kind: TrackKind, lookup: Map<string, never>): Promise<Buffer> {
  const tiles: Tile[] = [];
  for (const piece of kind.pieces) {
    const { before, after } = neighbours(piece, kind.pieces);
    const names = [before?.name, piece.name, after?.name].filter((n): n is string => !!n);
    for (const rotation of ROTATIONS as readonly Rotation[])
      tiles.push(
        toImage(
          composeCells(kind, chain(names, { x: 20, y: 20, z: 10, dir: 0 }), rotation, lookup),
          2,
        ),
      );
  }
  return grid(tiles, 4, 1);
}

async function main(): Promise<void> {
  const lookup = new Map(
    [...coasterSprites(), ...waterTrackSprites(), ...transportSprites()].map((s) => [s.key, s]),
  ) as Map<string, never>;
  const steel = coasterKind('steel', 'steel');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'track-circuit-steel.png'),
    await circuitSheet(steel, lookup),
  );
  await writeFile(
    join(outputDirectory, 'track-pieces-steel.png'),
    await piecesSheet(steel, lookup),
  );
}

await main();
