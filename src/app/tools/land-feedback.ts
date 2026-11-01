import { LandResult } from '../../sim/map/land-tool';
import { RESTRICTION_REFUSALS } from '../../sim/scenario/restrictions';
import { formatMoney } from '../../ui/format';
import type { LandMode } from '../../ui/ui-types';

const REFUSAL_TEXT: Record<Exclude<LandResult, LandResult.Ok>, string> = {
  [LandResult.OutOfBounds]: 'That is outside the park map.',
  [LandResult.NotOwned]: 'Land not owned by park!',
  [LandResult.NoChange]: 'Nothing to change here.',
  [LandResult.TooHigh]: 'Too high!',
  [LandResult.TooLow]: 'Too low!',
  [LandResult.RideInTheWay]: 'Ride or attraction in the way.',
  [LandResult.EntranceInTheWay]: 'Entrance or exit in the way.',
  [LandResult.ObjectInTheWay]: 'Object in the way.',
  [LandResult.PathInTheWay]: 'Footpath in the way: the ground would not suit it.',
  [LandResult.InsufficientFunds]: 'Not enough cash.',
  [LandResult.InvalidEdit]: 'That land change is not valid.',
  [LandResult.WaterSpills]: 'Water would spill over the bank: dig a basin or raise the edge.',
  [LandResult.WaterLevelClash]: 'Water would meet a lake at a higher level.',
  [LandResult.LandscapingForbidden]: RESTRICTION_REFUSALS.landscaping,
  [LandResult.TreesProtected]: RESTRICTION_REFUSALS.trees,
  [LandResult.HeightLimit]: RESTRICTION_REFUSALS.groundDrop,
};

export function landRefusalText(result: Exclude<LandResult, LandResult.Ok>): string {
  return REFUSAL_TEXT[result] ?? 'Land cannot be changed here.';
}

const VERB: Record<LandMode, string> = {
  raise: 'Raise land',
  lower: 'Lower land',
  flatten: 'Flatten land',
  smooth: 'Smooth land',
};

/** Cursor tooltip for a preview: the price of the change, or why it is refused. */
export function landPreviewText(mode: LandMode, result: LandResult, costCents: number): string {
  if (result === LandResult.Ok) return `${VERB[mode]}: ${formatMoney(costCents)}`;
  return landRefusalText(result);
}
