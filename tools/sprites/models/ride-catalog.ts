import { RIDE_MODELS as BASE_RIDE_MODELS } from './rides';
import type { RideModel } from './rides';
import { model as enterprise } from './rides/enterprise';
import { model as ferrisWheel } from './rides/ferris-wheel';
import { model as goKarts } from './rides/go-karts';
import { model as hauntedHouse } from './rides/haunted-house';
import { model as merryGoRound } from './rides/merry-go-round';
import { model as observationTower } from './rides/observation-tower';
import { model as spiralSlide } from './rides/spiral-slide';
import { model as swingingShip } from './rides/swinging-ship';
import { model as topSpin } from './rides/top-spin';
import { model as twist } from './rides/twist';

const detailedRideModels = [
  merryGoRound,
  swingingShip,
  ferrisWheel,
  twist,
  hauntedHouse,
  spiralSlide,
  topSpin,
  enterprise,
  goKarts,
  observationTower,
];
const detailedRideKeys = new Set(detailedRideModels.map((model) => model.key));

export const RIDE_MODELS: readonly RideModel[] = [
  ...BASE_RIDE_MODELS.filter((model) => !detailedRideKeys.has(model.key)),
  ...detailedRideModels,
];
