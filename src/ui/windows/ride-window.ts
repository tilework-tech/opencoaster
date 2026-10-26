import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import { MAX_CARS, MAX_TRAINS_PER_RIDE } from '../../sim/vehicles/ride-trains';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, gauge, iconButton, setText, statRow } from '../dom';
import { SampleSeries, drawChart, formatMoney } from '../format';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';
import { RIDE_STATE_NAMES } from './ride-list';
import { priceControl } from './price-control';
import { drawAnchoredSprite } from '../../render/canvas-atlas';
import { spritePages } from '../../render/sprite-pages';
import { rideHutSpriteKey, rideSpriteFrame, rideSpriteKey } from '../../render/world-art';

export const RIDE_WINDOW_TABS: readonly TabSpec[] = [
  { id: 'main', label: 'View', icon: 'rides' },
  { id: 'vehicle', label: 'Description', icon: 'coaster' },
  { id: 'operating', label: 'Mechanics', icon: 'options' },
  { id: 'maintenance', label: 'Maintenance record', icon: 'build' },
  { id: 'measurements', label: 'Ride statistics', icon: 'info' },
  { id: 'graphs', label: 'Data log', icon: 'map' },
  { id: 'income', label: 'Financial data', icon: 'finances' },
  { id: 'customers', label: 'Guest data', icon: 'guests' },
];

const TICKS_PER_SECOND = 40;
const GRAPH_INTERVAL_TICKS = 40;

function seconds(ticks: number): string {
  return `${(ticks / TICKS_PER_SECOND).toFixed(1)} s`;
}

