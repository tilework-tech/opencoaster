import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ICON_NAMES } from '../../src/ui/icons';
import { box, beam, cylinder, material, polygon as meshPolygon } from './mesh';
import type { Mesh, Vec3 } from './mesh';
import { renderMesh, TRANSPARENT } from './raster';
import type { Sprite } from './raster';
import { PALETTE, ramp } from './palette';
import { palmTreeMesh } from './models/trees';
import { drawIcon } from './ui-icon-art';
import { parkEntranceMesh } from './models/park-entrance';

const outline = ramp('outline')[0];
const colors = {
  steel: ramp('steel'),
  blue: ramp('blue'),
  green: ramp('green'),
  grass: ramp('grass'),
  red: ramp('red'),
  yellow: ramp('yellow'),
  orange: ramp('orange'),
  wood: ramp('wood'),
  pink: ramp('pink'),
  foam: ramp('foam'),
  stone: ramp('stone'),
  white: ramp('white'),
  purple: ramp('purple'),
  dirt: ramp('dirt'),
  skin: ramp('skin'),
  timber: ramp('timber'),
};

function spriteCanvas(): Sprite {
  return {
    width: 24,
    height: 24,
    anchor: { x: 12, y: 12 },
    pixels: new Uint8Array(24 * 24).fill(TRANSPARENT),
  };
}

function pixel(sprite: Sprite, x: number, y: number, color: number): void {
  if (x >= 0 && y >= 0 && x < 24 && y < 24) sprite.pixels[y * 24 + x] = color;
}

function rect(
  sprite: Sprite,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): void {
  for (let py = y; py < y + height; py++)
    for (let px = x; px < x + width; px++) pixel(sprite, px, py, color);
}

function line(
  sprite: Sprite,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
  size = 1,
): void {
  const dx = Math.abs(x1 - x0),
    sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0),
    sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    rect(sprite, x0, y0, size, size, color);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x0 += sx;
    }
    if (twice <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function fillPolygon(
  sprite: Sprite,
  points: readonly (readonly [number, number])[],
  color: number,
): void {
  const minY = Math.max(0, Math.min(...points.map((p) => p[1])));
  const maxY = Math.min(23, Math.max(...points.map((p) => p[1])));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i],
        [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y))
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) pixel(sprite, x, y, color);
  }
}

function polygon(
  sprite: Sprite,
  points: readonly (readonly [number, number])[],
  color: number,
): void {
  fillPolygon(sprite, points, color);
  for (let i = 0; i < points.length; i++)
    line(sprite, ...points[i], ...points[(i + 1) % points.length], outline, 2);
}

