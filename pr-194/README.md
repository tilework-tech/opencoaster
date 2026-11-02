# PR #194 proof: edit a coaster from a selected piece

`before/`: main's code. A click on a middle rail in the track tool only reports that the circuit is complete, and Demolish last piece removes the end piece.

`after/<renderer>-<device>-<flow>/`: captures from `e2e/track-edit-selection.spec.ts`. Each `*.png` is a crop around the clicked piece, and each `*-full.png` is the whole screen.

- `circuit-selected`: the clicked middle piece (7 of 14) is highlighted. Selecting does not change the track.
- `circuit-gap`: that piece is demolished. The other 13 pieces stay, and the selection moves to the piece before the gap with a build preview.
- `circuit-rebuilt`: the gap is filled and the circuit is complete. The ride then retests and opens.
- `stacked-lower-selected`: a piece under an overpass is picked through the gap between rails.
- `unfinished-reconnected`: a middle piece of an unfinished track was removed and rebuilt, and the track reconnects.
- `rotated-selected`: selection still works after rotating the view.
