import { withRiders } from './common';

export const model = withRiders('Haunted House', (frame) => {
  const offset = [-0.07, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.07][frame];
  return [
    [-0.42 + offset, 0.42, 0.02],
    [0.42 + offset, 0.42, 0.02],
    [0.42, -0.42 + offset, 0.02],
    [-0.42, 0.42 + offset, 0.02],
  ];
});
