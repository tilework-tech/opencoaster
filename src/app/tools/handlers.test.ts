import { describe, expect, it, vi } from 'vitest';
import { handleLandPurchase, type ToolHandlerDependencies } from './handlers';

describe('handleLandPurchase', () => {
  it('identifies the unavailable tile in the tool status', () => {
    const setToolStatus = vi.fn();
    const deps = {
      sim: {
        map: { width: 64, ownership: new Uint8Array(64 * 64) },
        latest: { park: { cash: 50_000 } },
        command: vi.fn(),
      },
      gameUi: { setToolStatus },
    } as unknown as ToolHandlerDependencies;

    handleLandPurchase(deps, 15, 40, false);

    expect(setToolStatus).toHaveBeenCalledWith('Tile 15, 40 is not available for that purchase.');
  });
});
