import { describe, expect, it } from 'vitest';
import { createSnapshot } from '../worker/snapshot';
import { financePanelText } from './hud';
import { guestSelectionText } from './game-ui';

describe('finance panel', () => {
  it('shows cash and outstanding loan from the latest worker snapshot', () => {
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    snapshot.park.cash = 123456;
    snapshot.park.loan = 7500;

    expect(financePanelText(snapshot)).toContain('Cash  $1,234.56');
    expect(financePanelText(snapshot)).toContain('Loan  $75.00');
  });
});

describe('guest selection', () => {
  it('prefixes guest details with the selection tick', () => {
    expect(guestSelectionText('Guest 4\nTile  7, 2\nState  walking', 120)).toBe(
      'Selection at tick 120\nGuest 4\nTile  7, 2\nState  walking',
    );
  });
});
