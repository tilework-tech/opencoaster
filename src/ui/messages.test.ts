import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_FILTER,
  MESSAGE_LIFETIME_MS,
  MessageQueue,
  type QueuedMessage,
  filterMessages,
} from './messages';

function message(id: number, category: QueuedMessage['category'] = 'park'): QueuedMessage {
  return { id, category, text: `message ${id}` };
}

describe('message queue', () => {
  it('shows one message at a time, in arrival order', () => {
    const queue = new MessageQueue();
    queue.enqueue(message(1), 0);
    queue.enqueue(message(2), 0);
    expect(queue.current(0)?.id).toBe(1);
    expect(queue.pending).toBe(1);
  });

  it('dismissing the shown message shows the next one', () => {
    const queue = new MessageQueue();
    queue.enqueue(message(1), 0);
    queue.enqueue(message(2), 0);
    queue.dismiss(100);
    expect(queue.current(100)?.id).toBe(2);
    queue.dismiss(200);
    expect(queue.current(200)).toBeNull();
  });

  it('expires the shown message after its lifetime and moves on', () => {
    const queue = new MessageQueue(1000);
    queue.enqueue(message(1), 0);
    queue.enqueue(message(2), 500);
    expect(queue.current(999)?.id).toBe(1);
    expect(queue.current(1000)?.id).toBe(2);
    expect(queue.current(1999)?.id).toBe(2);
    expect(queue.current(2000)).toBeNull();
  });

  it('gives each message the full lifetime after the one before it is dismissed', () => {
    const queue = new MessageQueue(1000);
    queue.enqueue(message(1), 0);
    queue.enqueue(message(2), 0);
    queue.dismiss(900);
    expect(queue.current(1800)?.id).toBe(2);
    expect(queue.current(1900)).toBeNull();
  });

  it('clear removes the shown message and everything waiting', () => {
    const queue = new MessageQueue();
    queue.enqueue(message(1), 0);
    queue.enqueue(message(2), 0);
    queue.clear();
    expect(queue.current(0)).toBeNull();
    expect(queue.pending).toBe(0);
  });

  it('removes a single message whether it is shown or waiting', () => {
    const queue = new MessageQueue();
    queue.enqueue(message(1), 0);
    queue.enqueue(message(2), 0);
    queue.enqueue(message(3), 0);
    queue.remove(2, 0);
    queue.dismiss(0);
    expect(queue.current(0)?.id).toBe(3);
    queue.remove(3, 0);
    expect(queue.current(0)).toBeNull();
  });

  it('keeps only the newest waiting messages when many arrive at once', () => {
    const queue = new MessageQueue(MESSAGE_LIFETIME_MS, 2);
    for (let id = 1; id <= 5; id++) queue.enqueue(message(id), 0);
    expect(queue.pending).toBe(2);
    queue.dismiss(0);
    expect(queue.current(0)?.id).toBe(4);
    queue.dismiss(0);
    expect(queue.current(0)?.id).toBe(5);
  });

  it('does nothing when dismissing an empty queue', () => {
    const queue = new MessageQueue();
    queue.dismiss(0);
    expect(queue.current(0)).toBeNull();
  });
});

describe('message filter', () => {
  it('shows every category by default', () => {
    expect(Object.values(DEFAULT_MESSAGE_FILTER).every(Boolean)).toBe(true);
  });

  it('drops messages whose category is switched off', () => {
    const items = [message(1, 'award'), message(2, 'ride'), message(3, 'guest')];
    const filter = { ...DEFAULT_MESSAGE_FILTER, award: false };
    expect(filterMessages(items, filter).map((item) => item.id)).toEqual([2, 3]);
  });
});
