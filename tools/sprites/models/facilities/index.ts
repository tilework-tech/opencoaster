import type { FacilityModel } from './common';
import { foodStall } from './food-stall';
import { drinkStall } from './drink-stall';
import { burgerStall } from './burger-stall';
import { informationKiosk } from './information-kiosk';
import { toilets } from './toilets';

export const FACILITY_MODELS: readonly FacilityModel[] = [
  foodStall,
  drinkStall,
  burgerStall,
  informationKiosk,
  toilets,
];
