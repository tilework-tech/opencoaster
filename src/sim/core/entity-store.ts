/** Integer-only typed arrays: floats are banned in sim state to keep results bit-identical. */
export type TypedArrayCtor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor;

export type Schema = Record<string, TypedArrayCtor>;
export type Columns<S extends Schema> = { [K in keyof S]: InstanceType<S[K]> };

/**
 * Struct-of-arrays entity storage with dense packing.
 *
 * Entities live in slots [0, count). Despawning swap-removes the last slot into the hole, so
 * iteration is a tight loop over typed arrays. Stable ids (never reused while alive) map to
 * slots through idToSlot; references between entities should store ids, not slots.
 * Spawn/despawn order is deterministic, so slot and id assignment is too.
 */
export class EntityStore<S extends Schema> {
  readonly capacity: number;
  readonly cols: Columns<S>;
  readonly slotToId: Uint32Array;
  readonly idToSlot: Int32Array;
  private readonly freeIds: Uint32Array;
  private freeTop: number;
  private readonly colList: Int32Array[];
  count = 0;

  constructor(
    readonly schema: S,
    capacity: number,
  ) {
    this.capacity = capacity;
    const cols = {} as Record<string, InstanceType<TypedArrayCtor>>;
    for (const key of Object.keys(schema)) cols[key] = new schema[key](capacity);
    this.cols = cols as Columns<S>;
    this.colList = Object.values(cols) as unknown as Int32Array[];
    this.slotToId = new Uint32Array(capacity);
    this.idToSlot = new Int32Array(capacity).fill(-1);
    this.freeIds = new Uint32Array(capacity);
    for (let i = 0; i < capacity; i++) this.freeIds[i] = capacity - 1 - i;
    this.freeTop = capacity;
  }

  /** Allocates a zeroed entity. Returns its slot, or -1 if the store is full. */
  spawn(): number {
    if (this.freeTop === 0) return -1;
    const id = this.freeIds[--this.freeTop];
    const slot = this.count++;
    this.slotToId[slot] = id;
    this.idToSlot[id] = slot;
    for (const col of this.colList) col[slot] = 0;
    return slot;
  }

  despawnSlot(slot: number): void {
    const id = this.slotToId[slot];
    const last = this.count - 1;
    if (slot !== last) {
      for (const col of this.colList) {
        col[slot] = col[last];
      }
      const movedId = this.slotToId[last];
      this.slotToId[slot] = movedId;
      this.idToSlot[movedId] = slot;
    }
    this.idToSlot[id] = -1;
    this.freeIds[this.freeTop++] = id;
    this.count = last;
  }

  despawnId(id: number): void {
    const slot = this.idToSlot[id];
    if (slot >= 0) this.despawnSlot(slot);
  }

  isAlive(id: number): boolean {
    return id < this.capacity && this.idToSlot[id] >= 0;
  }

  /** All backing arrays in a fixed order, for hashing and save/load. */
  arrays(): ArrayBufferView[] {
    return [this.slotToId, this.idToSlot, this.freeIds, ...this.colList];
  }

  get freeCount(): number {
    return this.freeTop;
  }

  /** Restores allocator state after the arrays have been overwritten (save/load). */
  restore(count: number, freeTop: number): void {
    this.count = count;
    this.freeTop = freeTop;
  }
}
