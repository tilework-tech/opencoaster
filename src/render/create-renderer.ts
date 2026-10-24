import { Canvas2DRenderer } from './canvas2d-renderer';
import type { Renderer } from './renderer';
import { WebGL2Renderer } from './webgl2-renderer';

export interface RendererSelection {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
}

export function createRenderer(canvas: HTMLCanvasElement): RendererSelection {
  const webgl = new WebGL2Renderer();
  try {
    webgl.attach(canvas);
    return { renderer: webgl, canvas };
  } catch (error) {
    console.warn('WebGL2 renderer failed; using the Canvas2D fallback.', error);
    webgl.dispose();
    const fallbackCanvas = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(fallbackCanvas);
    const fallback = new Canvas2DRenderer();
    fallback.attach(fallbackCanvas);
    return { renderer: fallback, canvas: fallbackCanvas };
  }
}
