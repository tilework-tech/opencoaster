# Noridoc: Footpath Construction

Path: @/src/app/tools/path

### Overview

- Builds footpaths for the Footpaths window in two modes: a dragged run or a hovered tile (line mode), and a piece at a cursor (piece mode).
- Queue pieces carry a link marker: a dot on each previewed queue tile (green when its line reaches a ride entrance, amber otherwise) and a cursor label saying whether the line links to a ride entrance and whether its open end joins the path.
- Previews exactly what would be built before it is: the ghost draws each piece with the real footpath sprite at the base level and slope, connections to neighbours and queue rails the sim computed (a queue piece's connections are its queue links plus its open end, so the ghost shows single-file lines with rails between pieces that are not linked). Accepted pieces are translucent; refused tiles are tinted red, with the reason at the pointer.

### How it fits into the larger codebase

- [tools](../docs.md) routes taps and pointer drags here; [input](../../input/docs.md) recognises the drag and calls back through `PathDragHandlers`.
- The [Footpaths window](../../../ui/windows/path-window.ts) drives the tool through `FootpathControls` in [ui-types](../../../ui/ui-types.ts).
- Preview and placement go through [SimClient](../../../worker/sim-client.ts): `previewPaths` asks the sim what each piece would become, and the commit sends the same placements as one `placePathRun` command. The sim judges that batch in order on the live map, the same way the preview did on a copy, so the laid pieces match the ghost. The sim is the authority; this module never edits the map.

### Core Implementation

- [run.ts](run.ts): `pathRunTiles` gives a straight line or one turn, along x first; `pieceSlope` maps Level/Up/Down to the sim's slope argument; `stepCursor` moves the piece cursor.
- [controller.ts](controller.ts): `PathTool` previews the hovered tile, a dragged run, or the piece cursor, lays the run on release, and builds or removes a piece at the cursor. Tiles that already hold a footpath are shown as paved and skipped, so they are never charged twice.
- [ghost.ts](ghost.ts): `pathPieceGhosts` turns the preview into `PathPieceGhost` entries that the renderer draws in the world with the real footpath sprites: accepted pieces at the base level and slope the sim chose, refused tiles flat on the ground in the chosen surface. `PathGhost` draws a thin SVG outline and the selected travel-direction arrow over the next piece, positioned with the camera (`pieceCornerLevels`); its polygons carry `data-*` attributes with the piece's level, direction, style, queue flag and edges, which the e2e tests read.
- The renderers draw the ghosts translucently in their depth-sorted sprite pass ([render](../../../render/docs.md)); refused pieces are tinted red. `PathTool` clears them whenever the preview hides.
- [state.ts](state.ts): the tool's settings (mode, surface, queue, piece direction and slope, cursor) and the once-only Footpaths hint.

### Raised footpaths

- Piece mode keeps the cursor's height: Up raises it one level, Level holds it, Down lowers it, so Up/Level/Down chain into a climb, a raised run and a descent. Build on a tile that already holds a footpath continues at that piece's height, and Demolish removes the last piece laid.
- Clicking a uniquely connected path end in piece mode locks the cursor onto its open edge and derives the next tile and height from that path's exit. Stacked paths, junctions and other ambiguous tiles use ordinary cursor placement; the tool does not guess which path to continue.
- A piece built with an explicit level stays flat over sloping terrain instead of following the ground; floating pieces are held up by support posts the renderers draw (the steel coaster column sprite under a footing), down to the terrain.
- Up to three footpaths may stack on one tile. The sim gives each its own walk node ([pathfinding](../../../sim/pathfinding/docs.md)), so guests walk over a bridge and along the path beneath it. Posts are drawn only for the lowest path of a tile, so the space under a bridge stays open.

### Things to Know

- Only tiles without a footpath are previewed and laid during a drag; a tile that is already paved is shown neutral and costs nothing.
- Line-mode drags use the terrain slope. Piece mode can request a ramp explicitly with Up or Down. A tile whose slope the sim cannot pave is refused with the sim's reason.
- The preview is asynchronous: a new preview may show pending tiles for a few milliseconds. Only the newest preview may draw, and release sends its own batch, which the sim judges again, so a stale preview cannot build a piece the sim would refuse.
- Touch has no hover: the ghost appears under the finger while a drag is in progress.

Created and maintained by Nori.
