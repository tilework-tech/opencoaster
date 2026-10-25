import { box } from '../../mesh';
import type { FacilityModel } from './common';
import { facilityMaterials as m } from './common';

export const toilets: FacilityModel = {
  key: 'facilities/toilets',
  frames: 4,
  build(frame) {
    return [
      ...box([-0.38, -0.34, 0], [0.38, 0.34, 0.45], m.stone),
      ...box([-0.42, -0.38, 0.45], [0.42, 0.38, 0.51], frame % 2 === 0 ? m.brick : m.red),
      ...box([-0.25, 0.34, 0.03], [-0.04, 0.37, 0.33], m.blue),
      ...box([0.04, 0.34, 0.03], [0.25, 0.37, 0.33], m.purple),
      ...box([-0.2, 0.37, 0.09], [-0.09, 0.38, 0.28], m.white),
      ...box([0.09, 0.37, 0.09], [0.2, 0.38, 0.28], m.white),
      ...box([-0.1, 0.34, 0.36], [0.1, 0.37, 0.44], m.yellow),
    ];
  },
};
