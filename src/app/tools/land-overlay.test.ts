import { describe, expect, it } from 'vitest';
import { showsLandOverlay } from './land-overlay';

describe('showsLandOverlay', () => {
  it('shows only with the land and land or rights purchase tools', () => {
    expect(showsLandOverlay('land')).toBe(true);
    expect(showsLandOverlay('buy-land')).toBe(true);
    expect(showsLandOverlay('buy-rights')).toBe(true);
    for (const tool of ['select', 'path', 'scenery', 'ride', 'track', 'patrol', 'clear'] as const)
      expect(showsLandOverlay(tool)).toBe(false);
  });
});
