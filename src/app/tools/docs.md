# Noridoc: App Tools

Path: @/src/app/tools

### Overview

- Converts canvas taps, holds and paint gestures into tile selection or simulation commands.
- Separates tool-specific command handlers and snapshot-based guest hit testing from event wiring.

### How it fits into the larger codebase

- [camera input](../input/docs.md) invokes the controller's click, path-removal and scenery-removal callbacks, and routes pointer press/hover/leave to the Land and area controllers. Map taps for Land, Clear scenery and Water go through `handleCanvasClick` to the matching controller.
- [bootstrap](../bootstrap/docs.md) provides the active tool settings, UI, camera, worker client and [ride setup](../ride-setup/docs.md) callback.
- Commands go through [SimClient](../../worker/sim-client.ts); ride selection uses [object-picking](../../input/object-picking.ts) against the latest snapshot.

### Core Implementation

- `createToolController` converts CSS-pixel canvas positions to map tiles, dispatches the active tool, and updates selection/UI state.
- [land-controller.ts](land-controller.ts) drives the Land window's tool: it picks the selection under the pointer ([land-selection.ts](land-selection.ts): square size, and for size 1 a corner, edge or whole tile from the position inside the tile), asks the worker to preview the edit, shows the overlay and a cursor tooltip with the price or refusal ([land-feedback.ts](land-feedback.ts)), sends the command on tap, and turns a vertical drag on a locked selection into one raise or lower step per terrain step of pointer travel. Flatten and smooth paint tile by tile while dragging; flatten keeps the first tile's height as its level.
- [area-controller.ts](area-controller.ts) (`AreaController`) drives the Clear scenery and Water tools; bootstrap creates one instance per tool. It reuses the Land tool's square picking (whole tiles only, no corner or edge picking), requests a worker preview whenever the edit under the pointer changes, draws [the area overlay](../../ui/area-overlay.ts), and shows a `.area-tip` cursor tooltip. A tap sends `clearScenery`, `raiseWater` or `lowerWater`; Shift or the alternate action inverts the Water window's Raise/Lower choice for that tap. Water has no drag-to-repeat, so repeated steps are repeated taps. A tap whose latest preview for the same edit was already refused flashes the reason instead of sending a command; worker refusals arriving in `Snapshot.feedback` under the tool's own domain (`Clear` or `Water`) are shown for 2.5 seconds with the blocking tile flagged.
- [area-feedback.ts](area-feedback.ts) holds the tooltip text: the price of a step (for example a count of items to clear with their total, or "Raise water" with its price) and tool-specific refusal wording, falling back to the Land tool's refusal text for shared `LandResult` codes.
- [handlers.ts](handlers.ts) maps land-rights purchases, paths, scenery, path additions, flowerbed and patrol actions to worker commands. Patrol edits carry the selected staff ID and update that worker's 4×4-block area. The purchase handler checks current ownership flags and available cash before requesting a one-tile `buyLand` command; the worker remains authoritative for resulting state and ledger charges. Taps on a footpath tile go to the path tool; the alternate action removes the piece under the tap. The controller picks a tile for context-menu removal, scans map scenery elements before sending `removeScenery`, and shows a refusal if the map, tile, or scenery is missing. Path removal sends `removePath` and reports status. Line-mode path placements send no slope, so the simulation follows the terrain.
- [build-hover-feedback.ts](build-hover-feedback.ts) compares the hovered tile against the current snapshot's `buildable` array for terrain, path, scenery, ride and track placement modes. An unavailable tile sets the red tile ghost and displays `Land not owned by park`; selection and land-purchase modes do not show this warning. Pointer input supplies the latest tile and CSS-pixel position, while bootstrap updates and disposes the feedback alongside the other overlays.
- [path-feedback.ts](path-feedback.ts) shows a refused footpath: it reads the `Path` feedback domain from the snapshot, marks the tile with a red ghost, and shows the reason in a tooltip at the last pointer position for 2.5 seconds. `pathRefusalText` gives the same reasons to the footpath preview.
- [path/](path/) is footpath construction. [controller.ts](path/controller.ts) (`PathTool`) runs line-mode drags: it previews the dragged run through the worker's `previewPaths` request, draws it with [ghost.ts](path/ghost.ts), and on release lays the tiles the sim accepts. Piece mode builds or removes one piece at a cursor tile, with direction and slope from [state.ts](path/state.ts). [run.ts](path/run.ts) holds the run geometry: a straight line, or one turn going along x first.
- [scenery-preview.ts](scenery-preview.ts) previews the scenery piece under the hover tile: the sim judges the spot with the same rules as placement (`previewScenery`), the ghost is drawn red when refused, and a label at the cursor shows the price or reason. The hover includes the tile's slope and separate item-facing and camera-view rotations: facing is sent to simulation placement, while camera rotation selects the rendered tile-centre ground pivot. The ghost uses the scenery catalog box and ground pivot used by the renderer.
- [path-addition-preview.ts](path-addition-preview.ts) derives hover ghosts for benches, bins, and lamps from the hovered path's current connection flags. It uses the same open-edge, rotation, and edge-height helpers as both renderers and leaves the ghost at native frame size, so the preview marks each eventual prop location without storing an edge in the save. Fractional edge positions retain the source path tile for Canvas2D painter grouping. Shelters stay centered on the path.
- [flowerbed-preview.ts](flowerbed-preview.ts) builds the flowerbed placement ghost from the shared flowerbed box and ground-pivot helper. Bootstrap creates these sprite ghosts from the current hovered tile and camera rotation alongside scenery and path-addition previews.
- [selection.ts](selection.ts) hit-tests guest positions from the current snapshot and builds the UI's guest-selection data.

### Things to Know

- A forced selection (a touch hold, a right-click in Select mode, or a right-click on a ride tile under a construction tool) bypasses the active build tool. Ride footprint and track hit testing runs before guest hit testing, so a ride window opens when both overlap; otherwise a hit guest opens its detail window.
- Land and area tool previews come from the worker's own planners (`planLand`, `planArea`), so the tooltip price and refusal match what the command will do unless the world changes in between. `SimClient` keeps only the newest preview answer, and the controllers compare its edit with the current one before drawing it.
- Tool status text reports requests, while command acceptance and resulting state remain authoritative in the simulation worker.
- Scenery, flowerbed, and path-addition previews pass rendered dimensions and ground level through the renderer contract; both backends use those values to draw the translucent ghost in the same world-space box as its placed counterpart.

Created and maintained by Nori.
