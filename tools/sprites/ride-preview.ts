import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { rotateTile } from '../../src/sim/track/construction';
import { alignFrames, toRgba } from './output';
import { flatRideCellSprites } from './generate';
import { RIDE_MODELS } from './models/ride-catalog';
import { TILE_H, TILE_W, TRANSPARENT } from './raster';
import { rotatePoint } from './mesh';

/**
 * Review sheet: the slices of flat rides reassembled on a tile grid the way the renderers place
 * them, for every camera rotation (columns) and ride orientation (rows).
 *
 * usage: tsx tools/sprites/ride-preview.ts <out.png> <scale> <frame> <dirs, e.g. 0123> <ride name>...
 */
async function main(): Promise<void> {
  const [outPath, scaleArg, frameArg, dirsArg, ...names] = process.argv.slice(2);
  const scale = Number(scaleArg);
  const frame = Number(frameArg);
  const dirs = [...dirsArg].map(Number);
  const rides = Object.values(RIDE_CATALOG).filter((def) =>
    names.some((name) => def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === name),
  );
  const cellW = 400;
  const cellH = 340;
  const sheetW = cellW * 4;
  const sheetH = cellH * dirs.length * rides.length;
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  for (let i = 0; i < sheetW * sheetH; i++) {
    sheet[i * 4] = 52;
    sheet[i * 4 + 1] = 100;
    sheet[i * 4 + 2] = 58;
    sheet[i * 4 + 3] = 255;
  }
  const put = (rgba: Buffer, w: number, h: number, ox: number, oy: number): void => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const px = ox + x;
        const py = oy + y;
        if (rgba[s + 3] === 0 || px < 0 || py < 0 || px >= sheetW || py >= sheetH) continue;
        const d = (py * sheetW + px) * 4;
        sheet[d] = rgba[s];
        sheet[d + 1] = rgba[s + 1];
        sheet[d + 2] = rgba[s + 2];
      }
  };
  let row = 0;
  for (const ride of rides) {
    const model = RIDE_MODELS.find(
      (m) => m.key === `rides/${ride.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    )!;
    const slices = flatRideCellSprites(ride, model);
    for (const dir of dirs) {
      for (let cam = 0; cam < 4; cam++) {
        const view = (cam + dir) & 3;
        const originX = cam * cellW + cellW / 2;
        const originY = row * cellH + cellH - 90;
        const tiles = ride.footprint.map(([i, j], index) => {
          const [dx, dy] = rotateTile(i, j, dir);
          const [rx, ry] = rotatePoint([dx, dy, 0], cam);
          return { index, rx, ry };
        });
        // ground diamonds under the footprint
        for (const { rx, ry } of tiles) {
          const cx = originX + (rx - ry) * (TILE_W / 2);
          const cy = originY + (rx + ry) * (TILE_H / 2);
          const w = TILE_W;
          const h = TILE_H;
          const ground = Buffer.alloc(w * h * 4);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              if (Math.abs(x + 0.5 - w / 2) / (w / 2) + Math.abs(y + 0.5 - h / 2) / (h / 2) > 1)
                continue;
              const o = (y * w + x) * 4;
              ground[o] = 150;
              ground[o + 1] = 140;
              ground[o + 2] = 110;
              ground[o + 3] = 255;
            }
          put(ground, w, h, Math.round(cx - w / 2), Math.round(cy - h / 2));
        }
        tiles.sort((a, b) => a.rx + a.ry - (b.rx + b.ry));
        for (const { index, rx, ry } of tiles) {
          const def = slices.find((s) => s.key.endsWith(`/view-${view}/cell-${index}`));
          if (!def) continue;
          const aligned = alignFrames(def.frames);
          const f = aligned[Math.min(frame, aligned.length - 1)];
          const cx = originX + (rx - ry) * (TILE_W / 2);
          const cy = originY + (rx + ry) * (TILE_H / 2);
          put(
            toRgba({ ...f, pixels: f.pixels.map((p) => p) }),
            f.width,
            f.height,
            Math.round(cx - f.anchor.x),
            Math.round(cy - f.anchor.y),
          );
        }
      }
      row++;
    }
  }
  void TRANSPARENT;
  const png = await sharp(sheet, { raw: { width: sheetW, height: sheetH, channels: 4 } })
    .resize({ width: sheetW * scale, height: sheetH * scale, kernel: 'nearest' })
    .png()
    .toBuffer();
  await writeFile(outPath, png);
  console.log(`${rides.length} rides, ${row} rows`);
}

await main();
