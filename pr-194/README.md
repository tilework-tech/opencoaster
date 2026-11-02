# PR #194 proof: edit a coaster from a selected piece

`before/`: main's code. A click on a middle rail in the track tool only reports that the circuit is complete, and Demolish last piece removes the end piece.

`after/<renderer>-<device>-<flow>/`: captures from `e2e/track-edit-selection.spec.ts`. Each `*.png` is a crop around the clicked piece, and each `*-full.png` is the whole screen.

- `circuit-selected`: the clicked middle piece (7 of 14) is highlighted. Selecting does not change the track.
- `circuit-gap`: that piece is demolished. The other 13 pieces stay, and the selection moves to the piece before the gap with a build preview.
- `circuit-rebuilt`: the gap is filled and the circuit is complete. The ride then retests and opens.
- `stacked-lower-selected`: a piece under an overpass is picked through the gap between rails.
- `unfinished-reconnected`: a middle piece of an unfinished track was removed and rebuilt, and the track reconnects.
- `rotated-selected`: selection still works after rotating the view.

`live/`: opencoaster.noriagentic.com after #194 and #195 deployed (commit 7c5857f7).

- **Desktop:** Previous piece selects piece 7, Demolish selected piece leaves 13 pieces, and Build piece brings it back to 14 with the circuit complete. Clicking the station rails on the map selects piece 1.
- **Pixel 8:** tapping a rail in the Select tool, then Edit from this piece, selects piece 12.
