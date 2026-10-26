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

function polygon(
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
      line(s, name === 'rotateLeft' ? 16 : 8, 6, 6, 6, outline, 3);
      line(s, 6, 6, 4, 12, outline, 3);
      line(s, 4, 12, 7, 18, outline, 3);
      line(s, 7, 18, 14, 20, outline, 3);
      line(s, 14, 20, 19, 16, outline, 3);
      polygon(
        s,
        name === 'rotateLeft'
          ? [
              [4, 4],
              [10, 4],
              [6, 9],
            ]
          : [
              [18, 4],
              [12, 4],
              [16, 9],
            ],
        colors.yellow[3],
      );
      break;
    case 'options':
      framed(9, 3, 6, 18, 'steel');
      framed(3, 9, 18, 6, 'steel');
      rect(s, 8, 8, 8, 8, outline);
      rect(s, 10, 10, 4, 4, colors.orange[3]);
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
          [3, 16],
          [9, 8],
          [14, 12],
          [18, 7],
          [22, 16],
        ],
        colors.grass[3],
      );
      line(s, 3, 17, 22, 17, outline, 2);
      set(8, 10, 3, 2, 'green', 4);
      break;
    case 'water':
      polygon(
        s,
        [
          [4, 13],
          [8, 10],
          [12, 12],
          [16, 9],
          [20, 12],
          [20, 18],
          [4, 18],
        ],
        colors.blue[3],
      );
      line(s, 5, 14, 11, 14, colors.foam[4], 1);
      line(s, 14, 12, 19, 12, colors.foam[4], 1);
      break;
    case 'scenery':
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
      polygon(
        s,
        [
          [4, 18],
          [8, 13],
          [8, 6],
          [13, 6],
          [13, 13],
          [20, 18],
        ],
        colors.stone[3],
      );
      line(s, 8, 7, 13, 7, colors.white[4], 1);
      line(s, 12, 10, 16, 15, colors.white[4], 1);
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
      for (let y = 5; y <= 17; y++)
        for (let x = 5; x <= 17; x++) {
          const d = (x - 11) ** 2 + (y - 11) ** 2;
          if (d <= 49 && d >= 36) pixel(s, x, y, outline);
          else if (d < 36 && d >= 25) pixel(s, x, y, colors.red[3]);
        }
      line(s, 11, 11, 6, 6, outline, 1);
      line(s, 11, 11, 16, 6, outline, 1);
      line(s, 11, 11, 6, 16, outline, 1);
      line(s, 11, 11, 16, 16, outline, 1);
      post(10, 17, 'steel', 4);
      break;
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
      line(s, 4, 17, 8, 6, outline, 2);
      line(s, 8, 6, 12, 17, outline, 2);
      line(s, 12, 17, 16, 8, outline, 2);
      line(s, 16, 8, 21, 14, outline, 2);
      line(s, 4, 16, 8, 5, colors.red[3], 1);
      line(s, 8, 5, 12, 16, colors.red[3], 1);
      line(s, 12, 16, 16, 7, colors.red[3], 1);
      line(s, 16, 7, 21, 13, colors.red[3], 1);
      post(6, 16, 'steel', 4);
      post(15, 14, 'steel', 6);
      break;
    case 'twist':
      line(s, 6, 6, 18, 18, outline, 4);
      line(s, 18, 6, 6, 18, outline, 4);
      line(s, 6, 6, 18, 18, colors.red[3], 2);
      line(s, 18, 6, 6, 18, colors.blue[3], 2);
      post(5, 16, 'steel', 4);
      post(16, 16, 'steel', 4);
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
    case 'guests':
      set(8, 5, 8, 7, 'skin', 3);
      rect(s, 7, 4, 10, 2, outline);
      framed(7, 12, 10, 8, name === 'staff' ? 'blue' : 'red');
      set(9, 7, 1, 1, 'steel', 0);
      set(14, 7, 1, 1, 'steel', 0);
      set(10, 9, 4, 1, 'red', 1);
      break;
    case 'park':
    case 'entrance':
    case 'exit':
      framed(4, 7, 16, 13, 'wood');
      framed(7, 4, 10, 4, 'red');
      rect(s, 10, 12, 5, 8, colors.stone[1]);
      rect(s, 6, 10, 2, 3, colors.yellow[3]);
      rect(s, 16, 10, 2, 3, colors.yellow[3]);
      break;
    case 'finances':
    case 'cash':
      framed(3, 7, 18, 11, 'green');
      rect(s, 5, 9, 14, 7, colors.green[1]);
      rect(s, 9, 9, 6, 7, colors.yellow[3]);
      rect(s, 10, 10, 4, 5, colors.yellow[2]);
      break;
    case 'research':
      line(s, 8, 4, 16, 4, outline, 2);
      line(s, 9, 5, 9, 10, outline, 2);
      line(s, 15, 5, 15, 10, outline, 2);
      polygon(
        s,
        [
          [9, 9],
          [15, 9],
          [19, 19],
          [5, 19],
        ],
        colors.purple[3],
      );
      line(s, 7, 16, 17, 16, colors.foam[4], 2);
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
      framed(4, 8, 16, 9, 'wood');
      rect(s, 5, 7, 14, 4, colors.orange[3]);
      rect(s, 6, 8, 12, 2, colors.yellow[3]);
      rect(s, 7, 11, 10, 2, colors.green[3]);
      rect(s, 6, 14, 12, 3, colors.red[3]);
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
      polygon(
        s,
        [
          [3, 14],
          [21, 14],
          [17, 19],
          [7, 19],
        ],
        colors.wood[3],
      );
      rect(s, 4, 13, 16, 2, outline);
      rect(s, 11, 5, 2, 8, outline);
      polygon(
        s,
        [
          [10, 6],
          [10, 12],
          [5, 12],
        ],
        colors.red[3],
      );
      polygon(
        s,
        [
          [14, 7],
          [14, 12],
          [19, 12],
        ],
        colors.white[4],
      );
      line(s, 4, 21, 10, 21, colors.blue[3], 1);
      line(s, 13, 21, 19, 21, colors.blue[3], 1);
      break;
    case 'sun':
    case 'cloud':
    case 'rain':
    case 'storm':
      if (name === 'sun') {
        rect(s, 9, 7, 6, 8, colors.yellow[3]);
        rect(s, 7, 9, 10, 4, colors.yellow[3]);
        line(s, 12, 3, 12, 5, colors.orange[3], 2);
        line(s, 12, 17, 12, 20, colors.orange[3], 2);
        line(s, 4, 11, 6, 11, colors.orange[3], 2);
        line(s, 18, 11, 20, 11, colors.orange[3], 2);
      } else {
        framed(5, 7, 14, 8, 'white');
        rect(s, 8, 5, 8, 3, colors.white[4]);
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
      framed(4, 15, 16, 4, 'stone');
      line(s, 7, 14, 9, 9, outline, 3);
      line(s, 9, 9, 16, 9, outline, 3);
      line(s, 16, 9, 18, 14, outline, 3);
      line(s, 8, 13, 10, 10, colors.orange[3], 1);
      rect(s, 12, 5, 3, 3, colors.red[3]);
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
  if (name === 'paths') return box([-0.8, -0.42, 0], [0.8, 0.42, 0.2], material(colors.stone));
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
  if (name === 'coaster') {
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

export function renderUiIconSprite(name: string, size: 16 | 24): Sprite {
  const mesh = objectMesh(name);
  if (!mesh) return nearestSprite(iconShapes(name), size);
  const rendered = renderMesh(mesh);
  return nearestSprite(rendered, size);
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
  for (const size of [16, 24]) {
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
