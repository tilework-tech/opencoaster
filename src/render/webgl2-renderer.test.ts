import { describe, expect, it, vi } from 'vitest';
import {
  enableSpriteAlphaBlending,
  guestSpriteIndex,
  staffSpriteName,
  terrainSpriteIndex,
} from './webgl2-renderer';
import { litterSpriteName } from './world-art';

describe('WebGL sprite blending', () => {
  it('enables source-over alpha blending for sprites', () => {
    const gl = {
      BLEND: 0x0be2,
      SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303,
      enable: vi.fn(),
      blendFunc: vi.fn(),
    } as const;

    enableSpriteAlphaBlending(gl);

    expect(gl.enable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  });
});

describe('terrain atlas selection', () => {
  it('maps surface classes and slope masks to atlas slots', () => {
    const sprites = [
      terrainSpriteIndex(0, 0),
      terrainSpriteIndex(0, 0b0100),
      terrainSpriteIndex(1, 0),
      terrainSpriteIndex(1, 0b0001),
      terrainSpriteIndex(2, 0),
      terrainSpriteIndex(3, 0),
      terrainSpriteIndex(4, 0),
      terrainSpriteIndex(5, 0),
      terrainSpriteIndex(6, 0),
    ];

    expect(new Set(sprites).size).toBe(sprites.length);
  });
});

describe('entity atlas selection', () => {
  it('uses distinct sprite keys for each staff role and litter kind', () => {
    const staff = [0, 1, 2, 3].map(staffSpriteName);
    const litter = [litterSpriteName(0, 0), litterSpriteName(1, 0)];
    expect(new Set([...staff, ...litter]).size).toBe(staff.length + litter.length);
  });

  it('selects the expected palette, direction, and walking frame', () => {
    expect(guestSpriteIndex(0, 0, 0)).toBe(40);
    expect(guestSpriteIndex(2, 1, 3)).toBe(79);
    expect(guestSpriteIndex(7, 3, 3)).toBe(167);
  });
});