/** A ride's window with the eight information tabs. Closes itself when the ride is demolished. */
export function openRideWindow(ctx: UiContext, rideId: number): WindowController {
  const id = `ride-${rideId}`;
  const { window: win, created } = ctx.windows.open({
    id,
    title: `Ride #${rideId}`,
    kind: 'ride',
    width: 340,
    tabs: RIDE_WINDOW_TABS,
  });
  const queueSeries = new SampleSeries(120, GRAPH_INTERVAL_TICKS);
  const servedSeries = new SampleSeries(120, GRAPH_INTERVAL_TICKS);
  const p = (tab: string): HTMLElement => win.pane(tab);

  const status = element('div', 'ride-status');
  const preview = element('canvas', 'ride-preview');
  preview.width = 360;
  preview.height = 180;
  preview.setAttribute('role', 'img');
  preview.setAttribute('aria-label', 'Ride preview');
  spritePages.start();
  let rideX: number | null = null;
  let rideY: number | null = null;
  let rideName = `Ride #${rideId}`;
  let refund = 0;
  status.setAttribute('role', 'status');
  const excitement = gauge('Excitement');
  const intensity = gauge('Intensity');
  const nausea = gauge('Nausea');
  const statusButtons = element('div', 'button-row');
  const setStatus = (value: 'open' | 'close' | 'test') => () =>
    ctx.actions.setRideStatus(rideId, value);
  statusButtons.append(
    button('Open', setStatus('open'), 'ui-button'),
    button('Close', setStatus('close'), 'ui-button'),
    button('Test', setStatus('test'), 'ui-button'),
  );
  const demolish = iconButton(
    'demolish',
    'Demolish ride',
    () => {
      if (window.confirm(`Demolish ${rideName}? Refund: ${formatMoney(refund)}`))
        ctx.actions.demolishRide(rideId);
    },
    'ui-button danger',
    'Demolish',
  );
  const partButtons = element('div', 'button-row');
  partButtons.append(
    button('Place entrance', () => ctx.actions.placeRidePart(rideId, 'entrance'), 'ui-button'),
    button('Place exit', () => ctx.actions.placeRidePart(rideId, 'exit'), 'ui-button'),
  );
  const buildTrack = button('Edit track', () => ctx.actions.editTrack(rideId), 'ui-button');
  const locate = button(
    'Locate',
    () => {
      if (rideX !== null && rideY !== null) ctx.actions.locate(rideX, rideY);
    },
    'ui-button',
  );
  const mainFacts = {
    queue: statRow('Queue'),
    wait: statRow('Wait time'),
    served: statRow('Guests served'),
    setup: statRow('Setup'),
  };
  const limit = { natural: 0, current: 0 };
  const limitValue = element('span', 'stat-value', '');
  const setLimit = (value: number): void => ctx.actions.setRideQueueLimit(rideId, value);
  const limitRow = element('div', 'stat-row ride-queue-limit');
  limitRow.append(
    element('span', 'stat-label', 'Queue limit'),
    iconButton('minus', 'Shorten queue limit', () =>
      setLimit(Math.max(1, (limit.current > 0 ? limit.current : limit.natural) - 1)),
    ),
    limitValue,
    iconButton('plus', 'Lengthen queue limit', () =>
      setLimit(limit.current > 0 ? limit.current + 1 : 0),
    ),
  );
  const checklist = element('div', 'ride-checklist');
  let checklistSignature = '';

  const vehicle = {
    type: statRow('Type'),
    capacity: statRow('Guests per dispatch'),
    cost: statRow('Build cost'),
  };
  const operating = {
    load: statRow('Loading time'),
    run: statRow('Ride time'),
    unload: statRow('Unloading time'),
  };
  const trainsInput = element('input', 'count-input');
  trainsInput.type = 'number';
  trainsInput.min = '0';
  trainsInput.max = String(MAX_TRAINS_PER_RIDE);
  trainsInput.value = '0';
  trainsInput.setAttribute('aria-label', 'Trains on the track (0 for automatic)');
  const carsInput = element('input', 'count-input');
  carsInput.type = 'number';
  carsInput.min = '0';
  carsInput.max = String(MAX_CARS);
  carsInput.value = '0';
  carsInput.setAttribute('aria-label', 'Cars per train (0 for default)');
  const trainsRow = element('div', 'button-row');
  trainsRow.append(
    trainsInput,
    carsInput,
    button(
      'Set trains',
      () => ctx.actions.setRideTrains(rideId, Number(trainsInput.value), Number(carsInput.value)),
      'ui-button',
    ),
  );
  const reliability = gauge('Reliability');
  const maintenance = { inspect: statRow('Inspection interval'), breakdowns: statRow('Condition') };
  const measurements = {
    tested: statRow('Test status'),
    excitement: statRow('Excitement'),
    intensity: statRow('Intensity'),
    nausea: statRow('Nausea'),
    pieces: statRow('Track'),
  };
  const queueChart = element('canvas', 'chart');
  queueChart.width = 300;
  queueChart.height = 90;
  const servedChart = element('canvas', 'chart');
  servedChart.width = 300;
  servedChart.height = 90;
  const price = priceControl('Ride price', (cents) => ctx.actions.setRidePrice(rideId, cents));
  const income = { total: statRow('Total income'), perGuest: statRow('Income per guest') };
  const customers = { served: statRow('Guests served'), waiting: statRow('Waiting in queue') };

  if (created) {
    p('main').append(
      preview,
      status,
      statusButtons,
      demolish,
      excitement.row,
      intensity.row,
      nausea.row,
      mainFacts.queue.row,
      mainFacts.wait.row,
      limitRow,
      mainFacts.served.row,
      mainFacts.setup.row,
      checklist,
      partButtons,
      buildTrack,
      locate,
    );
    p('vehicle').append(
      vehicle.type.row,
      vehicle.capacity.row,
      vehicle.cost.row,
      element('p', 'ui-help', 'Vehicle choice is fixed for each ride type in this version.'),
    );
    p('operating').append(
      operating.load.row,
      operating.run.row,
      operating.unload.row,
      element('p', 'ui-help', 'Trains and cars per train (0 for automatic)'),
      trainsRow,
    );
    p('maintenance').append(
      reliability.row,
      maintenance.inspect.row,
      maintenance.breakdowns.row,
      element(
        'p',
        'ui-help',
        'Hire mechanics in the Staff window; they inspect and repair rides they can reach.',
      ),
    );
    p('measurements').append(
      measurements.tested.row,
      measurements.excitement.row,
      measurements.intensity.row,
      measurements.nausea.row,
      measurements.pieces.row,
    );
    p('graphs').append(
      element('p', 'ui-help', 'Queue length'),
      queueChart,
      element('p', 'ui-help', 'Guests served'),
      servedChart,
    );
    p('income').append(
      element('p', 'ui-help', 'Ticket price'),
      price.root,
      income.total.row,
      income.perGuest.row,
    );
    p('customers').append(customers.served.row, customers.waiting.row);
  }

  return {
    update(snapshot: Snapshot | null) {
      if (!snapshot) return;
      const row = findRow(snapshot, rideId);
      if (row === null) {
        ctx.windows.close(id);
        return;
      }
      const o = row * RIDE_INFO_STRIDE;
      const info = snapshot.rideInfo;
      rideX = info[o + RideInfo.RideX];
      rideY = info[o + RideInfo.RideY];
      const type = info[o + RideInfo.Type];
      const def = RIDE_CATALOG[type as keyof typeof RIDE_CATALOG];
      const flags = info[o + RideInfo.Flags];
      refund = info[o + RideInfo.DemolitionRefund];
      rideName = `${def?.name ?? 'Ride'} #${rideId}`;
      const tested = (flags & RideFlag.Tested) !== 0;
      const state = info[o + RideInfo.State];
      win.setTitle(rideName);
      preview.setAttribute('aria-label', `${rideName} preview`);
      const previewContext = preview.getContext('2d');
      if (previewContext && def) {
        previewContext.clearRect(0, 0, preview.width, preview.height);
        previewContext.save();
        previewContext.translate(preview.width / 2, preview.height - 12);
        previewContext.scale(1.5, 1.5);
        const rotation = ctx.actions.camera().rotation;
        const key =
          def.category === 'coaster'
            ? rideHutSpriteKey(type as keyof typeof RIDE_CATALOG, 'entrance', 1, rotation)
            : rideSpriteKey(type as keyof typeof RIDE_CATALOG, rotation);
        const frame = spritePages.resolve(key);
        drawAnchoredSprite(
          previewContext,
          spritePages,
          key,
          0,
          0,
          rideSpriteFrame(state, snapshot.tick, frame?.frames.length ?? 1),
        );
        previewContext.restore();
      }
      setText(status, `${RIDE_STATE_NAMES[state] ?? ''}`);
      excitement.set(
        info[o + RideInfo.Excitement] / 1000,
        tested ? (info[o + RideInfo.Excitement] / 100).toFixed(2) : 'not tested',
      );
      intensity.set(
        info[o + RideInfo.Intensity] / 1000,
        tested ? (info[o + RideInfo.Intensity] / 100).toFixed(2) : 'not tested',
      );
      nausea.set(
        info[o + RideInfo.Nausea] / 1000,
        tested ? (info[o + RideInfo.Nausea] / 100).toFixed(2) : 'not tested',
      );
      const capacity = info[o + RideInfo.QueueCapacity];
      setText(
        mainFacts.queue.value,
        flags & RideFlag.HasQueue
          ? `${info[o + RideInfo.QueueLength]} of ${capacity}`
          : String(info[o + RideInfo.QueueLength]),
      );
      limit.current = info[o + RideInfo.QueueLimit];
      limit.natural = limit.current > 0 ? limit.natural : capacity;
      setText(limitValue, limit.current > 0 ? `${limit.current} guests` : 'None');
      limitRow.hidden = def?.category === 'stall' || def?.category === 'facility';
      setText(
        mainFacts.wait.value,
        `${Math.round(info[o + RideInfo.WaitTicks] / TICKS_PER_SECOND)} s`,
      );
      setText(mainFacts.served.value, String(info[o + RideInfo.GuestsServed]));
      const blockers: { label: string; action: string; onClick: () => void }[] = [];
      const serviceRide = def?.category === 'stall' || def?.category === 'facility';
      if (!(flags & RideFlag.EntrancePlaced)) {
        blockers.push(
          serviceRide
            ? {
                label: 'No path access',
                action: 'Build path',
                onClick: () => {
                  ctx.actions.footpath.setQueue(false);
                  ctx.chooseTool('path');
                },
              }
            : {
                label: 'No entrance',
                action: 'Place entrance',
                onClick: () => ctx.actions.placeRidePart(rideId, 'entrance'),
              },
        );
      }
      const needsExit = def?.category !== 'stall' && def?.category !== 'facility';
      if (needsExit && !(flags & RideFlag.ExitPlaced))
        blockers.push({
          label: 'No exit',
          action: 'Place exit',
          onClick: () => ctx.actions.placeRidePart(rideId, 'exit'),
        });
      if (needsExit && flags & RideFlag.EntrancePlaced && !(flags & RideFlag.QueueConnected))
        blockers.push({
          label:
            info[o + RideInfo.QueueTiles] > 0
              ? 'Queue line is not joined to a path'
              : 'Entrance has no queue or path',
          action: 'Build queue',
          onClick: () => ctx.actions.buildRideQueue(rideId),
        });
      if (needsExit && !(flags & RideFlag.EntrancePlaced) && snapshot.park.orphanQueueTiles > 0)
        blockers.push({
          label: 'A queue line is not linked to any ride entrance',
          action: 'Place entrance',
          onClick: () => ctx.actions.placeRidePart(rideId, 'entrance'),
        });
      if (def?.usesTrack && !tested)
        blockers.push({
          label: 'Untested',
          action: 'Test ride',
          onClick: () => ctx.actions.setRideStatus(rideId, 'test'),
        });
      const signature = blockers.map((blocker) => `${blocker.label}:${blocker.action}`).join('|');
      if (signature !== checklistSignature) {
        checklistSignature = signature;
        checklist.replaceChildren(
          ...blockers.map((blocker) => {
            const row = element('div', 'ride-checklist-item');
            row.append(element('span', 'ride-checklist-label', blocker.label));
            row.append(button(blocker.action, blocker.onClick, 'ui-button'));
            return row;
          }),
        );
      }
      const missing = blockers.map((blocker) => blocker.label);
      setText(mainFacts.setup.value, missing.length ? missing.join(' · ') : 'Ride setup complete');
      buildTrack.hidden = !def?.usesTrack;
      trainsRow.hidden = !def?.usesTrack;
      partButtons.hidden = serviceRide;

      setText(vehicle.type.value, def?.name ?? 'Ride');
      setText(vehicle.capacity.value, String(def?.capacity ?? 0));
      setText(vehicle.cost.value, formatMoney(def?.cost ?? 0));
      setText(operating.load.value, seconds(def?.loadTicks ?? 0));
      setText(
        operating.run.value,
        def?.usesTrack ? 'set by the track' : seconds(def?.runTicks ?? 0),
      );
      setText(operating.unload.value, seconds(def?.unloadTicks ?? 0));
      const reliabilityPercent = info[o + RideInfo.Reliability];
      reliability.set(reliabilityPercent / 100, `${reliabilityPercent}%`);
      setText(
        maintenance.inspect.value,
        `${Math.round((def?.inspectionIntervalTicks ?? 0) / (TICKS_PER_SECOND * 60))} min`,
      );
      setText(maintenance.breakdowns.value, state === 3 ? 'Broken down' : 'Working');
      setText(measurements.tested.value, tested ? 'Tested' : 'Run a test to measure it');
      setText(
        measurements.excitement.value,
        tested ? (info[o + RideInfo.Excitement] / 100).toFixed(2) : '-',
      );
      setText(
        measurements.intensity.value,
        tested ? (info[o + RideInfo.Intensity] / 100).toFixed(2) : '-',
      );
      setText(
        measurements.nausea.value,
        tested ? (info[o + RideInfo.Nausea] / 100).toFixed(2) : '-',
      );
      setText(
        measurements.pieces.value,
        def?.usesTrack
          ? `${info[o + RideInfo.TrackPieces]} pieces${flags & RideFlag.CircuitClosed ? ', closed circuit' : ''}`
          : 'not a track ride',
      );

      queueSeries.record(snapshot.tick, info[o + RideInfo.QueueLength]);
      servedSeries.record(snapshot.tick, info[o + RideInfo.GuestsServed]);
      if (win.activeTab === 'graphs') {
        drawChart(queueChart, queueSeries.values(), '#f2c14e');
        drawChart(servedChart, servedSeries.values(), '#8fd3ff');
      }
      price.show(info[o + RideInfo.Price]);
      const served = info[o + RideInfo.GuestsServed];
      const total = info[o + RideInfo.IncomeCents];
      setText(income.total.value, formatMoney(total));
      setText(income.perGuest.value, served > 0 ? formatMoney(Math.round(total / served)) : '-');
      setText(customers.served.value, String(served));
      setText(customers.waiting.value, String(info[o + RideInfo.QueueLength]));
    },
  };
}

function findRow(snapshot: Snapshot, rideId: number): number | null {
  for (let i = 0; i < snapshot.rides.count; i++)
    if (snapshot.rideInfo[i * RIDE_INFO_STRIDE + RideInfo.Id] === rideId) return i;
  return null;
}
