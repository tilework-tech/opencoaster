import { RideType } from './ride-types';

/**
 * How much each open ride type adds to the park's suggested guest maximum (RCT2's ride-type
 * "bonus value"). Stalls and facilities count too, at much smaller values.
 */
export const RIDE_BONUS_VALUE: Readonly<Record<RideType, number>> = {
  [RideType.MerryGoRound]: 45,
  [RideType.SwingingShip]: 35,
  [RideType.FerrisWheel]: 45,
  [RideType.Twist]: 40,
  [RideType.FoodStall]: 15,
  [RideType.DrinkStall]: 15,
  [RideType.InformationKiosk]: 15,
  [RideType.Toilets]: 5,
  [RideType.WoodenCoaster]: 105,
  [RideType.SteelLoopingCoaster]: 95,
  [RideType.HauntedHouse]: 22,
  [RideType.SpiralSlide]: 40,
  [RideType.TopSpin]: 55,
  [RideType.Enterprise]: 45,
  [RideType.GoKarts]: 55,
  [RideType.LogFlume]: 65,
  [RideType.RiverRapids]: 70,
  [RideType.MiniatureRailway]: 50,
  [RideType.Monorail]: 60,
  [RideType.Chairlift]: 55,
  [RideType.JuniorRollerCoaster]: 60,
  [RideType.WildMouseCoaster]: 55,
  [RideType.ObservationTower]: 45,
  [RideType.BurgerStall]: 15,
};
