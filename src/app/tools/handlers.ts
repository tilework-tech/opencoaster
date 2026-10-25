import type { SimClient } from '../../worker/sim-client';
import type { GameUI, ToolMode } from '../../ui/game-ui';
import { PathAddition } from '../../sim/map/paths';
import type { SceneryItem } from '../../sim/map/scenery';
import type { PathTool } from './path/controller';

export interface ToolHandlerDependencies {
  sim: SimClient;
  gameUi: GameUI;
  selectedTool: () => ToolMode;
  alternate: () => boolean;
  pathTool: PathTool;
  sceneryItem: () => SceneryItem;
  sceneryRotation: () => number;
  patrolKind: () => number | null;
}

export function handlePathTool(deps: ToolHandlerDependencies, x: number, y: number): void {
  if (deps.alternate()) {
    deps.sim.command({ type: 'removePath', x, y });
    deps.gameUi.setToolStatus(`Path removal requested at ${x}, ${y}.`);
    return;
  }
  deps.pathTool.tap({ x, y });
}

export function handleSceneryTool(
  deps: ToolHandlerDependencies,
  x: number,
  y: number,
  shiftKey: boolean,
): void {
  const remove = shiftKey || deps.alternate();
  deps.sim.command(
    remove
      ? { type: 'removeScenery', x, y }
      : { type: 'placeScenery', x, y, item: deps.sceneryItem(), rotation: deps.sceneryRotation() },
  );
  deps.gameUi.setToolStatus(
    `${remove ? 'Scenery removal' : 'Scenery placement'} requested at ${x}, ${y}.`,
  );
}

export function handlePathAdditionTool(deps: ToolHandlerDependencies, x: number, y: number): void {
  const tool = deps.selectedTool();
  const addition =
    tool === 'bin'
      ? PathAddition.Bin
      : tool === 'bench'
        ? PathAddition.Bench
        : tool === 'shelter'
          ? PathAddition.Shelter
          : PathAddition.Lamp;
  deps.sim.command({ type: 'setPathAddition', x, y, addition });
  deps.gameUi.setToolStatus(`${tool} placement requested at ${x}, ${y}.`);
}

export function handleFlowerbedTool(
  deps: ToolHandlerDependencies,
  x: number,
  y: number,
  shiftKey: boolean,
): void {
  const remove = shiftKey || deps.alternate();
  deps.sim.command({ type: 'setFlowerBed', x, y, enabled: !remove });
  deps.gameUi.setToolStatus(
    `${remove ? 'Flower bed removal' : 'Flower bed planting'} requested at ${x}, ${y}.`,
  );
}

export function handlePatrolTool(
  deps: ToolHandlerDependencies,
  x: number,
  y: number,
  shiftKey: boolean,
): void {
  const kind = deps.patrolKind();
  if (kind === null) {
    deps.gameUi.setToolStatus('Choose a staff role or person in the Staff panel first.');
    return;
  }
  const remove = shiftKey || deps.alternate();
  deps.sim.command({ type: 'setStaffKindPatrolTile', kind, x, y, enabled: !remove });
  deps.gameUi.setToolStatus(
    `${remove ? 'Patrol tile removed from' : 'Patrol tile added to'} ${x}, ${y}.`,
  );
}
