import { button, element, setText } from '../dom';
import { STAFF_KIND_NAMES, StaffRoster } from '../staff-roster';
import type { Snapshot } from '../../worker/snapshot';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';

const PLURALS = ['Handymen', 'Mechanics', 'Security guards', 'Entertainers'] as const;
const TAB_ICONS = ['staff', 'build', 'info', 'guests'] as const;

export const STAFF_TABS: readonly TabSpec[] = STAFF_KIND_NAMES.map((_, kind) => ({
  id: String(kind),
  label: PLURALS[kind],
  icon: TAB_ICONS[kind],
}));

/** Staff window: one tab per role with a hire button and that role's roster. */
export function openStaffWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'staff',
    title: 'Staff',
    kind: 'staff',
    width: 340,
    tabs: STAFF_TABS,
  });
  const summary = element('p', 'ui-help');
  const rosters: StaffRoster[] = [];
  if (created) {
    win.body.prepend(summary);
    STAFF_KIND_NAMES.forEach((name, kind) => {
      const pane = win.pane(String(kind));
      const row = element('div', 'button-row');
      row.append(button(`Hire ${name}`, () => ctx.actions.hireStaff(kind), 'ui-button'));
      const alternate = button(
        'Remove tiles',
        () => {
          const on = alternate.getAttribute('aria-pressed') !== 'true';
          alternate.setAttribute('aria-pressed', String(on));
          ctx.actions.setAlternate(on);
        },
        'ui-button',
      );
      alternate.setAttribute('aria-pressed', String(ctx.alternate()));
      row.append(alternate);
      pane.append(row);
      rosters.push(
        new StaffRoster(
          pane,
          {
            open: (staffId) => ctx.openWorker(staffId),
            rename: (staffId, newName) => ctx.actions.renameStaff(staffId, newName),
            fire: (staffId) => ctx.actions.fireStaff(staffId),
          },
          kind,
        ),
      );
    });
  }
  return {
    update(snapshot: Snapshot | null) {
      setText(summary, `Staff employed  ${snapshot?.staff.count ?? 0}`);
      for (const roster of rosters) roster.update(snapshot);
    },
  };
}
