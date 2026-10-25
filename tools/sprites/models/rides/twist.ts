import { withRiders } from './common';

export const model = withRiders('Twist', (frame) =>
  Array.from({ length: 3 }, (_, i) => {
    const angle = (frame * Math.PI) / 6 + (i / 3) * Math.PI * 2;
    return [Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0.18] as const;
  }),
);
