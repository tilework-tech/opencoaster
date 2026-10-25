import { CHAIN_FRAMES as RENDER_CHAIN_FRAMES, artPieces } from '../../../../src/render/coaster-art';
import { renderMesh } from '../../raster';
import { clipMesh, rotateMesh, rotatePoint, translateMesh } from '../../mesh';
import type { Mesh } from '../../mesh';
import type { SpriteDef } from '../../output';
import { CAR_BANK_NAMES, CAR_HEADINGS, CAR_PITCH_NAMES, carMesh } from './cars';
import { COASTER_FAMILIES, TRACK_ARTS } from './families';
import { supportBaseMesh, supportSegmentMesh } from './supports';
import { CHAIN_FRAMES, trackPieceMesh, variantsOf } from './track';

if (CHAIN_FRAMES !== RENDER_CHAIN_FRAMES)
  throw new Error('Chain animation length differs between the renderer and the sprite tool');

const ONE_TILE = { width: 1, height: 1 };

/** Track cells, support pieces and cars of every coaster family. */
export function coasterSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const art of TRACK_ARTS) {
    for (const piece of artPieces(art)) {
      for (const variant of variantsOf(piece)) {
        const phases = variant === '+chain' ? CHAIN_FRAMES : 1;
        const locals = Array.from({ length: phases }, (_, phase) =>
          trackPieceMesh(piece, art, variant, phase),
        );
        piece.footprint.forEach((cell, index) => {
          for (let view = 0; view < 4; view++) {
            const centre = rotatePoint([cell.i, cell.j, 0], view);
            const shift = (mesh: Mesh): Mesh => translateMesh(mesh, -centre[0], -centre[1], 0);
            const turned = locals.map((local) => rotateMesh(local, view));
            const cells = turned.map((mesh) =>
              shift(
                clipMesh(mesh, centre[0] - 0.5, centre[0] + 0.5, centre[1] - 0.5, centre[1] + 0.5),
              ),
            );
            if (cells.every((mesh) => mesh.length === 0)) return;
            out.push({
              key: `track/${art}/${piece.name}${variant}/view-${view}/cell-${index}`,
              frames: cells.map((mesh, phase) =>
                renderMesh(mesh, { continuedBy: shift(turned[phase]) }),
              ),
              footprint: ONE_TILE,
            });
          }
        });
      }
    }
  }
  for (const family of COASTER_FAMILIES) {
    for (let view = 0; view < 4; view++) {
      out.push({
        key: `track/${family}/support-column/view-${view}`,
        frames: [renderMesh(rotateMesh(supportSegmentMesh(family, 1), view))],
        footprint: ONE_TILE,
      });
      for (let quarters = 1; quarters <= 3; quarters++)
        out.push({
          key: `track/${family}/support-cap${quarters}/view-${view}`,
          frames: [renderMesh(rotateMesh(supportSegmentMesh(family, quarters / 4), view))],
          footprint: ONE_TILE,
        });
      out.push({
        key: `track/${family}/support-base/view-${view}`,
        frames: [renderMesh(rotateMesh(supportBaseMesh(family), view))],
        footprint: ONE_TILE,
      });
    }
    CAR_PITCH_NAMES.forEach((pitchName, pitchIndex) =>
      CAR_BANK_NAMES.forEach((bankName, bank) => {
        for (let heading = 0; heading < CAR_HEADINGS; heading++)
          out.push({
            key: `vehicles/${family}/car/${pitchName}/${bankName}/heading-${heading}`,
            frames: [renderMesh(carMesh(family, heading, pitchIndex - 3, bank))],
            footprint: ONE_TILE,
          });
      }),
    );
  }
  return out;
}
