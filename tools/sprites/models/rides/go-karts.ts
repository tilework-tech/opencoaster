import { withRiders } from './common';

export const model = withRiders('Go-Karts', (frame) =>
  Array.from({ length: 3 }, (_, i) => {
    const angle = (i / 3 + frame / 8) * Math.PI * 2;
    return [Math.cos(angle) * 0.35, Math.sin(angle) * 0.25, 0.07] as const;
  }),
);