function iconShapes(name: string): Sprite {
  const s = spriteCanvas();
  const set = (
    x: number,
    y: number,
    w: number,
    h: number,
    family: keyof typeof colors,
    shade = 3,
  ) => rect(s, x, y, w, h, colors[family][shade]);
  const framed = (x: number, y: number, w: number, h: number, family: keyof typeof colors) => {
    rect(s, x - 1, y - 1, w + 2, h + 2, outline);
    set(x, y, w, h, family, 2);
    rect(s, x, y, w, 2, colors[family][4]);
    rect(s, x, y + h - 2, 2, h > 3 ? 2 : 1, colors[family][1]);
  };
  const post = (x: number, y: number, family: keyof typeof colors, h = 12) => {
    framed(x, y, 4, h, family);
    rect(s, x + 1, y + 1, 1, h - 2, colors[family][4]);
  };

  switch (name) {
    case 'pause':
      framed(5, 5, 5, 14, 'red');
      framed(14, 5, 5, 14, 'red');
      break;
    case 'play':
      polygon(
        s,
        [
          [6, 4],
          [19, 12],
          [6, 20],
        ],
        colors.green[3],
      );
      set(8, 7, 2, 9, 'green', 4);
      break;
    case 'speed':
      framed(4, 8, 6, 8, 'yellow');
      framed(13, 8, 7, 8, 'yellow');
      polygon(
        s,
        [
          [6, 9],
          [9, 12],
          [6, 15],
        ],
        colors.orange[2],
      );
      polygon(
        s,
        [
          [15, 9],
          [18, 12],
          [15, 15],
        ],
        colors.orange[2],
      );
      break;
    case 'fastForward':
    case 'fastForwardDouble':
    case 'fastForwardTriple': {
      const count = name === 'fastForward' ? 1 : name === 'fastForwardDouble' ? 2 : 3;
      const starts = count === 1 ? [5] : count === 2 ? [3, 11] : [1, 8, 15];
      const end = count === 1 ? 17 : 20;
      const top = count === 1 ? 3 : 4;
      const bottom = count === 1 ? 21 : 20;
      for (const x of starts)
        polygon(
          s,
          [
            [x, top],
            [count === 1 ? end : x + 7, 12],
            [x, bottom],
          ],
          colors.yellow[3],
        );
      break;
    }
    case 'saveLoad':
      framed(4, 3, 16, 18, 'blue');
      rect(s, 7, 5, 10, 6, colors.steel[2]);
      rect(s, 8, 14, 8, 5, colors.wood[3]);
      rect(s, 10, 15, 4, 4, colors.yellow[3]);
      rect(s, 14, 5, 2, 4, colors.white[4]);
      break;
    case 'close':
      line(s, 6, 6, 17, 17, outline, 5);
      line(s, 17, 6, 6, 17, outline, 5);
      line(s, 6, 6, 17, 17, colors.red[3], 2);
      line(s, 17, 6, 6, 17, colors.red[3], 2);
      break;
    case 'zoomIn':
    case 'zoomOut':
      for (let y = 4; y <= 14; y++)
        for (let x = 4; x <= 14; x++)
          if ((x - 9) ** 2 + (y - 9) ** 2 <= 25)
            pixel(s, x, y, (x - 9) ** 2 + (y - 9) ** 2 >= 16 ? outline : colors.blue[3]);
      line(s, 13, 13, 20, 20, outline, 4);
      line(s, 13, 13, 20, 20, colors.wood[3], 2);
      line(s, 6, 9, 12, 9, colors.white[4], 2);
      if (name === 'zoomIn') line(s, 9, 6, 9, 12, colors.white[4], 2);
      break;
    case 'rotateLeft':
    case 'rotateRight':
      line(s, 7, 5, 16, 5, outline, 4);
      line(s, 6, 6, 4, 12, outline, 4);
      line(s, 4, 12, 7, 18, outline, 4);
      line(s, 7, 18, 14, 20, outline, 4);
      line(s, 14, 20, 19, 16, outline, 4);
      line(s, 7, 5, 16, 5, colors.yellow[3], 2);
      line(s, 6, 7, 5, 12, colors.yellow[3], 2);
      line(s, 5, 12, 8, 17, colors.yellow[3], 2);
      line(s, 8, 17, 14, 18, colors.yellow[3], 2);
      line(s, 14, 18, 17, 16, colors.yellow[3], 2);
      if (name === 'rotateRight')
        polygon(
          s,
          [
            [15, 2],
            [23, 5],
            [16, 10],
          ],
          colors.yellow[3],
        );
      else
        polygon(
          s,
          [
            [9, 2],
            [1, 5],
            [8, 10],
          ],
          colors.yellow[3],
        );
      break;
    case 'options':
      for (let y = 2; y <= 21; y++)
        for (let x = 2; x <= 21; x++) {
          const radius = (x - 12) ** 2 + (y - 12) ** 2;
          if (radius >= 25 && radius <= 81)
            pixel(s, x, y, radius >= 65 ? outline : colors.steel[3]);
        }
      for (const [x, y, w, h] of [
        [9, 2, 6, 4],
        [9, 18, 6, 4],
        [2, 9, 4, 6],
        [18, 9, 4, 6],
        [4, 4, 4, 4],
        [16, 4, 4, 4],
        [4, 16, 4, 4],
        [16, 16, 4, 4],
      ]) {
        rect(s, x, y, w, h, outline);
        rect(s, x + 1, y + 1, w - 2, h - 2, colors.steel[3]);
      }
      rect(s, 8, 8, 8, 8, outline);
      rect(s, 10, 10, 4, 4, colors.yellow[3]);
      break;
    case 'sound':
      polygon(
        s,
        [
          [3, 9],
          [8, 9],
          [16, 4],
          [16, 20],
          [8, 15],
          [3, 15],
        ],
        colors.blue[3],
      );
      line(s, 18, 8, 21, 12, colors.yellow[3], 2);
      line(s, 21, 12, 18, 16, colors.yellow[3], 2);
      break;
    case 'map':
      polygon(
        s,
        [
          [3, 6],
          [9, 4],
          [15, 6],
          [21, 4],
          [21, 18],
          [15, 20],
          [9, 18],
          [3, 20],
        ],
        colors.green[2],
      );
      line(s, 9, 4, 9, 18, outline, 2);
      line(s, 15, 6, 15, 20, outline, 2);
      set(5, 9, 2, 2, 'yellow');
      set(17, 13, 2, 2, 'red');
      break;
    case 'menu':
      for (const y of [6, 11, 16]) {
        framed(4, y, 16, 3, 'wood');
        rect(s, 6, y + 1, 12, 1, colors.timber[4]);
      }
      break;
    case 'news':
      framed(5, 4, 14, 16, 'white');
      rect(s, 7, 6, 10, 4, colors.blue[3]);
      rect(s, 7, 12, 10, 1, colors.steel[1]);
      rect(s, 7, 15, 8, 1, colors.steel[1]);
      rect(s, 7, 18, 6, 1, colors.steel[1]);
      break;
    case 'view':
      polygon(
        s,
        [
          [3, 12],
          [7, 7],
          [12, 5],
          [17, 7],
          [21, 12],
          [17, 17],
          [12, 19],
          [7, 17],
        ],
        colors.white[4],
      );
      rect(s, 8, 8, 8, 8, outline);
      rect(s, 9, 9, 6, 6, colors.blue[3]);
      rect(s, 10, 10, 4, 4, colors.white[4]);
      rect(s, 11, 11, 2, 2, outline);
      break;
    case 'land':
      polygon(
        s,
        [
          [2, 15],
          [7, 12],
          [11, 6],
          [16, 10],
          [21, 7],
          [22, 15],
        ],
        colors.grass[3],
      );
      polygon(
        s,
        [
          [2, 16],
          [22, 16],
          [22, 20],
          [2, 20],
        ],
        colors.dirt[3],
      );
      line(s, 3, 17, 21, 17, colors.dirt[1], 2);
      line(s, 4, 19, 19, 19, colors.dirt[4], 1);
      line(s, 16, 12, 16, 17, colors.white[4], 2);
      polygon(
        s,
        [
          [13, 13],
          [16, 10],
          [19, 13],
        ],
        colors.white[4],
      );
      polygon(
        s,
        [
          [13, 17],
          [16, 20],
          [19, 17],
        ],
        colors.white[4],
      );
      break;
    case 'water':
      polygon(
        s,
        [
          [2, 14],
          [7, 11],
          [11, 13],
          [16, 10],
          [22, 13],
          [22, 20],
          [2, 20],
        ],
        colors.blue[2],
      );
      line(s, 3, 16, 8, 16, colors.blue[4], 2);
      line(s, 11, 15, 17, 15, colors.blue[4], 2);
      line(s, 5, 19, 12, 19, colors.blue[1], 1);
      polygon(
        s,
        [
          [7, 10],
          [9, 6],
          [11, 3],
          [13, 7],
          [15, 10],
          [11, 12],
        ],
        colors.foam[4],
      );
      line(s, 10, 7, 11, 5, colors.white[4], 1);
      break;
    case 'scenery':
      post(10, 12, 'wood', 8);
      polygon(
        s,
        [
          [10, 2],
          [17, 9],
          [14, 9],
          [20, 14],
          [4, 14],
          [8, 9],
          [5, 9],
        ],
        colors.green[3],
      );
      set(9, 5, 4, 2, 'green', 4);
      polygon(
        s,
        [
          [15, 17],
          [18, 14],
          [21, 17],
          [20, 20],
          [15, 20],
        ],
        colors.green[3],
      );
      line(s, 16, 17, 19, 17, colors.green[4], 1);
      break;
    case 'flower':
      post(10, 12, 'wood', 8);
      polygon(
        s,
        [
          [12, 3],
          [17, 9],
          [14, 9],
          [20, 14],
          [4, 14],
          [9, 9],
          [6, 9],
        ],
        colors.green[3],
      );
      set(10, 5, 3, 2, 'green', 4);
      break;
    case 'paths':
      fillPolygon(
        s,
        [
          [2, 10],
          [12, 18],
          [12, 20],
          [2, 12],
        ],
        colors.stone[1],
      );
      fillPolygon(
        s,
        [
          [21, 10],
          [12, 18],
          [12, 20],
          [21, 12],
        ],
        colors.stone[0],
      );
      fillPolygon(
        s,
        [
          [12, 2],
          [21, 10],
          [12, 18],
          [2, 10],
        ],
        colors.stone[4],
      );
      fillPolygon(
        s,
        [
          [12, 4],
          [19, 10],
          [12, 16],
          [5, 10],
        ],
        colors.stone[2],
      );
      line(s, 8, 7, 16, 13, colors.stone[1], 1);
      line(s, 16, 7, 8, 13, colors.stone[1], 1);
      line(s, 2, 10, 12, 2, outline, 1);
      line(s, 12, 2, 21, 10, outline, 1);
      line(s, 21, 10, 21, 12, outline, 1);
      line(s, 21, 12, 12, 20, outline, 1);
      line(s, 12, 20, 2, 12, outline, 1);
      line(s, 2, 12, 2, 10, outline, 1);
      break;
    case 'straight':
      for (const y of [7, 11, 15, 19]) line(s, 6, y, 18, y, colors.wood[2], 3);
      line(s, 8, 5, 8, 20, outline, 3);
      line(s, 16, 5, 16, 20, outline, 3);
      line(s, 8, 6, 8, 19, colors.red[3], 1);
      line(s, 16, 6, 16, 19, colors.red[3], 1);
      break;
    case 'station':
      polygon(
        s,
        [
          [3, 9],
          [12, 4],
          [21, 9],
        ],
        colors.red[3],
      );
      framed(4, 9, 16, 2, 'wood');
      post(5, 11, 'wood', 8);
      post(17, 11, 'wood', 8);
      rect(s, 8, 13, 8, 6, colors.stone[2]);
      rect(s, 10, 14, 4, 5, colors.blue[2]);
      break;
    case 'rides':
    case 'wheel':
    case 'newRide': {
      const center = name === 'newRide' ? 10 : 12;
      const radius = name === 'newRide' ? 7 : 8;
      for (let y = center - radius; y <= center + radius; y++)
        for (let x = center - radius; x <= center + radius; x++) {
          const d = (x - center) ** 2 + (y - center) ** 2;
          if (d <= radius ** 2 && d >= (radius - 2) ** 2) pixel(s, x, y, outline);
          else if (d < (radius - 2) ** 2 && d >= (radius - 3) ** 2) pixel(s, x, y, colors.red[3]);
        }
      for (const [x, y] of [
        [center, center - radius],
        [center + radius, center],
        [center, center + radius],
        [center - radius, center],
      ]) {
        line(s, center, center, x, y, colors.steel[2], 1);
        rect(s, x - 1, y - 1, 3, 3, outline);
        rect(s, x, y, 1, 1, colors.yellow[3]);
      }
      rect(s, center - 2, center - 2, 5, 5, colors.steel[2]);
      rect(s, center - 1, center - 1, 3, 3, colors.yellow[3]);
      line(s, center, center + radius, center - 4, 21, outline, 2);
      line(s, center, center + radius, center + 4, 21, outline, 2);
      if (name === 'newRide') {
        rect(s, 16, 2, 7, 7, outline);
        rect(s, 17, 3, 5, 5, colors.green[3]);
        rect(s, 19, 4, 1, 3, colors.white[4]);
        rect(s, 18, 5, 3, 1, colors.white[4]);
      }
      break;
    }
    case 'carousel':
      polygon(
        s,
        [
          [4, 9],
          [12, 4],
          [20, 9],
        ],
        colors.yellow[3],
      );
      line(s, 4, 9, 20, 9, outline, 2);
      framed(5, 10, 14, 2, 'red');
      post(6, 12, 'wood', 5);
      post(11, 12, 'blue', 5);
      post(16, 12, 'green', 5);
      rect(s, 4, 18, 16, 2, outline);
      break;
    case 'coaster':
      line(s, 2, 17, 7, 7, outline, 3);
      line(s, 7, 7, 12, 17, outline, 3);
      line(s, 12, 17, 17, 9, outline, 3);
      line(s, 17, 9, 22, 13, outline, 3);
      line(s, 3, 16, 7, 8, colors.red[3], 1);
      line(s, 7, 8, 12, 16, colors.red[3], 1);
      line(s, 12, 16, 17, 10, colors.red[3], 1);
      line(s, 17, 10, 21, 13, colors.red[3], 1);
      post(4, 15, 'steel', 6);
      post(13, 14, 'steel', 6);
      rect(s, 7, 4, 5, 3, outline);
      rect(s, 8, 3, 3, 2, colors.red[3]);
      rect(s, 8, 5, 3, 1, colors.yellow[3]);
      rect(s, 7, 7, 2, 2, outline);
      rect(s, 10, 7, 2, 2, outline);
      break;
    case 'twist':
      polygon(
        s,
        [
          [3, 14],
          [11, 10],
          [21, 14],
          [13, 19],
        ],
        colors.red[3],
      );
      line(s, 4, 14, 13, 19, outline, 2);
      line(s, 13, 19, 21, 14, outline, 2);
      line(s, 11, 11, 12, 5, outline, 2);
      line(s, 12, 5, 15, 3, outline, 2);
      line(s, 13, 11, 14, 6, colors.steel[2], 1);
      for (const [x, y] of [
        [5, 13],
        [11, 10],
        [17, 12],
        [13, 16],
      ]) {
        rect(s, x - 2, y - 2, 4, 3, outline);
        rect(s, x - 1, y - 1, 2, 1, colors.yellow[3]);
      }
      rect(s, 8, 14, 3, 2, colors.blue[3]);
      break;
    case 'loop':
      line(s, 6, 19, 6, 12, outline, 2);
      line(s, 6, 12, 7, 7, outline, 2);
      line(s, 7, 7, 11, 4, outline, 2);
      line(s, 11, 4, 16, 5, outline, 2);
      line(s, 16, 5, 19, 10, outline, 2);
      line(s, 19, 10, 18, 16, outline, 2);
      line(s, 18, 16, 13, 19, outline, 2);
      line(s, 7, 19, 7, 12, colors.red[3], 1);
      line(s, 7, 12, 8, 7, colors.red[3], 1);
      line(s, 8, 7, 12, 5, colors.red[3], 1);
      line(s, 12, 5, 16, 6, colors.red[3], 1);
      line(s, 16, 6, 18, 10, colors.red[3], 1);
      post(6, 18, 'steel', 4);
      break;
    case 'sBend':
      line(s, 5, 18, 8, 14, outline, 3);
      line(s, 8, 14, 14, 11, outline, 3);
      line(s, 14, 11, 18, 6, outline, 3);
      line(s, 5, 17, 8, 13, colors.red[3], 1);
      line(s, 8, 13, 14, 10, colors.red[3], 1);
      line(s, 14, 10, 18, 5, colors.red[3], 1);
      post(5, 16, 'steel', 4);
      post(17, 12, 'steel', 8);
      break;
    case 'corkscrew':
    case 'helix':
      for (let x = 5; x <= 18; x += 4) {
        const y = name === 'helix' ? (x % 8 ? 7 : 14) : x % 8 ? 14 : 7;
        rect(s, x, y, 4, 3, outline);
        rect(s, x + 1, y + 1, 2, 1, colors.red[3]);
      }
      post(5, 15, 'steel', 5);
      post(17, 14, 'steel', 6);
      break;
    case 'staff':
      rect(s, 3, 18, 18, 3, outline);
      rect(s, 4, 17, 16, 2, colors.steel[2]);
      rect(s, 9, 7, 7, 7, outline);
      rect(s, 10, 8, 5, 5, colors.skin[3]);
      rect(s, 9, 6, 7, 2, outline);
      rect(s, 8, 4, 9, 2, outline);
      rect(s, 10, 3, 6, 2, colors.blue[3]);
      rect(s, 7, 13, 12, 6, outline);
      rect(s, 8, 14, 10, 4, colors.blue[3]);
      rect(s, 8, 14, 3, 1, colors.blue[4]);
      rect(s, 12, 14, 1, 3, colors.yellow[3]);
      rect(s, 5, 13, 2, 5, outline);
      rect(s, 4, 16, 3, 2, colors.wood[3]);
      rect(s, 19, 12, 2, 7, outline);
      rect(s, 20, 11, 1, 3, colors.yellow[3]);
      break;
    case 'guests':
      for (const [x, shirt] of [
        [6, 'red'],
        [15, 'blue'],
      ] as const) {
        rect(s, x, 5, 6, 6, outline);
        rect(s, x + 1, 6, 4, 4, colors.skin[3]);
        rect(s, x, 4, 6, 2, outline);
        rect(s, x + 1, 3, 4, 2, colors.yellow[3]);
        rect(s, x - 1, 11, 8, 8, outline);
        rect(s, x, 12, 6, 6, colors[shirt][3]);
        rect(s, x + 1, 12, 2, 2, colors[shirt][4]);
        rect(s, x + 1, 19, 2, 2, outline);
        rect(s, x + 4, 19, 2, 2, outline);
      }
      break;
    case 'park':
      polygon(
        s,
        [
          [2, 20],
          [2, 8],
          [8, 8],
          [8, 20],
        ],
        colors.wood[2],
      );
      polygon(
        s,
        [
          [16, 20],
          [16, 8],
          [22, 8],
          [22, 20],
        ],
        colors.wood[2],
      );
      polygon(
        s,
        [
          [2, 8],
          [12, 2],
          [22, 8],
        ],
        colors.red[3],
      );
      line(s, 3, 8, 21, 8, colors.yellow[3], 2);
      rect(s, 10, 12, 5, 8, outline);
      rect(s, 11, 13, 3, 7, colors.stone[2]);
      line(s, 18, 2, 18, 8, outline, 1);
      polygon(
        s,
        [
          [19, 2],
          [23, 4],
          [19, 5],
        ],
        colors.yellow[3],
      );
      break;
    case 'entrance':
      rect(s, 3, 5, 5, 17, outline);
      rect(s, 4, 6, 3, 15, colors.stone[2]);
      rect(s, 16, 5, 5, 17, outline);
      rect(s, 17, 6, 3, 15, colors.stone[2]);
      rect(s, 5, 3, 14, 5, outline);
      rect(s, 6, 4, 12, 3, colors.red[3]);
      rect(s, 7, 4, 4, 1, colors.red[4]);
      polygon(
        s,
        [
          [8, 21],
          [12, 17],
          [16, 21],
        ],
        colors.stone[1],
      );
      line(s, 8, 20, 16, 20, colors.white[4], 1);
      break;
    case 'exit':
      framed(4, 7, 16, 13, 'wood');
      framed(7, 4, 10, 4, 'red');
      rect(s, 10, 12, 5, 8, colors.stone[1]);
      rect(s, 6, 10, 2, 3, colors.yellow[3]);
      rect(s, 16, 10, 2, 3, colors.yellow[3]);
      break;
    case 'finances':
      rect(s, 5, 3, 16, 12, outline);
      rect(s, 6, 4, 14, 10, colors.green[3]);
      line(s, 7, 5, 18, 5, colors.green[4], 1);
      rect(s, 2, 9, 20, 12, outline);
      rect(s, 3, 10, 18, 10, colors.green[3]);
      line(s, 4, 11, 20, 11, colors.green[4], 1);
      line(s, 4, 18, 19, 18, colors.green[1], 1);
      rect(s, 8, 12, 8, 6, colors.green[2]);
      rect(s, 11, 12, 4, 1, colors.yellow[4]);
      rect(s, 10, 13, 1, 2, colors.yellow[4]);
      rect(s, 11, 14, 4, 1, colors.yellow[4]);
      rect(s, 14, 15, 1, 2, colors.yellow[4]);
      rect(s, 10, 17, 5, 1, colors.yellow[4]);
      rect(s, 12, 11, 1, 8, colors.yellow[4]);
      break;
    case 'cash':
      for (let y = 4; y <= 19; y++)
        for (let x = 4; x <= 19; x++) {
          const d = (x - 11) ** 2 + (y - 11) ** 2;
          if (d <= 64 && d >= 49) pixel(s, x, y, outline);
          else if (d < 49) pixel(s, x, y, colors.yellow[3]);
        }
      for (let y = 6; y <= 17; y++)
        for (let x = 6; x <= 17; x++) {
          const d = (x - 11) ** 2 + (y - 11) ** 2;
          if (d < 36) pixel(s, x, y, d > 25 ? colors.yellow[4] : colors.yellow[2]);
        }
      line(s, 9, 8, 13, 8, colors.wood[3], 1);
      line(s, 11, 8, 11, 14, colors.wood[3], 1);
      line(s, 9, 11, 13, 11, colors.wood[3], 1);
      line(s, 9, 14, 13, 14, colors.wood[3], 1);
      break;
    case 'research':
      rect(s, 8, 2, 8, 3, outline);
      rect(s, 9, 3, 6, 1, colors.steel[2]);
      rect(s, 9, 5, 2, 6, outline);
      rect(s, 13, 5, 2, 6, outline);
      polygon(
        s,
        [
          [9, 10],
          [15, 10],
          [21, 21],
          [3, 21],
        ],
        colors.purple[2],
      );
      line(s, 5, 17, 19, 17, colors.foam[4], 2);
      line(s, 7, 19, 17, 19, colors.purple[4], 1);
      pixel(s, 5, 8, colors.foam[4]);
      pixel(s, 5, 6, colors.foam[4]);
      pixel(s, 18, 10, colors.yellow[3]);
      pixel(s, 18, 8, colors.yellow[3]);
      pixel(s, 16, 12, colors.white[4]);
      break;
    case 'award':
      polygon(
        s,
        [
          [5, 3],
          [19, 3],
          [18, 10],
          [15, 13],
          [9, 13],
          [6, 10],
        ],
        colors.yellow[3],
      );
      rect(s, 7, 4, 10, 2, colors.yellow[4]);
      line(s, 5, 5, 2, 5, outline, 2);
      line(s, 2, 5, 3, 10, outline, 2);
      line(s, 3, 10, 8, 11, outline, 2);
      line(s, 19, 5, 22, 5, outline, 2);
      line(s, 22, 5, 21, 10, outline, 2);
      line(s, 21, 10, 16, 11, outline, 2);
      rect(s, 10, 13, 4, 4, outline);
      rect(s, 8, 17, 8, 3, outline);
      rect(s, 9, 18, 6, 1, colors.wood[3]);
      break;
    case 'shop':
      framed(4, 8, 16, 11, 'wood');
      framed(3, 5, 18, 5, 'red');
      rect(s, 5, 6, 4, 3, colors.yellow[3]);
      rect(s, 11, 6, 4, 3, colors.white[4]);
      rect(s, 17, 6, 3, 3, colors.yellow[3]);
      framed(10, 12, 5, 7, 'blue');
      break;
    case 'food':
      polygon(
        s,
        [
          [3, 12],
          [3, 9],
          [5, 6],
          [8, 4],
          [15, 4],
          [18, 6],
          [21, 9],
          [21, 12],
        ],
        outline,
      );
      polygon(
        s,
        [
          [5, 10],
          [5, 9],
          [7, 7],
          [9, 6],
          [15, 6],
          [18, 8],
          [19, 10],
        ],
        colors.orange[3],
      );
      line(s, 7, 8, 10, 7, colors.yellow[4], 1);
      pixel(s, 14, 7, colors.white[4]);
      polygon(
        s,
        [
          [4, 12],
          [7, 11],
          [9, 13],
          [12, 11],
          [15, 13],
          [18, 11],
          [20, 12],
          [19, 15],
          [5, 15],
        ],
        colors.green[3],
      );
      rect(s, 5, 14, 15, 4, outline);
      rect(s, 6, 15, 13, 2, colors.wood[3]);
      polygon(
        s,
        [
          [5, 17],
          [19, 17],
          [18, 20],
          [6, 20],
        ],
        outline,
      );
      polygon(
        s,
        [
          [7, 18],
          [17, 18],
          [16, 19],
          [8, 19],
        ],
        colors.yellow[3],
      );
      break;
    case 'drink':
      polygon(
        s,
        [
          [7, 6],
          [17, 6],
          [15, 20],
          [9, 20],
        ],
        colors.red[3],
      );
      rect(s, 8, 8, 8, 2, colors.yellow[3]);
      line(s, 12, 3, 15, 8, outline, 2);
      line(s, 12, 4, 15, 8, colors.white[4], 1);
      rect(s, 10, 12, 4, 2, colors.white[4]);
      break;
    case 'ship':
      line(s, 4, 4, 12, 18, outline, 2);
      line(s, 20, 4, 12, 18, outline, 2);
      line(s, 4, 4, 20, 4, colors.steel[2], 2);
      line(s, 12, 4, 12, 10, outline, 2);
      polygon(
        s,
        [
          [5, 11],
          [19, 11],
          [17, 17],
          [7, 17],
        ],
        outline,
      );
      polygon(
        s,
        [
          [7, 12],
          [17, 12],
          [16, 15],
          [8, 15],
        ],
        colors.red[3],
      );
      line(s, 8, 13, 10, 14, colors.red[4], 1);
      rect(s, 4, 19, 16, 2, colors.stone[2]);
      line(s, 5, 20, 19, 20, colors.white[4], 1);
      break;
    case 'sun':
    case 'cloud':
    case 'rain':
    case 'storm':
      if (name === 'sun') {
        rect(s, 8, 7, 8, 10, colors.yellow[3]);
        rect(s, 6, 9, 12, 6, colors.yellow[3]);
        rect(s, 9, 8, 5, 2, colors.yellow[4]);
        rect(s, 8, 2, 2, 4, colors.orange[3]);
        rect(s, 14, 2, 2, 4, colors.orange[3]);
        rect(s, 2, 8, 4, 2, colors.orange[3]);
        rect(s, 18, 8, 4, 2, colors.orange[3]);
        rect(s, 3, 15, 4, 2, colors.orange[3]);
        rect(s, 17, 15, 4, 2, colors.orange[3]);
        rect(s, 8, 18, 2, 4, colors.orange[3]);
        rect(s, 14, 18, 2, 4, colors.orange[3]);
      } else {
        polygon(
          s,
          [
            [2, 17],
            [2, 13],
            [5, 13],
            [6, 9],
            [9, 7],
            [13, 7],
            [16, 10],
            [20, 10],
            [22, 13],
            [22, 17],
          ],
          outline,
        );
        polygon(
          s,
          [
            [4, 15],
            [4, 13],
            [7, 13],
            [8, 10],
            [10, 9],
            [13, 9],
            [16, 12],
            [19, 12],
            [20, 14],
            [20, 15],
          ],
          colors.white[4],
        );
        rect(s, 8, 10, 3, 2, colors.white[3]);
        rect(s, 13, 10, 2, 2, colors.white[3]);
        if (name !== 'cloud') {
          line(s, 8, 16, 6, 20, colors.blue[3], 2);
          line(s, 14, 16, 12, 20, colors.blue[3], 2);
        }
        if (name === 'storm') line(s, 15, 14, 11, 20, colors.yellow[3], 2);
      }
      break;
    case 'raise':
    case 'lower':
      post(10, 5, 'steel', 14);
      polygon(
        s,
        name === 'raise'
          ? [
              [5, 11],
              [12, 4],
              [19, 11],
              [16, 11],
              [12, 7],
              [8, 11],
            ]
          : [
              [5, 13],
              [8, 13],
              [12, 17],
              [16, 13],
              [19, 13],
              [12, 20],
            ],
        colors.yellow[3],
      );
      break;
    case 'bin':
      framed(6, 8, 12, 12, 'steel');
      framed(4, 5, 16, 3, 'steel');
      rect(s, 9, 10, 1, 8, colors.white[4]);
      rect(s, 14, 10, 1, 8, colors.white[4]);
      break;
    case 'bench':
      framed(4, 8, 16, 4, 'wood');
      post(6, 12, 'steel', 7);
      post(17, 12, 'steel', 7);
      rect(s, 4, 7, 16, 1, colors.timber[4]);
      break;
    case 'shelter':
      polygon(
        s,
        [
          [3, 11],
          [12, 4],
          [21, 11],
        ],
        colors.red[3],
      );
      framed(5, 10, 14, 2, 'red');
      post(6, 12, 'wood', 8);
      post(16, 12, 'wood', 8);
      break;
    case 'lamp':
      post(11, 8, 'steel', 12);
      framed(7, 4, 10, 4, 'yellow');
      rect(s, 8, 5, 8, 1, colors.yellow[4]);
      break;
    case 'toilet':
      framed(7, 4, 10, 6, 'blue');
      framed(6, 10, 12, 6, 'white');
      rect(s, 8, 16, 8, 3, colors.white[2]);
      break;
    case 'pin':
      polygon(
        s,
        [
          [12, 21],
          [5, 11],
          [6, 6],
          [9, 3],
          [15, 3],
          [18, 6],
          [19, 11],
        ],
        colors.red[3],
      );
      rect(s, 10, 5, 4, 4, colors.yellow[3]);
      break;
    case 'info':
      for (let y = 4; y <= 19; y++)
        for (let x = 4; x <= 19; x++)
          if ((x - 12) ** 2 + (y - 12) ** 2 <= 64) pixel(s, x, y, outline);
      for (let y = 5; y <= 18; y++)
        for (let x = 5; x <= 18; x++)
          if ((x - 12) ** 2 + (y - 12) ** 2 <= 49) pixel(s, x, y, colors.blue[3]);
      rect(s, 11, 10, 2, 6, colors.white[4]);
      rect(s, 11, 7, 2, 2, colors.yellow[3]);
      break;
    case 'locate':
      for (let y = 4; y <= 19; y++)
        for (let x = 4; x <= 19; x++) {
          const d = (x - 12) ** 2 + (y - 12) ** 2;
          if ((d <= 64 && d >= 49) || (d <= 16 && d >= 9)) pixel(s, x, y, outline);
        }
      rect(s, 11, 3, 2, 7, colors.red[3]);
      rect(s, 11, 14, 2, 7, colors.red[3]);
      rect(s, 3, 11, 7, 2, colors.red[3]);
      rect(s, 14, 11, 7, 2, colors.red[3]);
      rect(s, 11, 11, 2, 2, colors.yellow[3]);
      break;
    case 'demolish':
      rect(s, 3, 17, 14, 4, outline);
      rect(s, 4, 18, 12, 2, colors.yellow[3]);
      for (const x of [5, 13]) {
        rect(s, x, 18, 3, 3, outline);
        rect(s, x + 1, 19, 1, 1, colors.steel[2]);
      }
      rect(s, 5, 10, 8, 7, outline);
      rect(s, 6, 11, 6, 5, colors.yellow[3]);
      rect(s, 7, 12, 4, 2, colors.blue[2]);
      rect(s, 8, 12, 2, 1, colors.white[4]);
      rect(s, 13, 14, 5, 3, outline);
      polygon(
        s,
        [
          [17, 14],
          [22, 16],
          [21, 18],
          [17, 17],
        ],
        colors.yellow[3],
      );
      line(s, 18, 16, 22, 16, outline, 1);
      rect(s, 8, 8, 3, 2, outline);
      rect(s, 9, 6, 4, 2, colors.yellow[3]);
      break;
    case 'build':
      line(s, 6, 18, 15, 9, outline, 4);
      line(s, 7, 18, 15, 10, colors.wood[3], 2);
      polygon(
        s,
        [
          [12, 8],
          [17, 3],
          [21, 7],
          [16, 12],
        ],
        colors.steel[3],
      );
      line(s, 15, 4, 19, 8, colors.white[4], 1);
      break;
    case 'next':
    case 'prev':
      polygon(
        s,
        name === 'next'
          ? [
              [5, 4],
              [19, 12],
              [5, 20],
            ]
          : [
              [19, 4],
              [5, 12],
              [19, 20],
            ],
        colors.blue[3],
      );
      break;
    case 'plus':
    case 'minus':
      framed(4, 10, 16, 4, 'green');
      if (name === 'plus') framed(10, 4, 4, 16, 'green');
      break;
    default:
      if (name.startsWith('curve') || name.startsWith('slope') || name.startsWith('bank')) {
        const right = name.includes('Right') || name === 'bankRight';
        if (name.startsWith('curve')) {
          const radius = name.includes('Small') ? 4 : name.includes('Medium') ? 6 : 8;
          const startX = right ? 7 : 17,
            endX = right ? 17 : 7;
          line(s, startX, 19, startX, 13, outline, 2);
          line(s, startX, 13, startX + (right ? 3 : -3), 10, outline, 2);
          line(s, startX + (right ? 3 : -3), 10, endX, 10, outline, 2);
          line(s, startX - (right ? 1 : -1), 19, startX - (right ? 1 : -1), 13, colors.red[3], 1);
          line(s, startX - (right ? 1 : -1), 13, startX + (right ? 2 : -2), 9, colors.red[3], 1);
          line(s, startX + (right ? 2 : -2), 9, endX, 9, colors.red[3], 1);
          post(startX - 1, 18, 'steel', 4);
          post(endX - 1, 9, 'steel', 7);
          if (radius > 6) rect(s, 10, 6, 4, 2, colors.yellow[3]);
        } else if (name.startsWith('slope')) {
          const steep = name.includes('Steep');
          const up = name.includes('Up');
          const y0 = up ? (steep ? 19 : 16) : steep ? 5 : 8;
          const y1 = up ? (steep ? 5 : 8) : steep ? 19 : 16;
          line(s, 4, y0, 20, y1, outline, 4);
          line(s, 4, y0 - (up ? 0 : 1), 20, y1 - (up ? 0 : 1), colors.red[3], 2);
          post(5, Math.min(y0, y1) + 2, 'steel', 20 - Math.min(y0, y1));
          post(17, Math.min(y0, y1) + 2, 'steel', 20 - Math.min(y0, y1));
        } else {
          const lean = name === 'bankLeft' ? -4 : name === 'bankRight' ? 4 : 0;
          line(s, 4, 13 + lean, 20, 13 - lean, outline, 4);
          line(s, 4, 12 + lean, 20, 12 - lean, colors.red[3], 2);
          post(5, 15, 'steel', 5);
          post(17, 11, 'steel', 7);
        }
      } else {
        polygon(
          s,
          [
            [4, 17],
            [10, 8],
            [15, 12],
            [20, 6],
            [20, 18],
            [4, 18],
          ],
          colors.blue[3],
        );
      }
  }
  return s;
}

