import { describe, expect, it, vi } from 'vitest';
import {
  enableSpriteAlphaBlending,
  litterSpriteIndex,
  staffSpriteIndex,
  terrainSpriteIndex,
} from './webgl2-renderer';

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
  it('uses distinct procedural sprites for each staff role and litter kind', () => {
    const staff = [0, 1, 2, 3].map(staffSpriteIndex);
    const litter = [litterSpriteIndex(0), litterSpriteIndex(1)];
    expect(new Set([...staff, ...litter]).size).toBe(staff.length + litter.length);
  });
});
