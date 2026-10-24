import { describe, expect, it } from 'vitest';
import { capDevicePixelRatio, zoomCameraAt } from './camera-controls';

describe('camera controls', () => {
  it('snaps zoom to the nearest supported camera level around the gesture anchor', () => {
    const camera = { x: 300, y: 500, zoom: 1, rotation: 0 as const };
    const anchor = { x: 250, y: 300 };
    const viewport = { width: 400, height: 600 };
    const worldAnchor = {
      x: camera.x + (anchor.x - viewport.width / 2) / camera.zoom,
      y: camera.y + (anchor.y - viewport.height / 2) / camera.zoom,
    };

    zoomCameraAt(camera, 1.6, anchor.x, anchor.y, viewport);

    expect(camera.zoom).toBe(2);
    expect(camera.x + (anchor.x - viewport.width / 2) / camera.zoom).toBeCloseTo(worldAnchor.x);
    expect(camera.y + (anchor.y - viewport.height / 2) / camera.zoom).toBeCloseTo(worldAnchor.y);
  });

  it('caps drawing-buffer scale on high-density displays', () => {
    expect(capDevicePixelRatio(3)).toBe(2);
    expect(capDevicePixelRatio(1.25)).toBe(1.25);
    expect(capDevicePixelRatio(0)).toBe(1);
  });
});
