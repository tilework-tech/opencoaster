import { withRiders } from './common';

export const model = withRiders('Enterprise', (frame) =>
  Array.from({ length: 8 }, (_, i) => {
    const angle = (frame * Math.PI) / 16 + (i / 8) * Math.PI * 2;
    return [Math.cos(angle) * 0.36, 0, 0.42 + Math.sin(angle) * 0.36] as const;
  }),
);
