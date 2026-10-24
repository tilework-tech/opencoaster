import { describe, expect, it } from 'vitest';
import { createSnapshot } from '../worker/snapshot';
import { financePanelText } from './hud';
import { guestDetailsText, guestSelectionText, rideOptionsChanged } from './game-ui';

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

  it('shows current guest needs, cash and newest thoughts in the detail window', () => {
    expect(
      guestDetailsText({
        happiness: 177,
        hunger: 88,
        thirst: 43,
        toilet: 29,
        nausea: 17,
        energy: 222,
        cash: 3456,
        thoughts: [6, 2],
      }),
    ).toBe(
      'Happiness  177\nHunger  88\nThirst  43\nToilet  29\nNausea  17\nEnergy  222\nCash  $34.56\nThoughts\nRide enjoyed\nThirsty',
    );
  });
});

describe('ride information selection', () => {
  it('detects changed ride identities when the option count stays the same', () => {
    expect(
      rideOptionsChanged(
        [
          { value: '7', label: 'Carousel #7' },
          { value: '8', label: 'Coaster #8' },
        ],
        [
          { value: '19', label: 'Carousel #19' },
          { value: '20', label: 'Coaster #20' },
        ],
      ),
    ).toBe(true);
  });
});
