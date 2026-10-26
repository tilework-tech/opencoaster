import type { SimClient } from '../../worker/sim-client';
import type { GameUI, ToolMode } from '../../ui/game-ui';
import { PathAddition } from '../../sim/map/paths';
import type { SceneryItem } from '../../sim/map/scenery';
import type { PathTool } from './path/controller';
import {
  LAND_PRICE_CENTS,
  OWNED,
  RIGHTS_OWNED,
  RIGHTS_PRICE_CENTS,
  SALE_LAND,
  SALE_RIGHTS,
} from '../../sim/map/tile-map';
import { formatMoney } from '../../ui/format';

export interface ToolHandlerDependencies {
  sim: SimClient;
  gameUi: GameUI;
  selectedTool: () => ToolMode;
  alternate: () => boolean;
  pathTool: PathTool;
  sceneryItem: () => SceneryItem;
  sceneryRotation: () => number;
  patrolStaffId: () => number | null;
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
  const staffId = deps.patrolStaffId();
  if (staffId === null) {
    deps.gameUi.setToolStatus('Open a worker window and choose Edit patrol area first.');
    return;
  }
  const remove = shiftKey || deps.alternate();
  deps.sim.command({ type: 'setStaffPatrolTile', staffId, x, y, enabled: !remove });
  deps.gameUi.setToolStatus(
    `${remove ? 'Patrol tile removed from' : 'Patrol tile added to'} ${x}, ${y}.`,
  );
}

export function handleLandPurchase(
  deps: ToolHandlerDependencies,
  x: number,
  y: number,
  rights: boolean,
): void {
  const map = deps.sim.map;
  if (!map) return;
  const flags = map.ownership[y * map.width + x] ?? 0;
  const sale = rights ? SALE_RIGHTS : SALE_LAND;
  const have = rights ? OWNED | RIGHTS_OWNED : OWNED;
  if (!(flags & sale) || flags & have) {
    deps.gameUi.setToolStatus(`Tile ${x}, ${y} is not available for that purchase.`);
    return;
  }
  const price = rights ? RIGHTS_PRICE_CENTS : LAND_PRICE_CENTS;
  if ((deps.sim.latest?.park.cash ?? 0) < price) {
    deps.gameUi.setToolStatus('Not enough cash to buy this tile.');
    return;
  }
  deps.sim.command({ type: 'buyLand', x, y, width: 1, height: 1, rights });
  deps.gameUi.setToolStatus(
    `${rights ? 'Construction rights' : 'Land'} purchase requested at tile ${x}, ${y} for ${formatMoney(price)}.`,
  );
}
