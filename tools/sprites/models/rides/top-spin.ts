import { withRiders } from './common';

export const model = withRiders('Top Spin', (frame) => {
  const angle = (frame * Math.PI) / 4;
  return Array.from({ length: 8 }, (_, i) => {
    const x = -0.32 + (i % 4) * 0.21;
    const y = i < 4 ? -0.1 : 0.1;
    return [x * Math.cos(angle), y, 0.55 - x * Math.sin(angle)] as const;
  });
});
