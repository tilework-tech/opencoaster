# Noridoc: App Save and Load

Path: @/src/app/save-load

### Overview

- Coordinates game-session lifecycle, title/menu transitions and scenario outcome state.
- Connects UI save actions to the storage and serialization layer.

### How it fits into the larger codebase

- [bootstrap](../bootstrap/docs.md) supplies the `SimClient`, UI overlays, audio/settings state and pause synchronization callbacks.
- [src/ui](../../ui/docs.md) invokes save/load operations through callbacks; this controller delegates bytes and slots to [src/save](../../save/docs.md).
- Scenario definitions and names come from [src/sim/scenario](../../sim/scenario/docs.md), while game state is started or replaced through [SimClient](../../worker/sim-client.ts).

### Core Implementation

- `createSaveLoadController` owns the current session metadata and transitions among new game, sandbox, loaded game, import and title states.
- Save, load and export operations use the existing save services; load validates the header before replacing the active worker game.
- Scenario completion progress is read and written through the save progress helper and observed by bootstrap from snapshots.

### Things to Know

- If loading fails after the session is cleared for the in-flight operation, the prior session is restored; UI entry points display errors at their overlay boundary.
- When IndexedDB cannot be opened, slot storage falls back to memory and returns a notice for the title screen.

Created and maintained by Nori.
