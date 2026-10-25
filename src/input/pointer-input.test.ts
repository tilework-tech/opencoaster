import { afterEach, describe, expect, it, vi } from 'vitest';
import { PointerInput } from './pointer-input';
import type { PointerSample } from './pointer-input';

function sample(pointerId: number, x: number, y: number, pointerType = 'touch'): PointerSample {
  return { pointerId, x, y, pointerType, shiftKey: false };
}

const NO_PATH_DRAG = {
  pathDragStart: () => false,
  pathDragMove: () => undefined,
  pathDragEnd: () => undefined,
  pathDragCancel: () => undefined,
};

describe('PointerInput', () => {
  afterEach(() => vi.useRealTimers());

  it('pans the camera from a one-finger drag while selecting', () => {
    const camera = { x: 120, y: 240, zoom: 1, rotation: 0 };
    const input = new PointerInput({
      ...NO_PATH_DRAG,
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
      ...NO_PATH_DRAG,
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

  it('lays a footpath run from the press point to each move, then ends it on release', () => {
    const calls: string[] = [];
    const input = new PointerInput({
      ...NO_PATH_DRAG,
      tool: () => 'path',
      pan: () => calls.push('pan'),
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: () => calls.push('paint'),
      pathDragStart: (x, y) => {
        calls.push(`start ${x},${y}`);
        return true;
      },
      pathDragMove: (x, y) => calls.push(`move ${x},${y}`),
      pathDragEnd: () => calls.push('end'),
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove(sample(1, 118, 106));
    input.pointerMove(sample(1, 132, 112));
    input.pointerUp(sample(1, 132, 112));

    expect(calls).toEqual(['start 100,100', 'move 118,106', 'move 132,112', 'end']);
  });

  it('pans instead of laying a run when the path drag starts in piece mode', () => {
    const calls: string[] = [];
    const input = new PointerInput({
      ...NO_PATH_DRAG,
      tool: () => 'path',
      pan: (dx, dy) => calls.push(`pan ${dx},${dy}`),
      zoomStart: () => {},
      zoom: () => {},
      zoomEnd: () => {},
      rotate: () => {},
      tap: () => {},
      hold: () => {},
      paint: () => {},
      pathDragStart: () => false,
    });

    input.pointerDown(sample(1, 100, 100));
    input.pointerMove(sample(1, 118, 106));
    input.pointerUp(sample(1, 118, 106));

    expect(calls).toEqual(['pan 18,6']);
  });

  it('paints each move in the land tool instead of panning', () => {
    const painted: Array<[number, number, boolean]> = [];
    const input = new PointerInput({
      ...NO_PATH_DRAG,
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
      ...NO_PATH_DRAG,
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
      ...NO_PATH_DRAG,
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
      ...NO_PATH_DRAG,
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
      ...NO_PATH_DRAG,
      tool: () => 'land',
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
      ...NO_PATH_DRAG,
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
    vi.advanceTimersByTime(900);
    input.pointerUp(sample(1, 42, 84));

    expect(held).toEqual([[42, 84]]);
    expect(tapped).toEqual([]);
  });

  it('keeps a touch shorter than the hold threshold as a tap', () => {
    vi.useFakeTimers();
    const tapped: Array<[number, number]> = [];
    const held: Array<[number, number]> = [];
    const input = new PointerInput({
      ...NO_PATH_DRAG,
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
    vi.advanceTimersByTime(899);
    input.pointerUp(sample(1, 42, 84));

    expect(held).toEqual([]);
    expect(tapped).toEqual([[42, 84]]);
  });

  it('emits taps for unmoved pointers and ignores canceled gestures', () => {
    const tapped: Array<[number, number]> = [];
    const input = new PointerInput({
      ...NO_PATH_DRAG,
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

  it.each(['select', 'land', 'path'])(
    'treats a %s click with sub-threshold jitter as a tap that never pans',
    (tool) => {
      const pans: Array<[number, number]> = [];
      const taps: Array<[number, number]> = [];
      const input = new PointerInput({
        ...NO_PATH_DRAG,
        tool: () => tool,
        pan: (dx, dy) => pans.push([dx, dy]),
        zoomStart: () => {},
        zoom: () => {},
        zoomEnd: () => {},
        rotate: () => {},
        tap: (x, y) => taps.push([x, y]),
        hold: () => {},
        paint: () => {},
      });

      input.pointerDown(sample(1, 200, 200, 'mouse'));
      input.pointerMove(sample(1, 202, 201, 'mouse'));
      input.pointerUp(sample(1, 202, 201, 'mouse'));

      expect(pans).toEqual([]);
      expect(taps).toEqual([[202, 201]]);
    },
  );
});
