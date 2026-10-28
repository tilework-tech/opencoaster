import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import { RideInfo, RIDE_INFO_STRIDE, SNAPSHOT_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { button, element } from '../dom';
import { liveViewport } from '../live-viewport';
import type { UiContext, WindowController } from '../ui-types';
import type { WindowKind } from '../window-manager';
import { parseFollowTarget, resolveFollowTarget } from '../../render/follow-target';
import type { FollowPosition } from '../../render/follow-target';

interface ViewOption {
  value: string;
  label: string;
  position: FollowPosition;
}

function targetOptions(snapshot: Snapshot | null): ViewOption[] {
  if (!snapshot) return [];
  const options: ViewOption[] = [];
  for (let i = 0; i < snapshot.guests.count; i++) {
    const id = snapshot.guestIds[i] ?? 0;
    if (id > 0) {
      const offset = i * SNAPSHOT_STRIDE;
      options.push({
        value: `guest:${id}`,
        label: `Guest ${id + 1}`,
        position: {
          x: snapshot.guests.data[offset] ?? 0,
          y: snapshot.guests.data[offset + 1] ?? 0,
          z: snapshot.guests.data[offset + 2] ?? 0,
        },
      });
    }
  }
  for (let i = 0; i < snapshot.staff.count; i++) {
    const id = snapshot.staffIds[i] ?? 0;
    if (id > 0)
      options.push({
        value: `staff:${id}`,
        label: snapshot.staffNames.get(id) || `Staff ${id + 1}`,
        position: {
          x: snapshot.staff.data[i * SNAPSHOT_STRIDE] ?? 0,
          y: snapshot.staff.data[i * SNAPSHOT_STRIDE + 1] ?? 0,
          z: snapshot.staff.data[i * SNAPSHOT_STRIDE + 2] ?? 0,
        },
      });
  }
  const rides = Math.min(
    snapshot.rides.count,
    Math.floor(snapshot.rideInfo.length / RIDE_INFO_STRIDE),
  );
  for (let i = 0; i < rides; i++) {
    const offset = i * RIDE_INFO_STRIDE;
    const id = snapshot.rideInfo[offset + RideInfo.Id] ?? -1;
    if (id < 0) continue;
    const type = snapshot.rideInfo[offset + RideInfo.Type] ?? -1;
    options.push({
      value: `ride:${id}`,
      label: `${RIDE_CATALOG[type as keyof typeof RIDE_CATALOG]?.name ?? 'Ride'} ${id + 1}`,
      position: {
        x: (snapshot.rideInfo[offset + RideInfo.RideX] ?? 0) * TILE_UNITS + TILE_UNITS / 2,
        y: (snapshot.rideInfo[offset + RideInfo.RideY] ?? 0) * TILE_UNITS + TILE_UNITS / 2,
        z: (snapshot.rideInfo[offset + RideInfo.BaseLevel] ?? 0) * Z_STEP,
      },
    });
  }
  return options;
}

export function openViewportWindow(ctx: UiContext, id: string): WindowController {
  const { window: win, created } = ctx.windows.open({
    id,
    title: 'Viewport',
    kind: 'map' satisfies WindowKind,
    width: 340,
  });
  const search = element('input', 'viewport-target-search');
  search.type = 'search';
  search.placeholder = 'Find guest, staff, or ride';
  search.setAttribute('aria-label', 'Find target');
  const select = element('select', 'viewport-target');
  select.setAttribute('aria-label', 'Follow target');
  const surface = liveViewport('', 'Live viewport');
  let availableTargets: ViewOption[] = [];
  const targetPositions = new Map<string, FollowPosition>();
  const locate = button(
    'Locate',
    () => {
      const position = targetPositions.get(select.value);
      if (position)
        ctx.actions.locate(
          Math.floor(position.x / TILE_UNITS),
          Math.floor(position.y / TILE_UNITS),
        );
    },
    'ui-button',
  );
  let selectedOption: ViewOption | null = null;
  let lastQuery: string | null = null;
  let lastSnapshotRevision = -1;
  const refreshOptions = (query: string): void => {
    const options = query
      ? availableTargets
          .filter((option) => option.label.toLocaleLowerCase().includes(query))
          .slice(0, 100)
      : [];
    const visibleOptions = selectedOption
      ? [selectedOption, ...options.filter((option) => option.value !== selectedOption?.value)]
      : options;
    select.replaceChildren(
      new Option(
        selectedOption?.label ?? 'Search for a guest, staff member, or ride',
        selectedOption?.value ?? '',
      ),
      ...visibleOptions
        .filter((option) => option.value !== selectedOption?.value)
        .map((option) => new Option(option.label, option.value)),
    );
    select.value = selectedOption?.value ?? '';
  };
  select.addEventListener('change', () => {
    const option = select.selectedOptions[0];
    selectedOption = availableTargets.find((target) => target.value === option?.value) ?? null;
    if (selectedOption) targetPositions.set(selectedOption.value, selectedOption.position);
    surface.dataset.liveViewport = select.value;
    search.value = '';
    lastQuery = '';
    refreshOptions('');
  });
  if (created) win.pane().append(search, select, surface, locate);
  return {
    update(snapshot) {
      if (!snapshot) return;
      const query = search.value.trim().toLocaleLowerCase();
      const selectedTarget = selectedOption && parseFollowTarget(selectedOption.value);
      const selectedPosition = selectedTarget && resolveFollowTarget(snapshot, selectedTarget);
      const targetLost = selectedOption !== null && selectedPosition === null;
      if (selectedPosition && selectedOption) {
        selectedOption.position = selectedPosition;
        targetPositions.set(selectedOption.value, selectedPosition);
      } else {
        selectedOption = null;
        targetPositions.clear();
        surface.dataset.liveViewport = '';
      }
      const initialTargets = lastQuery === null;
      const queryChanged = query !== lastQuery;
      const snapshotChanged = snapshot.revision !== lastSnapshotRevision;
      if (initialTargets || queryChanged || (query && snapshotChanged)) {
        availableTargets = targetOptions(snapshot);
        if (initialTargets) selectedOption = availableTargets[0] ?? null;
        lastQuery = query;
        lastSnapshotRevision = snapshot.revision;
        if (selectedOption) targetPositions.set(selectedOption.value, selectedOption.position);
        surface.dataset.liveViewport = selectedOption?.value ?? '';
        refreshOptions(query);
      } else if (targetLost) {
        refreshOptions(query);
      }
    },
  };
}