const steel = material(colors.steel);
const red = material(colors.red);
const green = material(colors.green);
const wood = material(colors.wood);
const yellow = material(colors.yellow);
const blue = material(colors.blue);

function objectMesh(name: string): Mesh | undefined {
  const tile = 1.45;
  const base = () =>
    box([-tile / 2, -tile / 2, 0], [tile / 2, tile / 2, 0.16], {
      top: material(colors.grass),
      left: material(colors.dirt),
      right: material(colors.grass),
    });
  if (name === 'scenery') return [...base(), ...palmTreeMesh()];
  if (name === 'entrance' || name === 'park') return parkEntranceMesh(0);
  if (name === 'land') return base();
  if (name === 'water') return box([-0.7, -0.7, 0], [0.7, 0.7, 0.22], material(colors.blue));
  if (name === 'staff' || name === 'guests')
    return [
      ...cylinder(0, 0, 0.72, 1.35, 0.22, 0.22, 8, material(colors.skin)),
      ...box([-0.24, -0.2, 0.1], [0.24, 0.2, 0.77], name === 'staff' ? blue : red),
      ...box([-0.24, -0.12, 0], [-0.04, 0.12, 0.2], steel),
      ...box([0.04, -0.12, 0], [0.24, 0.12, 0.2], steel),
    ];
  if (name === 'finances' || name === 'cash')
    return [0, 1, 2].flatMap((i) =>
      cylinder(0, 0, 0.2 + i * 0.2, 0.38 + i * 0.2, 0.56, 0.56, 10, yellow),
    );
  if (name === 'research')
    return [
      ...cylinder(0, 0, 0.1, 0.95, 0.52, 0.3, 8, material(colors.purple)),
      ...beam([-0.3, 0, 0.95], [0.3, 0, 0.95], 0.12, steel),
    ];
  if (name === 'coaster' || name === 'newRide') {
    const path: Vec3[] = [
      [-0.8, 0, 0.5],
      [-0.5, 0, 1.1],
      [0, 0, 0.6],
      [0.4, 0, 1.2],
      [0.8, 0, 0.55],
    ];
    return [
      ...path.slice(0, -1).flatMap((p, i) => beam(p, path[i + 1], 0.1, red)),
      ...box([-0.62, -0.1, 0], [-0.5, 0.1, 0.56], steel),
      ...box([0.4, -0.1, 0], [0.52, 0.1, 1.1], steel),
    ];
  }
  if (name === 'wheel' || name === 'rides') {
    const ring = Array.from({ length: 8 }, (_, i): Vec3 => {
      const angle = (i / 8) * Math.PI * 2;
      return [Math.cos(angle) * 0.68, 0, 0.95 + Math.sin(angle) * 0.68];
    });
    const spokes = ring.flatMap((point) => beam([0, -0.01, 0.95], point, 0.055, red));
    const rim = ring.flatMap((point, i) => beam(point, ring[(i + 1) % ring.length], 0.08, yellow));
    return [
      ...rim,
      ...spokes,
      ...beam([-0.48, 0.25, 0.05], [0, 0, 0.95], 0.1, steel),
      ...beam([0.48, 0.25, 0.05], [0, 0, 0.95], 0.1, steel),
    ];
  }
  if (name === 'carousel')
    return [
      ...cylinder(0, 0, 0.4, 0.62, 0.72, 0.72, 8, red),
      ...cylinder(0, 0, 0.62, 1.35, 0.07, 0.07, 6, steel),
      ...meshPolygon(
        [
          [-0.78, -0.65, 1.18],
          [0.72, -0.65, 1.18],
          [0.55, 0.5, 1.18],
          [-0.55, 0.5, 1.18],
        ],
        yellow,
      ),
      ...beam([-0.7, -0.55, 1.2], [0, 0, 1.55], 0.09, red),
      ...beam([0.7, -0.55, 1.2], [0, 0, 1.55], 0.09, green),
    ];
  if (name === 'ship')
    return [
      ...box([-0.72, -0.55, 0.15], [0.72, 0.55, 0.4], wood),
      ...meshPolygon(
        [
          [-0.78, -0.55, 0.38],
          [0.78, -0.55, 0.38],
          [0.48, 0.55, 0.38],
          [-0.48, 0.55, 0.38],
        ],
        red,
      ),
      ...beam([0, 0, 0.4], [0, 0, 1.5], 0.08, steel),
      ...meshPolygon(
        [
          [0.05, 0, 1.4],
          [0.05, 0, 0.55],
          [0.72, 0, 0.55],
        ],
        material(colors.white),
      ),
    ];
  if (name === 'food')
    return [
      ...box(
        [-0.72, -0.55, 0.25],
        [0.72, 0.55, 0.48],
        colors.orange ? material(colors.orange) : red,
      ),
      ...box([-0.62, -0.48, 0.48], [0.62, 0.48, 0.63], green),
      ...box([-0.68, -0.52, 0.63], [0.68, 0.52, 0.87], yellow),
    ];
  if (name === 'drink')
    return [
      ...cylinder(0, 0, 0.15, 1.05, 0.55, 0.4, 8, blue),
      ...beam([0.12, 0, 0.9], [0.35, 0, 1.45], 0.08, red),
    ];
  if (name === 'map')
    return [
      ...box([-0.8, -0.45, 0], [-0.3, 0.45, 0.08], green),
      ...box([-0.3, -0.45, 0], [0.25, 0.45, 0.08], material(colors.yellow)),
      ...box([0.25, -0.45, 0], [0.8, 0.45, 0.08], blue),
    ];
  return undefined;
}

