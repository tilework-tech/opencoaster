/** Listing metadata for a saved game. The bytes are fetched separately, so lists stay small. */
export interface SaveSlotMeta {
  id: string;
  name: string;
  savedAt: number;
  scenarioId: string;
  tick: number;
  cash: number;
  loan: number;
}

export interface SaveSlot extends SaveSlotMeta {
  bytes: Uint8Array;
}

export interface SlotStore {
  /** Newest first. */
  list(): Promise<SaveSlotMeta[]>;
  get(id: string): Promise<SaveSlot | undefined>;
  /** Creates or replaces the slot with the same id. */
  put(slot: SaveSlot): Promise<void>;
  remove(id: string): Promise<void>;
}

function metaOf(slot: SaveSlotMeta): SaveSlotMeta {
  const { id, name, savedAt, scenarioId, tick, cash, loan } = slot;
  return { id, name, savedAt, scenarioId, tick, cash, loan };
}

function newestFirst(a: SaveSlotMeta, b: SaveSlotMeta): number {
  return b.savedAt - a.savedAt || a.id.localeCompare(b.id);
}

/** In-process store with the same semantics as the IndexedDB one; used by tests. */
export function createMemorySlotStore(): SlotStore {
  const slots = new Map<string, SaveSlot>();
  return {
    async list() {
      return [...slots.values()].map(metaOf).sort(newestFirst);
    },
    async get(id) {
      const slot = slots.get(id);
      return slot && { ...slot, bytes: slot.bytes.slice() };
    },
    async put(slot) {
      slots.set(slot.id, { ...slot, bytes: slot.bytes.slice() });
    },
    async remove(id) {
      slots.delete(id);
    },
  };
}

const STORE_NAME = 'slots';

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save slots in the browser's IndexedDB; each slot is one record holding its save bytes. */
export async function openIndexedDbSlotStore(name = 'opencoaster-saves'): Promise<SlotStore> {
  const db = await openDatabase(name);
  const store = (mode: IDBTransactionMode) =>
    db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return {
    async list() {
      const all = await requestResult(store('readonly').getAll() as IDBRequest<SaveSlot[]>);
      return all.map(metaOf).sort(newestFirst);
    },
    async get(id) {
      return requestResult(store('readonly').get(id) as IDBRequest<SaveSlot | undefined>);
    },
    async put(slot) {
      await requestResult(store('readwrite').put(slot));
    },
    async remove(id) {
      await requestResult(store('readwrite').delete(id));
    },
  };
}
