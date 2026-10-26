import type { Stats } from '../worker/protocol';
import type { Snapshot } from '../worker/snapshot';
import { element, gauge, setText } from './dom';
import { formatDate, formatMoney } from './format';
import { icon } from './icons';
import type { IconName } from './icons';
import type { NewsItem } from './news';
import { MAX_PARK_RATING } from './windows/park-window';

export interface StatusBarActions {
  openFinance(): void;
  openGuests(): void;
  openPark(): void;
  openNews(): void;
  /** Called with the clicked message so the camera/ride window can follow it. */
  followNews(item: NewsItem): void;
  dismissMessage(): void;
}

const WEATHER: ReadonlyArray<readonly [IconName, string]> = [
  ['sun', 'Sunny'],
  ['cloud', 'Cloudy'],
  ['rain', 'Rain'],
  ['storm', 'Thunderstorm'],
];

/** Bottom bar: cash, guests, park rating, news ticker, date and weather. */
export class StatusBar {
  readonly root: HTMLElement;
  private readonly cash: HTMLButtonElement;
  private readonly guests: HTMLButtonElement;
  private readonly rating: ReturnType<typeof gauge>;
  private readonly ticker: HTMLButtonElement;
  private readonly dismiss: HTMLButtonElement;
  private readonly date: HTMLElement;
  private readonly weather: HTMLElement;
  private latest: NewsItem | null = null;
  private rendered = false;
  private weatherKind = -1;

  constructor(parent: HTMLElement, actions: StatusBarActions) {
    this.root = element('footer', 'status-bar');
    this.root.setAttribute('aria-label', 'Park status');
    const statusBox = element('div', 'status-box status-left');
    const situationBox = element('div', 'status-box status-right');

    this.cash = this.chip('cash', 'Cash', actions.openFinance);
    this.cash.classList.add('status-cash');
    this.guests = this.chip('guests', 'Guests', actions.openGuests);
    this.guests.classList.add('status-guests');
    this.rating = gauge('Rating');
    const ratingButton = element('button', 'status-chip status-rating');
    ratingButton.type = 'button';
    ratingButton.setAttribute('aria-label', 'Park rating');
    ratingButton.addEventListener('click', actions.openPark);
    ratingButton.append(this.rating.row);

    this.ticker = element('button', 'status-ticker');
    this.ticker.type = 'button';
    this.ticker.setAttribute('aria-live', 'polite');
    this.ticker.addEventListener('click', () => {
      if (this.latest?.target) actions.followNews(this.latest);
      else actions.openNews();
    });
    this.dismiss = element('button', 'status-ticker-dismiss', '×');
    this.dismiss.type = 'button';
    this.dismiss.title = 'Dismiss message';
    this.dismiss.setAttribute('aria-label', 'Dismiss message');
    this.dismiss.replaceChildren(icon('close'));
    this.dismiss.addEventListener('click', actions.dismissMessage);
    let touchStart: { pointerId: number; x: number; y: number } | null = null;
    this.ticker.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      touchStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      this.ticker.setPointerCapture(event.pointerId);
    });
    this.ticker.addEventListener('pointerup', (event) => {
      if (!touchStart || event.pointerId !== touchStart.pointerId) return;
      const deltaX = event.clientX - touchStart.x;
      const deltaY = event.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      event.preventDefault();
      actions.dismissMessage();
    });
    this.ticker.addEventListener('pointercancel', () => {
      touchStart = null;
    });
    const history = element('button', 'status-chip status-news');
    history.type = 'button';
    history.title = 'Recent messages';
    history.setAttribute('aria-label', 'Recent messages');
    history.append(icon('news'));
    history.addEventListener('click', actions.openNews);

    this.date = element('button', 'status-date');
    (this.date as HTMLButtonElement).type = 'button';
    this.date.addEventListener('click', actions.openNews);
    this.weather = element('div', 'status-weather');
    statusBox.append(this.cash, this.guests, ratingButton);
    situationBox.append(this.date, this.weather);
    const message = element('div', 'status-message');
    message.append(this.ticker, this.dismiss, history);
    this.root.append(message, statusBox, situationBox);
    parent.append(this.root);
  }

  setMessage(item: NewsItem | null): void {
    if (this.rendered && item === this.latest) return;
    this.rendered = true;
    this.latest = item;
    this.ticker.classList.toggle('has-target', !!item?.target);
    this.ticker.dataset.category = item?.category ?? 'park';
    setText(this.ticker, item?.text ?? 'Welcome to your park');
    this.dismiss.hidden = item === null;
  }

  update(snapshot: Snapshot | null, stats: Stats | null): void {
    if (!snapshot) return;
    this.cash.lastElementChild!.textContent = formatMoney(snapshot.park.cash);
    this.cash.classList.toggle('negative', snapshot.park.cash < 0);
    this.guests.lastElementChild!.textContent = String(stats?.guests ?? snapshot.guests.count);
    this.rating.set(
      snapshot.scenario.parkRating / MAX_PARK_RATING,
      String(snapshot.scenario.parkRating),
    );
    setText(this.date, formatDate(snapshot.tick));
    this.date.dataset.tick = String(snapshot.tick);
    if (snapshot.weather.kind !== this.weatherKind) {
      this.weatherKind = snapshot.weather.kind;
      const [name, label] = WEATHER[snapshot.weather.kind] ?? WEATHER[0];
      this.weather.replaceChildren(icon(name));
      this.weather.title = label;
      this.weather.setAttribute('aria-label', label);
    }
    this.weather.dataset.temperature = `${snapshot.weather.temperature}°C`;
  }

  dispose(): void {
    this.root.remove();
  }

  private chip(name: IconName, label: string, click: () => void): HTMLButtonElement {
    const chip = element('button', 'status-chip');
    chip.type = 'button';
    chip.setAttribute('aria-label', label);
    chip.title = label;
    chip.append(icon(name), element('span', 'status-value'));
    chip.addEventListener('click', click);
    return chip;
  }
}