function nearestSprite(source: Sprite, size: number): Sprite {
  const pixels = new Uint8Array(size * size).fill(TRANSPARENT);
  const content: Array<[number, number]> = [];
  source.pixels.forEach((color, index) => {
    if (color !== TRANSPARENT)
      content.push([index % source.width, Math.floor(index / source.width)]);
  });
  const minX = Math.min(...content.map(([x]) => x)),
    maxX = Math.max(...content.map(([x]) => x));
  const minY = Math.min(...content.map(([, y]) => y)),
    maxY = Math.max(...content.map(([, y]) => y));
  const scale = Math.min((size - 4) / (maxX - minX + 1), (size - 4) / (maxY - minY + 1));
  const width = Math.max(1, Math.floor((maxX - minX + 1) * scale));
  const height = Math.max(1, Math.floor((maxY - minY + 1) * scale));
  const ox = Math.floor((size - width) / 2),
    oy = Math.floor((size - height) / 2);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = minX + Math.min(maxX - minX, Math.floor(x / scale));
      const sy = minY + Math.min(maxY - minY, Math.floor(y / scale));
      pixels[(oy + y) * size + ox + x] = source.pixels[sy * source.width + sx];
    }
  return { width: size, height: size, anchor: { x: size / 2, y: size / 2 }, pixels };
}

