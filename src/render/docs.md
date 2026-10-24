# render

Responsibility: main-thread drawing. Consumes `Snapshot` (entity positions) and `MapData` (terrain); never reads sim state.

Interface: `Renderer` (attach/resize/setMap/draw/dispose), `Camera`, projection helpers (`project`, `rotateTile`, `unrotateTile`; 4 view rotations). Shipped: `Canvas2DRenderer` (flat tiles + dots). Planned: `WebGL2Renderer` (design notes in its header comment). Art is procedural/placeholder only.
