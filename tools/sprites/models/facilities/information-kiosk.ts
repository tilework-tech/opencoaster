import { box, polygon, quad } from '../../mesh';
import type { Mesh } from '../../mesh';
import type { FacilityModel } from './common';
import { facilityMaterials as m } from './common';

function mapBoard(frame: number): Mesh {
  const accent = frame % 2 === 0 ? m.yellow : m.white;
  return [
    ...box([-0.23, 0.29, 0.12], [0.23, 0.33, 0.43], m.blue),
    ...quad(
      [
        [-0.18, 0.335, 0.17],
        [0.18, 0.335, 0.17],
        [0.18, 0.335, 0.38],
        [-0.18, 0.335, 0.38],
      ],
      m.white,
    ),
    ...box([-0.14, 0.34, 0.2], [0.02, 0.35, 0.23], m.green),
    ...box([0.06, 0.34, 0.2], [0.14, 0.35, 0.23], accent),
    ...box([-0.14, 0.34, 0.26], [0.14, 0.35, 0.29], m.orange),
    ...box([-0.14, 0.34, 0.32], [0.08, 0.35, 0.35], m.red),
  ];
}

export const informationKiosk: FacilityModel = {
  key: 'facilities/information-kiosk',
  frames: 4,
  build(frame) {
    return [
      ...box([-0.3, -0.3, 0], [0.3, 0.3, 0.27], m.wood),
      ...box([-0.38, -0.38, 0.27], [0.38, 0.38, 0.32], m.white),
      ...polygon(
        [
          [-0.4, -0.4, 0.32],
          [0.4, -0.4, 0.32],
          [0, 0, 0.58],
        ],
        m.blue,
      ),
      ...polygon(
        [
          [0.4, -0.4, 0.32],
          [0.4, 0.4, 0.32],
          [0, 0, 0.58],
        ],
        m.blue,
      ),
      ...polygon(
        [
          [0.4, 0.4, 0.32],
          [-0.4, 0.4, 0.32],
          [0, 0, 0.58],
        ],
        m.blue,
      ),
      ...polygon(
        [
          [-0.4, 0.4, 0.32],
          [-0.4, -0.4, 0.32],
          [0, 0, 0.58],
        ],
        m.blue,
      ),
      ...mapBoard(frame),
      ...box([-0.04, -0.34, 0.2], [0.04, -0.3, 0.26], m.yellow),
    ];
  },
};