function removeDetachedSinglePixels(sprite: Sprite): Sprite {
  const pixels = sprite.pixels.slice();
  const seen = new Set<number>();
  for (let start = 0; start < pixels.length; start++) {
    if (pixels[start] === TRANSPARENT || seen.has(start)) continue;
    const pending = [start];
    const component = [start];
    seen.add(start);
    while (pending.length) {
      const index = pending.pop()!;
      const x = index % sprite.width;
      const y = Math.floor(index / sprite.width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const next = ny * sprite.width + nx;
          if (
            (dx || dy) &&
            nx >= 0 &&
            ny >= 0 &&
            nx < sprite.width &&
            ny < sprite.height &&
            pixels[next] !== TRANSPARENT &&
            !seen.has(next)
          ) {
            seen.add(next);
            pending.push(next);
            component.push(next);
          }
        }
    }
    if (component.length === 1) pixels[start] = TRANSPARENT;
  }
  return { ...sprite, pixels };
}

const HAND_AUTHORED_ICONS = new Set([
  'land',
  'water',
  'scenery',
  'paths',
  'rides',
  'wheel',
  'newRide',
  'park',
  'staff',
  'guests',
  'finances',
  'cash',
  'research',
  'map',
  'food',
  'drink',
  'coaster',
  'carousel',
  'ship',
  'twist',
  'entrance',
  'demolish',
  'sun',
  'cloud',
]);

