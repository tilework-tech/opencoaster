# Noridoc: Application

Path: @/src/app

### Overview

- Composes browser-side game controllers around the renderer, UI and worker client.
- Keeps application flows separate from simulation rules and serialization formats.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) is the module entry point and awaits [bootstrap](bootstrap/docs.md).
- The app layer calls [SimClient](../worker/sim-client.ts) for game starts, snapshots and commands; authoritative simulation state remains in the worker.
- Controllers receive shared state and cross-feature actions through callback dependencies supplied at assembly time.

### Core Implementation

- [bootstrap](bootstrap/docs.md) constructs app services and owns the render frame loop.
- [input](input/docs.md), [tools](tools/docs.md), [ride setup](ride-setup/docs.md) and [save/load](save-load/docs.md) encapsulate browser interaction and multi-step workflows.

### Things to Know

- This layer coordinates existing UI, input, rendering, save and worker APIs; it does not define simulation behavior.
- Callback boundaries let each controller operate on the current app state without becoming a second owner of that state.

Created and maintained by Nori.
