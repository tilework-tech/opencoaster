import { box } from '../../mesh';
import type { FacilityModel } from './common';
import { facilityMaterials as m, signPlaque, toppedDrum } from './common';

export const drinkStall: FacilityModel = {
  key: 'facilities/drink-stall',
  frames: 4,
  build(frame) {
    return [
      ...toppedDrum(m.red, m.white),
      ...box([-0.16, 0.27, 0.2], [0.16, 0.315, 0.31], m.white),
      ...box([-0.04, 0.3, 0.29], [0.04, 0.31, 0.43], m.yellow),
      ...signPlaque(m.blue, frame, -0.15, 0.15),
    ];
  },
};
