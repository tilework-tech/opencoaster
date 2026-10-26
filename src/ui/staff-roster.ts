import { SNAPSHOT_STRIDE, type Snapshot } from '../worker/snapshot';

export const STAFF_KIND_NAMES = ['Handyman', 'Mechanic', 'Security', 'Entertainer'] as const;

export interface RosterEntry {
  id: number;
  kind: number;
  name: string;
  role: string;
}

export interface StaffRosterActions {
  open(staffId: number): void;
  rename(staffId: number, name: string): void;
  fire(staffId: number): void;
}

/** One entry per staff member in the latest snapshot, in staff slot order. */
export function rosterEntries(snapshot: Snapshot | null): RosterEntry[] {
  if (!snapshot) return [];
  const entries: RosterEntry[] = [];
  for (let slot = 0; slot < snapshot.staff.count; slot++) {
    const id = snapshot.staffIds[slot];
    const kind = snapshot.staff.data[slot * SNAPSHOT_STRIDE + 3] & 0xff;
    const role = STAFF_KIND_NAMES[kind] ?? 'Staff';
    entries.push({ id, kind, name: snapshot.staffNames.get(id) ?? `${role} ${id + 1}`, role });
  }
  return entries;
}

/** Lists each staff member with its name, role and per-person controls. */
export class StaffRoster {
  private readonly list: HTMLElement;
  private signature = '';

  constructor(
    parent: HTMLElement,
    private readonly actions: StaffRosterActions,
    private readonly kind?: number,
  ) {
    this.list = document.createElement('ul');
    this.list.className = 'staff-roster';
    this.list.setAttribute('aria-label', 'Staff members');
    parent.append(this.list);
  }

  update(snapshot: Snapshot | null): void {
    const entries = rosterEntries(snapshot).filter(
      (entry) => this.kind === undefined || entry.kind === this.kind,
    );
    const signature = JSON.stringify(entries);
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.replaceChildren(...entries.map((entry) => this.row(entry)));
  }

  private row(entry: RosterEntry): HTMLElement {
    const item = document.createElement('li');
    item.dataset.staffId = String(entry.id);
    const label = document.createElement('span');
    label.textContent = `${entry.name} · ${entry.role}`;
    const inspect = this.button(
      'View worker',
      () => this.actions.open(entry.id),
      `open-staff-${entry.id}`,
    );
    inspect.setAttribute('aria-label', `Open ${entry.name} details`);
    item.append(
      label,
      inspect,
      this.button('Rename', () => this.promptRename(entry), `rename-staff-${entry.id}`),
      this.button('Fire', () => this.actions.fire(entry.id), `fire-staff-${entry.id}`),
    );
    return item;
  }

  private promptRename(entry: RosterEntry): void {
    const next = window.prompt('Name for this staff member (blank clears it):', entry.name);
    if (next !== null) this.actions.rename(entry.id, next);
  }

  private button(label: string, click: () => void, id: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = id;
    button.addEventListener('click', click);
    return button;
  }
}
