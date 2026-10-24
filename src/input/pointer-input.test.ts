import { afterEach, describe, expect, it, vi } from 'vitest';
import { PointerInput } from './pointer-input';
import type { PointerSample } from './pointer-input';

function sample(pointerId: number, x: number, y: number, pointerType = 'touch'): PointerSample {
  return { pointerId, x, y, pointerType, shiftKey: false };
}

describe('PointerInput', () => {
  afterEach(() => vi.useRealTimers());

  it('pans the camera from a one-finger drag while selecting', () => {
    const camera = { x: 120, y: 240, zoom: 1, rotation: 0 };
    const input = new PointerInput({
      tool: () => 'select',
      pan: (dx, dy) => {
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
      },
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: () => {},
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove(sample(1, 132, 118));
    input.pointerUp(sample(1, 132, 118));

    expect(camera).toEqual({ x: 88, y: 222, zoom: 1, rotation: 0 });
  });

  it('includes movement before the drag threshold in the initial pan', () => {
    const pans: Array<[number, number]> = [];
    const input = new PointerInput({
      tool: () => 'select',
      pan: (dx, dy) => pans.push([dx, dy]),
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: () => {},
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove(sample(1, 102, 100));
    input.pointerMove(sample(1, 106, 100));
    input.pointerUp(sample(1, 106, 100));

    expect(pans).toEqual([[6, 0]]);
  });

  it('paints each move in the path tool instead of panning', () => {
    const painted: Array<[number, number, boolean]> = [];
    const input = new PointerInput({
      tool: () => 'path',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: (x, y, shiftKey) => painted.push([x, y, shiftKey]),
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove(sample(1, 118, 106));
    input.pointerMove(sample(1, 132, 112));
    input.pointerUp(sample(1, 132, 112));

    expect(painted).toEqual([
      [100, 100, false],
      [109, 103, false],
      [118, 106, false],
      [125, 109, false],
      [132, 112, false],
    ]);
  });

  it('paints each move in the land tool instead of panning', () => {
    const painted: Array<[number, number, boolean]> = [];
    const input = new PointerInput({
      tool: () => 'land',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: (x, y, shiftKey) => painted.push([x, y, shiftKey]),
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove({ ...sample(1, 118, 106), shiftKey: true });
    input.pointerUp(sample(1, 118, 106));

    expect(painted).toEqual([
      [100, 100, true],
      [109, 103, true],
      [118, 106, true],
    ]);
  });

  it('turns a two-pointer spread into anchored zoom', () => {
    const zoomScales: number[] = [];
    let zoomAnchor: [number, number] | null = null;
    const input = new PointerInput({
      tool: () => 'select',
      pan: () => {},
      zoomStart: () => {},
      zoom: (scale, x, y) => {
        zoomScales.push(scale);
        zoomAnchor = [x, y];
      },
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: () => {},
    });

    input.pointerDown(sample(1, 100, 120));
    input.pointerDown(sample(2, 200, 120));
    input.pointerMove(sample(2, 260, 120));
    input.pointerMove(sample(2, 300, 120));
    input.pointerUp(sample(2, 260, 120));
    input.pointerUp(sample(1, 100, 120));

    expect(zoomScales).toEqual([1.6, 2]);
    expect(zoomAnchor).toEqual([200, 120]);
  });

  it('turns a two-pointer twist into a quarter-turn rotation', () => {
    let rotations = 0;
    const input = new PointerInput({
      tool: () => 'select',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: (direction) => (rotations += direction),
      tap: () => {},
      hold: () => {},
      paint: () => {},
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerDown(sample(2, 200, 100));
    input.pointerMove(sample(2, 100, 200));
    input.pointerUp(sample(2, 100, 200));
    input.pointerUp(sample(1, 100, 100));

    expect(rotations).toBe(1);
  });

  it('accumulates a slow two-pointer twist until it reaches a quarter turn', () => {
    let rotations = 0;
    const input = new PointerInput({
      tool: () => 'select',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: (direction) => (rotations += direction),
      tap: () => {},
      hold: () => {},
      paint: () => {},
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerDown(sample(2, 200, 100));
    for (const degrees of [10, 20, 30, 40, 50]) {
      const radians = (degrees * Math.PI) / 180;
      input.pointerMove(sample(2, 100 + Math.cos(radians) * 100, 100 + Math.sin(radians) * 100));
    }
    input.pointerUp(sample(2, 164, 177));
    input.pointerUp(sample(1, 100, 100));

    expect(rotations).toBe(1);
  });

  it('emits intermediate paint points during a long drag', () => {
    const painted: Array<[number, number]> = [];
    const input = new PointerInput({
      tool: () => 'path',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: (x, y) => painted.push([x, y]),
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove(sample(1, 220, 100));
    input.pointerUp(sample(1, 220, 100));

    expect(painted[0]).toEqual([100, 100]);
    expect(painted.at(-1)).toEqual([220, 100]);
    expect(painted.some(([x]) => x > 100 && x < 220)).toBe(true);
  });

  it('opens the held object without also treating the release as a tap', () => {
    vi.useFakeTimers();
    const held: Array<[number, number]> = [];
    const tapped: Array<[number, number]> = [];
    const input = new PointerInput({
      tool: () => 'select',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: (x, y) => tapped.push([x, y]),
      hold: (x, y) => held.push([x, y]),
      paint: () => {},
    });

    input.pointerDown(sample(1, 42, 84));
    vi.advanceTimersByTime(500);
    input.pointerUp(sample(1, 42, 84));

    expect(held).toEqual([[42, 84]]);
    expect(tapped).toEqual([]);
  });

  it('emits taps for unmoved pointers and ignores canceled gestures', () => {
    const tapped: Array<[number, number]> = [];
    const input = new PointerInput({
      tool: () => 'select',
      pan: () => {},
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: (x, y) => tapped.push([x, y]),
      hold: () => {},
      paint: () => {},
    });

    input.pointerDown(sample(1, 14, 22));
    input.pointerUp(sample(1, 14, 22));
    input.pointerDown(sample(2, 30, 36));
    input.pointerCancel(2);

    expect(tapped).toEqual([[14, 22]]);
  });
});
