# sim/map

Responsibility: the tile grid (`TileMap`: heights, surface, per-tile flags) and terrain generation.

Interface: `TileMap.index/inBounds/setHeight`, `generateTerrain(map, prng)`. Tiles are flat with an integer height level (`Z_STEP` fixed-point units per level); slopes/corner heights are future work. Flag-bit meanings are owned by whichever module sets them; document each bit here when added.
