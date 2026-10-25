import { box } from '../../mesh';
import type { FacilityModel } from './common';
import { counterBooth, facilityMaterials as m, signPlaque, stripedCanopy } from './common';

export const foodStall: FacilityModel = {
  key: 'facilities/food-stall',
  frames: 4,
  build(frame) {
    return [
      ...counterBooth(m.timber, m.red, frame),
      ...stripedCanopy(m.red, m.white, frame),
      ...box([-0.24, 0.3, 0.24], [-0.15, 0.315, 0.32], m.yellow),
      ...signPlaque(m.red, frame, 0.12, 0.28),
    ];
  },
};
