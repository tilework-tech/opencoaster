import { box, quad } from '../../mesh';
import type { FacilityModel } from './common';
import { facilityMaterials as m, signPlaque, stripedCanopy } from './common';

export const drinkStall: FacilityModel = {
  key: 'facilities/drink-stall',
  frames: 4,
  build(frame) {
    return [
      ...box([-0.34, -0.3, 0], [0.34, 0.3, 0.38], m.blue),
      ...box([-0.38, -0.34, 0.38], [0.38, 0.34, 0.43], m.white),
      ...box([-0.36, 0.21, 0.17], [0.36, 0.34, 0.2], m.wood),
      ...box([-0.09, 0.295, 0.02], [0.09, 0.32, 0.17], m.wood),
      ...stripedCanopy(m.blue, m.white, frame),
      ...quad(
        [
          [-0.3, -0.305, 0.22],
          [0.3, -0.305, 0.22],
          [0.3, -0.305, 0.36],
          [-0.3, -0.305, 0.36],
        ],
        m.white,
      ),
      ...signPlaque(m.blue, frame),
    ];
  },
};
