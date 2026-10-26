import { LandResult } from '../../sim/map/land-tool';
import type { AreaPlan } from '../../sim/map/area-tools';
import { formatMoney } from '../../ui/format';
import { landRefusalText } from './land-feedback';

export type AreaTool = 'clear' | 'water';

const CLEAR_TEXT: Partial<Record<LandResult, string>> = {
  [LandResult.NoChange]: 'Nothing to clear here.',
};

const WATER_TEXT: Partial<Record<LandResult, string>> = {
  [LandResult.TooHigh]: 'Water is as high as it can go.',
  [LandResult.WaterSpills]: 'Water would spill over the bank: dig a basin or raise the edge.',
  [LandResult.WaterLevelClash]: 'Water would meet a lake at a higher level.',
  [LandResult.TooLow]: 'No water to lower here.',
  [LandResult.PathInTheWay]: 'Footpath in the way.',
};

export function areaRefusalText(
  tool: AreaTool,
  result: Exclude<LandResult, LandResult.Ok>,
): string {
  return (tool === 'clear' ? CLEAR_TEXT : WATER_TEXT)[result] ?? landRefusalText(result);
}

/** Cursor tooltip for a preview: what the step does and its price, or why it is refused. */
export function areaPreviewText(tool: AreaTool, lower: boolean, plan: AreaPlan): string {
  if (plan.result !== LandResult.Ok) return areaRefusalText(tool, plan.result);
  if (tool === 'water') {
    const tiles = `${plan.tiles.length} ${plan.tiles.length === 1 ? 'tile' : 'tiles'}`;
    return `${lower ? 'Lower' : 'Raise'} water, ${tiles}: ${formatMoney(plan.costCents)}`;
  }
  const items = `${plan.removed} ${plan.removed === 1 ? 'item' : 'items'}`;
  return `Clear ${items}: ${formatMoney(plan.costCents)}`;
}
