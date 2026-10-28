import { element } from './dom';

export function liveViewport(target: string, label = 'Live view'): HTMLDivElement {
  const surface = element('div', 'live-viewport');
  surface.dataset.liveViewport = target;
  surface.setAttribute('role', 'img');
  surface.setAttribute('aria-label', label);
  return surface;
}
