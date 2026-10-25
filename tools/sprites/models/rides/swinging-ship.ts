import { withRiders } from './common';

const SWING = [0, 12, 24, 30, 18, 6, -12, -24] as const;

export const model = withRiders('Swinging Ship', (frame) =>
  Array.from({ length: 5 }, (_, i) => {
    const angle = (SWING[frame] * Math.PI) / 180;
    const z = 0.29;
    return [
      -(z - 0.62) * Math.sin(angle),
      -0.24 + i * 0.12,
      0.62 + (z - 0.62) * Math.cos(angle),
    ] as const;
  }),
);