export function renderUiIconSprite(name: string, size: 16 | 24): Sprite {
  const drawn = drawIcon(name);
  if (drawn) return size === 24 ? drawn : nearestSprite(drawn, size);
  if (HAND_AUTHORED_ICONS.has(name)) return nearestSprite(iconShapes(name), size);
  const mesh = objectMesh(name);
  if (!mesh) return nearestSprite(iconShapes(name), size);
  const rendered = renderMesh(mesh);
  return removeDetachedSinglePixels(nearestSprite(rendered, size));
}

function rgba(sprite: Sprite): Buffer {
  const output = Buffer.alloc(sprite.width * sprite.height * 4);
  sprite.pixels.forEach((index, pixelIndex) => {
    if (index === TRANSPARENT) return;
    const [r, g, b] = PALETTE[index];
    output[pixelIndex * 4] = r;
    output[pixelIndex * 4 + 1] = g;
    output[pixelIndex * 4 + 2] = b;
    output[pixelIndex * 4 + 3] = 255;
  });
  return output;
}

export async function renderUiIcons(outputDirectory: string): Promise<void> {
  for (const size of [16, 24] as const) {
    const target = join(outputDirectory, 'ui-icons', String(size));
    await mkdir(target, { recursive: true });
    for (const name of ICON_NAMES) {
      const sprite = renderUiIconSprite(name, size);
      await sharp(rgba(sprite), { raw: { width: size, height: size, channels: 4 } })
        .png({
          palette: true,
          colors: 64,
          dither: 0,
          compressionLevel: 9,
          adaptiveFiltering: false,
        })
        .toFile(join(target, `${name}.png`));
    }
  }
}
