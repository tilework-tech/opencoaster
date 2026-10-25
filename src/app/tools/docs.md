# Noridoc: App Tools

Path: @/src/app/tools

### Overview

- Converts canvas taps, holds and paint gestures into tile selection or simulation commands.
- Separates tool-specific command handlers and snapshot-based guest hit testing from event wiring.

### How it fits into the larger codebase

- [camera input](../input/docs.md) invokes the controller's click and path-removal callbacks.
- [bootstrap](../bootstrap/docs.md) provides the active tool settings, UI, camera, worker client and [ride setup](../ride-setup/docs.md) callback.
- Commands go through [SimClient](../../worker/sim-client.ts); ride selection uses [object-picking](../../input/object-picking.ts) against the latest snapshot.

### Core Implementation

- `createToolController` converts CSS-pixel canvas positions to map tiles, dispatches the active tool, and updates selection/UI state.
- [land-controller.ts](land-controller.ts) drives the Land window's tool: it picks the selection under the pointer ([land-selection.ts](land-selection.ts): square size, and for size 1 a corner, edge or whole tile from the position inside the tile), asks the worker to preview the edit, shows the overlay and a cursor tooltip with the price or refusal ([land-feedback.ts](land-feedback.ts)), sends the command on tap, and turns a vertical drag on a locked selection into one raise or lower step per terrain step of pointer travel. Flatten and smooth paint tile by tile while dragging; flatten keeps the first tile's height as its level.
- [handlers.ts](handlers.ts) maps land-rights purchases, paths, scenery, path additions, flowerbed and patrol actions to worker commands. The purchase handler checks current ownership flags and available cash before requesting a one-tile `buyLand` command; the worker remains authoritative for resulting state and ledger charges. Taps on a footpath tile go to the path tool; the alternate action removes the piece under the tap. Line-mode path placements send no slope, so the simulation follows the terrain.
- [build-hover-feedback.ts](build-hover-feedback.ts) compares the hovered tile against the current snapshot's `buildable` array for terrain, path, scenery, ride and track placement modes. An unavailable tile sets the red tile ghost and displays `Land not owned by park`; selection and land-purchase modes do not show this warning. Pointer input supplies the latest tile and CSS-pixel position, while bootstrap updates and disposes the feedback alongside the other overlays.
- [path-feedback.ts](path-feedback.ts) shows a refused footpath: it reads the `Path` feedback domain from the snapshot, marks the tile with a red ghost, and shows the reason in a tooltip at the last pointer position for 2.5 seconds. `pathRefusalText` gives the same reasons to the footpath preview.
- [path/](path/) is footpath construction. [controller.ts](path/controller.ts) (`PathTool`) runs line-mode drags: it previews the dragged run through the worker's `previewPaths` request, draws it with [ghost.ts](path/ghost.ts), and on release lays the tiles the sim accepts. Piece mode builds or removes one piece at a cursor tile, with direction and slope from [state.ts](path/state.ts). [run.ts](path/run.ts) holds the run geometry: a straight line, or one turn going along x first.
- [scenery-preview.ts](scenery-preview.ts) previews the scenery piece under the hover tile: the sim judges the spot with the same rules as the placement (`previewScenery`), the ghost is drawn red when refused, and a label at the cursor shows the price or the reason. The piece's rotation (Rotate button or `t`) is passed to both the preview and the placement.
- [selection.ts](selection.ts) hit-tests guest positions from the current snapshot and builds the UI's guest-selection data.

### Things to Know

- A forced selection from a hold or desktop context click bypasses the active build tool. Ride footprint and track hit testing runs before guest hit testing, so a ride window opens when both overlap; otherwise a hit guest opens its detail window.
- Tool status text reports requests, while command acceptance and resulting state remain authoritative in the simulation worker.

Created and maintained by Nori.
