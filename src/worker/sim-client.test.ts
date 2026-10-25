import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimClient } from './sim-client';
import type { MapMessage } from './protocol';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(): void {}
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const map = { type: 'map', width: 4, height: 4 } as MapMessage;

describe('SimClient.onMap', () => {
  beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
  afterEach(() => vi.unstubAllGlobals());

  it('flags only the map of a started game as new, not later terrain edits', () => {
    const client = new SimClient();
    const seen: boolean[] = [];
    client.onMap = (_map, newGame) => seen.push(newGame);

    client.startGame({ seed: 1, width: 4, height: 4, initialGuests: 0 });
    FakeWorker.last.emit(map);
    FakeWorker.last.emit({ type: 'ready' });
    FakeWorker.last.emit(map);

    expect(seen).toEqual([true, false]);
  });

  it('flags the map of a loaded game as new', () => {
    const client = new SimClient();
    const seen: boolean[] = [];
    client.onMap = (_map, newGame) => seen.push(newGame);

    void client.load(new Uint8Array(1));
    FakeWorker.last.emit(map);
    FakeWorker.last.emit({ type: 'loaded' });
    FakeWorker.last.emit(map);

    expect(seen).toEqual([true, false]);
  });
});
