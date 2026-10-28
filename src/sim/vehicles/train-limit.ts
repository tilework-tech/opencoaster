import { CAR_LENGTH_Q8 } from './vehicle-system';

/** Most trains a coaster runs at once, however many block sections or how much track it has. */
export const MAX_TRAINS_PER_RIDE = 16;

/** Track an unsectioned circuit keeps per train: the train itself plus two train lengths of gap. */
export const TRAIN_FOOTPRINT_LENGTHS = 3;

export interface TrainLimitInput {
  /** The ride runs in block-sectioned mode, so block sections separate its trains. */
  blockSectioned: boolean;
  /** Block-section boundaries of a closed circuit: its station plus its block brakes. */
  sections: number;
  /** Track is a closed circuit; open track runs a single train. */
  loop: boolean;
  /** Cars in each train. */
  cars: number;
  trackLengthQ8: number;
}

/**
 * Most trains a track ride runs at once. A block-sectioned circuit holds one train per section
 * and keeps one section empty so the trains can move; an unsectioned circuit holds as many
 * trains as fit with a gap of two train lengths between them.
 */
export function trainLimit(input: TrainLimitInput): number {
  if (!input.loop) return 1;
  const fits = input.blockSectioned
    ? input.sections - 1
    : Math.floor(input.trackLengthQ8 / (TRAIN_FOOTPRINT_LENGTHS * input.cars * CAR_LENGTH_Q8));
  return Math.max(1, Math.min(MAX_TRAINS_PER_RIDE, fits));
}
