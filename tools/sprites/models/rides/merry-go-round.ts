import { withRiders } from './common';

export const model = withRiders('Merry-Go-Round', (frame) =>
  Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + (frame * Math.PI) / 8;
    return [Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0.25] as const;
  }),
);
