import { box, cylinder } from '../../mesh';
import type { FacilityModel } from './common';
import { facilityMaterials as m, signPlaque } from './common';

export const burgerStall: FacilityModel = {
  key: 'facilities/burger-stall',
  frames: 4,
  build(frame) {
    return [
      ...box([-0.33, -0.28, 0], [0.33, 0.28, 0.31], m.red),
      ...box([-0.36, 0.18, 0.16], [0.36, 0.31, 0.19], m.wood),
      ...cylinder(0, 0, 0.31, 0.39, 0.37, 0.37, 12, m.green),
      ...cylinder(0, 0, 0.39, 0.45, 0.35, 0.35, 12, m.wood),
      ...cylinder(0, 0, 0.45, 0.52, 0.34, 0.29, 12, m.yellow),
      ...cylinder(0, 0, 0.52, 0.57, 0.29, 0.21, 12, m.orange),
      ...signPlaque(m.red, frame, -0.2, 0.2),
    ];
  },
};
