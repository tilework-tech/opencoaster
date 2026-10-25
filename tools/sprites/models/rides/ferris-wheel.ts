import { withRiders } from './common';

export const model = withRiders('Ferris Wheel', (frame) =>
  Array.from({ length: 8 }, (_, i) => {
    const angle = (frame * Math.PI) / 16 + (i / 8) * Math.PI * 2;
    return [Math.cos(angle) * 0.38, 0, 0.5 + Math.sin(angle) * 0.38 - 0.03] as const;
  }),
);
