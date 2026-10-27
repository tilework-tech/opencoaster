import type { ToolMode } from '../../ui/ui-types';

/**
 * Whether the land overlay (unowned land and its sale borders) shows: while the land tool or a
 * land or construction-rights purchase tool is selected, as in RCT2, and never in normal play.
 */
export function showsLandOverlay(tool: ToolMode): boolean {
  return tool === 'land' || tool === 'buy-land' || tool === 'buy-rights';
}
