import { describe, expect, it } from 'vitest';
import { MAX_TRAINS_PER_RIDE } from './ride-trains';
import { trainLimit } from './train-limit';
import { CAR_LENGTH_Q8 } from './vehicle-system';

const CIRCUIT = { loop: true, cars: 2, trackLengthQ8: 40 * CAR_LENGTH_Q8 };

describe('trainLimit', () => {
  describe('block-sectioned circuit', () => {
    it('allows one train per block section but one: stations plus block brakes, minus one', () => {
      expect(trainLimit({ ...CIRCUIT, blockSectioned: true, sections: 4 })).toBe(3);
      expect(trainLimit({ ...CIRCUIT, blockSectioned: true, sections: 2 })).toBe(1);
    });

    it('allows a single train with no block brakes, however long the track', () => {
      expect(trainLimit({ ...CIRCUIT, blockSectioned: true, sections: 1 })).toBe(1);
      expect(trainLimit({ ...CIRCUIT, blockSectioned: true, sections: 0 })).toBe(1);
    });

    it('does not depend on track or train length', () => {
      const short = { ...CIRCUIT, trackLengthQ8: 10 * CAR_LENGTH_Q8, cars: 5 };
      expect(trainLimit({ ...short, blockSectioned: true, sections: 4 })).toBe(3);
    });

    it('caps at the per-ride train limit', () => {
      expect(trainLimit({ ...CIRCUIT, blockSectioned: true, sections: 100 })).toBe(
        MAX_TRAINS_PER_RIDE,
      );
    });
  });

  describe('continuous circuit', () => {
    it('ignores block brakes', () => {
      const without = trainLimit({ ...CIRCUIT, blockSectioned: false, sections: 1 });
      expect(trainLimit({ ...CIRCUIT, blockSectioned: false, sections: 5 })).toBe(without);
    });

    it('allows several trains on a long circuit with no block brakes', () => {
      expect(trainLimit({ ...CIRCUIT, blockSectioned: false, sections: 1 })).toBeGreaterThan(1);
    });

    it('fits fewer trains as they get longer', () => {
      const short = trainLimit({ ...CIRCUIT, cars: 1, blockSectioned: false, sections: 1 });
      const long = trainLimit({ ...CIRCUIT, cars: 5, blockSectioned: false, sections: 1 });
      expect(long).toBeLessThan(short);
    });

    it('fits fewer trains on shorter track and always at least one', () => {
      const tiny = { ...CIRCUIT, trackLengthQ8: 3 * CAR_LENGTH_Q8, blockSectioned: false };
      expect(trainLimit({ ...tiny, sections: 1 })).toBe(1);
      const half = trainLimit({
        ...CIRCUIT,
        trackLengthQ8: 20 * CAR_LENGTH_Q8,
        blockSectioned: false,
        sections: 1,
      });
      expect(half).toBeLessThan(trainLimit({ ...CIRCUIT, blockSectioned: false, sections: 1 }));
    });

    it('caps at the per-ride train limit', () => {
      const huge = { ...CIRCUIT, trackLengthQ8: 100000 * CAR_LENGTH_Q8, blockSectioned: false };
      expect(trainLimit({ ...huge, sections: 1 })).toBe(MAX_TRAINS_PER_RIDE);
    });
  });

  it('runs one train on track that is not a circuit', () => {
    expect(trainLimit({ ...CIRCUIT, loop: false, blockSectioned: false, sections: 1 })).toBe(1);
    expect(trainLimit({ ...CIRCUIT, loop: false, blockSectioned: true, sections: 4 })).toBe(1);
  });
});
