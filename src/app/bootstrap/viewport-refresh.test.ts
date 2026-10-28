import { describe, expect, it } from 'vitest';
import { ViewportRefreshScheduler } from './viewport-refresh';

const viewports = [{ id: 'guest' }, { id: 'ride' }, { id: 'pinned' }];

describe('ViewportRefreshScheduler', () => {
  it('rotates one WebGL2 refresh every three frames', () => {
    const scheduler = new ViewportRefreshScheduler();

    expect(scheduler.next(viewports, 'WebGL2', 0)).toEqual(['guest']);
    expect(scheduler.next(viewports, 'WebGL2', 16)).toEqual([]);
    expect(scheduler.next(viewports, 'WebGL2', 32)).toEqual([]);
    expect(scheduler.next(viewports, 'WebGL2', 48)).toEqual(['ride']);
  });

  it('refreshes one Canvas2D viewport every 100 ms', () => {
    const scheduler = new ViewportRefreshScheduler();

    expect(scheduler.next(viewports, 'Canvas2D', 0)).toEqual(['guest']);
    expect(scheduler.next(viewports, 'Canvas2D', 99)).toEqual([]);
    expect(scheduler.next(viewports, 'Canvas2D', 100)).toEqual(['ride']);
  });

  it('does not advance while there are no visible viewports', () => {
    const scheduler = new ViewportRefreshScheduler();

    expect(scheduler.next([], 'WebGL2', 0)).toEqual([]);
    expect(scheduler.next(viewports, 'WebGL2', 16)).toEqual(['guest']);
  });
});
