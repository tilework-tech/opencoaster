import { TRANSPORT_PIECES } from '../../../src/sim/track/catalog';
import { CHAIRLIFT_STYLE } from './chairlift';
import { MINIATURE_RAILWAY_STYLE } from './miniature-railway';
import { MONORAIL_STYLE } from './monorail';
import type { TransportStyle } from './transport-track';

/** Track and vehicle styles of the transport rides, one per ride family. */
export const TRANSPORT_STYLES: readonly TransportStyle[] = [
  MINIATURE_RAILWAY_STYLE,
  MONORAIL_STYLE,
  CHAIRLIFT_STYLE,
];

export { TRANSPORT_PIECES };
