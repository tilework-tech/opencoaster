import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Camera, MapData } from './renderer';
import { OWNED } from '../sim/map/tile-map';
import { OwnershipOverlay } from './ownership-overlay';

describe('ownership overlay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the parcel drawing until map, camera, or viewport changes', () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      className: '',
      getContext: () => context,
      setAttribute: vi.fn(),
      style: {},
      width: 1,
      height: 1,
      remove: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const parent = { append: vi.fn() } as unknown as HTMLElement;
    vi.stubGlobal('document', { createElement: () => canvas });
    const overlay = new OwnershipOverlay(parent);
    const map = {
      width: 1,
      height: 1,
      heights: new Int8Array([0]),
      ownership: new Uint8Array([0]),
    } as unknown as MapData;
    const camera: Camera = { x: 0, y: 0, zoom: 1, rotation: 0 };

    overlay.resize(640, 400, 1);
    overlay.draw(map, camera);
    overlay.draw(map, camera);

    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(context.clearRect).toHaveBeenCalledTimes(1);

    overlay.draw(map, { ...camera, x: 1 });
    expect(context.fill).toHaveBeenCalledTimes(2);

    const updatedMap = { ...map, ownership: new Uint8Array([OWNED]) };
    overlay.draw(updatedMap, { ...camera, x: 1 });
    expect(context.clearRect).toHaveBeenCalledTimes(3);

    overlay.resize(800, 400, 1);
    overlay.draw(updatedMap, { ...camera, x: 1 });
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(context.clearRect).toHaveBeenCalledTimes(4);

    overlay.resize(800, 400, 2);
    overlay.draw(updatedMap, { ...camera, x: 1 });
    expect(context.clearRect).toHaveBeenCalledTimes(5);
  });

  it('projects park fence posts and rails onto each sloped tile corner', () => {
    const lineCalls = (slope: number) => {
      const context = {
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        setLineDash: vi.fn(),
        setTransform: vi.fn(),
        stroke: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      const canvas = {
        className: '',
        getContext: () => context,
        setAttribute: vi.fn(),
        style: {},
        width: 1,
        height: 1,
        remove: vi.fn(),
      } as unknown as HTMLCanvasElement;
      vi.stubGlobal('document', { createElement: () => canvas });
      const overlay = new OwnershipOverlay({ append: vi.fn() } as unknown as HTMLElement);
      overlay.resize(640, 400, 1);
      overlay.draw(
        {
          width: 1,
          height: 1,
          heights: new Uint8Array([0]),
          slope: new Uint8Array([slope]),
          ownership: new Uint8Array([OWNED]),
        } as unknown as MapData,
        { x: 0, y: 0, zoom: 1, rotation: 0 },
      );
      const calls = {
        fillRects: (context.fillRect as unknown as ReturnType<typeof vi.fn>).mock.calls,
        lineTos: (context.lineTo as unknown as ReturnType<typeof vi.fn>).mock.calls,
        moveTos: (context.moveTo as unknown as ReturnType<typeof vi.fn>).mock.calls,
      };
      overlay.dispose();
      return calls;
    };

    const calls = lineCalls(1);
    expect(calls.moveTos).toContainEqual([352, 216]);
    expect(calls.lineTos).toContainEqual([320, 232]);
    expect(calls.moveTos).toContainEqual([352, 214]);
    expect(calls.lineTos).toContainEqual([320, 230]);
    expect(calls.fillRects).toContainEqual([350, 213, 4, 6]);
  });
});
