import { describe, expect, it, vi } from 'vitest';
import { enableSpriteAlphaBlending } from './webgl2-renderer';

describe('WebGL sprite blending', () => {
  it('composites transparent atlas pixels over the scene', () => {
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
