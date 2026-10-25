import { withRiders } from './common';

function slider(t: number): readonly [number, number, number] {
  const angle = t * Math.PI * 4 + 0.6;
  return [Math.cos(angle) * 0.27, Math.sin(angle) * 0.27, 0.85 - t * 0.78];
}

export const model = withRiders('Spiral Slide', (frame) => {
  const t = (frame + 1) / 10;
  return [slider(t), slider(Math.max(0.04, t - 0.42))];
});
