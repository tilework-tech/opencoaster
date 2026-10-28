import type { Renderer } from '../../render/renderer';

interface ViewportId {
  id: string;
}

export class ViewportRefreshScheduler {
  private index = 0;
  private lastCanvasRefresh = -Infinity;
  private webglFrame = 0;

  next(viewports: readonly ViewportId[], backend: Renderer['backend'], now: number): string[] {
    if (viewports.length === 0) return [];
    if (backend === 'Canvas2D') {
      if (now - this.lastCanvasRefresh < 100) return [];
      this.lastCanvasRefresh = now;
    } else if (this.webglFrame++ % 3 !== 0) {
      return [];
    }
    const viewport = viewports[this.index % viewports.length];
    this.index++;
    return viewport ? [viewport.id] : [];
  }
}
