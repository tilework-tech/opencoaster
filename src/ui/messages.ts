import type { NewsTarget } from './news';

export type MessageCategory = 'award' | 'ride' | 'park' | 'guest';

export const MESSAGE_CATEGORIES: readonly MessageCategory[] = ['award', 'ride', 'park', 'guest'];

export type MessageFilter = Record<MessageCategory, boolean>;

export const DEFAULT_MESSAGE_FILTER: MessageFilter = {
  award: true,
  ride: true,
  park: true,
  guest: true,
};

/** How long a message stays on the ticker before it moves on by itself. */
export const MESSAGE_LIFETIME_MS = 6000;
const MAX_WAITING = 20;

export interface QueuedMessage {
  id: number;
  category: MessageCategory;
  text: string;
  target?: NewsTarget;
}

/**
 * Shows one message at a time. A message leaves the ticker when it is dismissed or
 * after its lifetime, and the next waiting message takes its place. Time is passed in
 * by the caller so the queue has no clock of its own.
 */
export class MessageQueue<T extends QueuedMessage = QueuedMessage> {
  private waiting: T[] = [];
  private shown: T | null = null;
  private shownAt = 0;

  constructor(
    private readonly lifetimeMs = MESSAGE_LIFETIME_MS,
    private readonly maxWaiting = MAX_WAITING,
  ) {}

  get pending(): number {
    return this.waiting.length;
  }

  enqueue(message: T, now: number): void {
    if (this.shown === null) {
      this.show(message, now);
      return;
    }
    this.waiting.push(message);
    if (this.waiting.length > this.maxWaiting)
      this.waiting.splice(0, this.waiting.length - this.maxWaiting);
  }

  current(now: number): T | null {
    if (this.shown !== null && now - this.shownAt >= this.lifetimeMs) this.advance(now);
    return this.shown;
  }

  dismiss(now: number): void {
    this.advance(now);
  }

  remove(id: number, now: number): void {
    this.waiting = this.waiting.filter((message) => message.id !== id);
    if (this.shown?.id === id) this.advance(now);
  }

  clear(): void {
    this.waiting = [];
    this.shown = null;
  }

  private advance(now: number): void {
    const next = this.waiting.shift();
    if (next) this.show(next, now);
    else this.shown = null;
  }

  private show(message: T, now: number): void {
    this.shown = message;
    this.shownAt = now;
  }
}

export function filterMessages<T extends { category: MessageCategory }>(
  items: readonly T[],
  filter: MessageFilter,
): T[] {
  return items.filter((item) => filter[item.category]);
}
