import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { RideType } from '../../src/sim/rides/ride-types';
import { SCENERY_CATALOG } from '../../src/sim/map/scenery';
import { PIECES } from '../../src/sim/track/catalog';
import { PieceMode } from '../../src/sim/track/track-types';
import {
  CAR_BANK_NAMES,
  familyPieces,
  carSpriteKey,
  trackCellSprites,
  trackedRideFamily,
  transportCarSpriteKey,
  transportFamily,
} from '../../src/render/coaster-art';
import {
  facilitySpriteKey,
  rideHutSpriteKey,
  rideSpriteKey,
  rideSpriteName,
  scenerySpriteName,
  terrainCliffSpriteName,
  terrainSpriteName,
  terrainSurfaceSpriteName,
} from '../../src/render/world-art';
import { transportTrackCells } from '../../src/render/coaster-art';
import { isSlicedRide } from '../../src/render/ride-scene';
import { buildSprites } from './generate';
import { TRANSPORT_PIECES, TRANSPORT_STYLES } from './models/transport';
import { ICON_NAMES } from '../../src/ui/icons';
import { preparedSpriteKeys } from '../art/prepared-assets';

export interface ArtCoverageRow {
  group: string;
  item: string;
  assetKeys: string[];
  webgl2: string;
  canvas2d: string;
  missing: string[];
  notes: string;
}

const SURFACES = ['grass', 'dirt', 'sand', 'rock'] as const;
const PATHS = ['tarmac', 'crazy-paving', 'dirt', 'queue'] as const;
const STAFF_ROLES = ['handyman', 'mechanic', 'security', 'entertainer'];
let cachedRows: ArtCoverageRow[] | undefined;
let cachedAvailable: Set<string> | undefined;

function unique(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.split('#')[0]!))];
}

/**
 * Slice keys of a flat ride: every generated `cell-<i>` sprite (tiles without geometry get none),
 * or the first cell of any view with no slice at all, which reports that view as missing.
 */
function flatRideSliceKeys(type: RideType): string[] {
  const name = rideSpriteName(type);
  const generated = [...availableSpriteKeys()].filter(
    (key) => key.startsWith(`${name}/view-`) && key.includes('/cell-'),
  );
  const keys = [...generated];
  for (let view = 0; view < 4; view++)
    if (!generated.some((key) => key.startsWith(`${name}/view-${view}/`)))
      keys.push(`${name}/view-${view}/cell-0`);
  return keys;
}

function trackKeys(family: NonNullable<ReturnType<typeof trackedRideFamily>>): string[] {
  const water = family === 'log-flume' || family === 'river-rapids';
  const modes = water
    ? [PieceMode.WaterLift]
    : [PieceMode.ChainLift, PieceMode.Brake, PieceMode.BlockBrake, PieceMode.Launch];
  const pieces = water
    ? PIECES.filter((piece) =>
        RIDE_CATALOG[
          family === 'log-flume' ? RideType.LogFlume : RideType.RiverRapids
        ].trackRules?.allowedPieces?.includes(piece.id),
      )
    : familyPieces(family);
  return unique(
    pieces.flatMap((piece) =>
      [0, 1, 2, 3].flatMap((rotation) =>
        modes.flatMap((mode) =>
          trackCellSprites(piece.id, 0, rotation, family, mode, 0).map((cell) => cell.key),
        ),
      ),
    ),
  );
}

export function availableSpriteKeys(): ReadonlySet<string> {
  if (cachedAvailable) return cachedAvailable;
  const keys = new Set([...buildSprites().map((sprite) => sprite.key), ...preparedSpriteKeys()]);
  for (const size of [16, 24]) for (const name of ICON_NAMES) keys.add(`ui-icons/${size}/${name}`);
  keys.add('people/guest-walk');
  keys.add('people/staff-costumes');
  keys.add('people/rider-seated');
  cachedAvailable = keys;
  return cachedAvailable;
}

export function spriteCoverageStatus(
  keys: readonly string[],
  available: ReadonlySet<string>,
): { webgl2: string; canvas2d: string } {
  const hasEverySprite = keys.length > 0 && keys.every((key) => available.has(key));
  return {
    webgl2: hasEverySprite ? 'sprite' : 'placeholder',
    canvas2d: hasEverySprite ? 'sprite' : 'placeholder',
  };
}

export function buildArtCoverage(): ArtCoverageRow[] {
  if (cachedRows) return cachedRows;
  const available = availableSpriteKeys();
  const rows: ArtCoverageRow[] = [];
  const add = (
    group: string,
    item: string,
    assetKeys: string[],
    notes: string,
    backends?: readonly [string, string],
  ): void => {
    const keys = unique(assetKeys);
    rows.push({
      group,
      item,
      assetKeys: keys,
      webgl2: backends?.[0] ?? spriteCoverageStatus(keys, available).webgl2,
      canvas2d: backends?.[1] ?? spriteCoverageStatus(keys, available).canvas2d,
      missing: keys.filter((key) => !available.has(key)),
      notes,
    });
  };

  for (const ride of Object.values(RIDE_CATALOG)) {
    const family = trackedRideFamily(ride.id as RideType);
    const keys: string[] = [];
    if (family) {
      keys.push(...trackKeys(family));
      const water = family === 'log-flume' || family === 'river-rapids';
      for (let heading = 0; heading < 8; heading++)
        for (let pitch = -3; pitch <= 3; pitch++)
          for (let rotation = 0; rotation < 4; rotation++)
            for (let bank = 0; bank < (water ? 1 : CAR_BANK_NAMES.length); bank++) {
              if (water) {
                for (let passengers = 0; passengers <= 7; passengers++)
                  keys.push(carSpriteKey(family, heading, pitch, bank, rotation, passengers));
              } else keys.push(carSpriteKey(family, heading, pitch, bank, rotation));
            }
    }
    const transport = transportFamily(ride.id as RideType);
    if (transport) {
      for (const piece of TRANSPORT_PIECES)
        for (let rotation = 0; rotation < 4; rotation++)
          keys.push(
            ...transportTrackCells(piece.id, 0, rotation, transport).map((cell) => cell.key),
          );
      for (let heading = 0; heading < 8; heading++)
        for (let pitch = -2; pitch <= 2; pitch++)
          for (let rotation = 0; rotation < 4; rotation++)
            keys.push(transportCarSpriteKey(transport, heading, pitch, rotation));
    } else if (isSlicedRide(ride.id as RideType))
      keys.push(...flatRideSliceKeys(ride.id as RideType));
    else if (ride.category === 'gentle' || ride.category === 'thrill')
      for (let rotation = 0; rotation < 4; rotation++) keys.push(rideSpriteKey(ride.id, rotation));
    else if (ride.category === 'stall' || ride.category === 'facility')
      for (let facing = 0; facing < 4; facing++)
        for (let rotation = 0; rotation < 4; rotation++)
          keys.push(facilitySpriteKey(ride.id, facing, rotation));
    if (!['stall', 'facility'].includes(ride.category))
      for (const part of ['entrance', 'exit'] as const)
        for (let facing = 0; facing < 4; facing++)
          for (let rotation = 0; rotation < 4; rotation++)
            keys.push(rideHutSpriteKey(ride.id, part, facing, rotation));
    add(
      'Ride',
      ride.name,
      keys,
      `${ride.category}; runtime keys from ride catalogs and render selectors.`,
    );
  }

  for (const family of ['wood', 'steel', 'junior', 'mouse'] as const) {
    for (const piece of familyPieces(family)) {
      const keys = [0, 1, 2, 3].flatMap((rotation) =>
        [
          PieceMode.Normal,
          PieceMode.ChainLift,
          PieceMode.Brake,
          PieceMode.BlockBrake,
          PieceMode.Launch,
        ].flatMap((mode) =>
          trackCellSprites(piece.id, 0, rotation, family, mode, 0).map((cell) => cell.key),
        ),
      );
      add(
        'Coaster piece',
        `${family} / ${piece.name}`,
        keys,
        'Every footprint cell, view, and supported brake/lift variant.',
      );
    }
  }
  for (const style of TRANSPORT_STYLES) {
    for (const piece of TRANSPORT_PIECES) {
      const keys = [0, 1, 2, 3].flatMap((rotation) =>
        transportTrackCells(
          piece.id,
          0,
          rotation,
          style.style as NonNullable<ReturnType<typeof transportFamily>>,
        ).map((cell) => cell.key),
      );
      add(
        'Transport piece',
        `${style.style} / ${piece.name}`,
        keys,
        'Every footprint cell and camera view.',
      );
    }
  }
  for (const piece of PIECES) {
    const waterFamilies = ['log-flume', 'river-rapids'] as const;
    for (const family of waterFamilies) {
      const ride = Object.values(RIDE_CATALOG).find(
        (entry) => entry.name === (family === 'log-flume' ? 'Log Flume' : 'River Rapids'),
      )!;
      if (!ride.trackRules?.allowedPieces?.includes(piece.id)) continue;
      const keys = [0, 1, 2, 3].flatMap((rotation) =>
        [PieceMode.WaterLift].flatMap((mode) =>
          trackCellSprites(piece.id, 0, rotation, family, mode, 0).map((cell) => cell.key),
        ),
      );
      add(
        'Water ride piece',
        `${family} / ${piece.name}`,
        keys,
        'Every footprint cell and allowed lift/view variant.',
      );
    }
  }

  for (const surface of PATHS) {
    for (let mask = 0; mask < 16; mask++)
      add(
        'Path',
        `${surface} / connection ${mask.toString(16).padStart(2, '0')}`,
        [`paths/${surface}/connection-${mask.toString(16).padStart(2, '0')}`],
        'Generated isometric path tile.',
      );
    for (let direction = 0; direction < 4; direction++)
      add(
        'Ramp',
        `${surface} / direction ${direction}`,
        [`paths/${surface}/ramp-${direction}`],
        'Generated sloped tile.',
      );
  }
  for (const surface of SURFACES) {
    for (let slope = 0; slope < 16; slope++)
      add(
        'Terrain surface',
        `${surface} / corner mask ${slope.toString(16)}`,
        [terrainSpriteName(surface, slope)],
        'Prepared authored texture cell; projected to terrain geometry.',
      );
    add(
      'Terrain texture',
      `${surface} / flat`,
      [terrainSurfaceSpriteName(surface)],
      'Prepared surface texture.',
    );
    for (let direction = 0; direction < 4; direction++)
      add(
        'Cliff',
        `${surface} / edge ${direction}`,
        [terrainCliffSpriteName(surface, direction)],
        surface === 'rock'
          ? 'Textured cliff sprite.'
          : 'Textured terrain cliff source; renderer uses it on exposed banks.',
      );
  }
  for (const item of SCENERY_CATALOG)
    add(
      'Scenery',
      item.name,
      item.sprite === 'flower-bed'
        ? Array.from({ length: 16 }, (_, slopeMask) =>
            [0, 1, 2, 3].flatMap((variant) =>
              [0, 1, 2, 3].map((view) =>
                slopeMask === 0
                  ? `scenery/flower-bed/variant-${variant}/view-${view}`
                  : `scenery/flower-bed/slope-${slopeMask}/variant-${variant}/view-${view}`,
              ),
            ),
          ).flat()
        : [...new Set([0, 1, 2, 3].map((rotation) => scenerySpriteName(item.sprite, rotation)))],
      item.sprite === 'flower-bed'
        ? `${item.category}; generated raised flowerbed with four colour variants, four camera views, and all 16 slope masks.`
        : `${item.category}; prepared original prop sprite.`,
    );
  for (const item of ['rain shelter', 'lamp', 'bench', 'bin']) {
    const base = item === 'rain shelter' ? 'scenery/shelter' : `scenery/${item}`;
    const views =
      item === 'rain shelter' ? [0, 1, 2, 3].map((view) => `${base}/view-${view}`) : [base];
    add('Path addition', item, views, 'Rendered from the path element flags.');
  }
  for (const item of ['vandalised bench', 'vandalised bin', 'vandalised lamp']) {
    const base = `scenery/${item.replace('vandalised ', '')}-broken`;
    add(
      'Path addition',
      item,
      [0, 1, 2, 3].map((view) => `${base}/view-${view}`),
      'Selected from the broken-state payload bit.',
    );
  }
  add(
    'Park gate',
    'entrance',
    [0, 1, 2, 3].map((view) => `scenery/park-entrance/view-${view}`),
    'Generated four-view gate sprite.',
  );
  for (let frame = 0; frame < 8; frame++)
    add(
      'Water',
      `surface animation frame ${frame}`,
      [`water/surface#${frame}`],
      'Eight-frame animated surface texture.',
    );
  for (const item of ['trash', 'vomit'])
    add(
      'Litter',
      item,
      [0, 1, 2, 3].map((view) => `litter/${item}/view-${view}`),
      'Generated low-profile world sprite.',
    );
  add(
    'Guests',
    'walking sheet and palette variants',
    ['people/guest-walk'],
    'Prepared original character sheet.',
  );
  add(
    'Guests',
    'seated rider figures',
    ['people/rider-seated'],
    'Generated four-direction seated figure drawn in coaster and transport cars.',
  );
  for (const role of STAFF_ROLES)
    add(
      'Staff',
      role,
      [0, 1, 2, 3].map(
        (direction) => `people/staff/${STAFF_ROLES.indexOf(role)}/direction-${direction}`,
      ),
      'Generated four-direction role sprite with two walking frames.',
    );
  for (const name of ICON_NAMES) {
    add(
      'UI icon',
      name,
      [16, 24].map((size) => `ui-icons/${size}/${name}`),
      'Generated original pixel art; object motifs use the software 3D mesh rasterizer.',
      ['sprite', 'sprite'],
    );
  }
  add(
    'Weather',
    'sun, cloud, rain, storm',
    [],
    'Generated pixel-art status icons and CSS rain overlay.',
    ['pixel art/CSS', 'pixel art/CSS'],
  );
  add(
    'Placement preview',
    'ride and track ghosts',
    [],
    'Preview uses generated ride/track art with intentional validity tint overlays.',
    ['sprite + overlay', 'sprite + overlay'],
  );
  cachedRows = rows;
  return rows;
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderArtCoverageHtml(rows = buildArtCoverage()): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escape(row.group)}</td><td>${escape(row.item)}</td><td>${escape(row.webgl2)}</td><td>${escape(row.canvas2d)}</td><td>${escape(row.assetKeys.join(', ') || '—')}</td><td>${escape(row.missing.join(', ') || row.notes)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenCoaster art coverage</title><style>body{font:14px system-ui,sans-serif;margin:2rem;background:#f1eedf;color:#292a24}h1{font-size:1.5rem}p{max-width:70rem}table{border-collapse:collapse;width:100%;background:#fffdf5}th,td{border:1px solid #aaa58f;text-align:left;padding:.45rem;vertical-align:top}th{position:sticky;top:0;background:#ded8c1}td:nth-child(5){font:12px ui-monospace,monospace;max-width:34rem;overflow-wrap:anywhere}.bad{color:#b22}tr:nth-child(even){background:#f7f4e8}</style><h1>OpenCoaster art coverage (development only)</h1><p>Coverage is checked against runtime key selectors and generated sprite definitions. “Sprite” means authored or model-rendered art is available; procedural or vector elements are called out explicitly in the notes. Missing keys are listed in the final column.</p><table><thead><tr><th>Renderable</th><th>Entry</th><th>WebGL2</th><th>Canvas2D</th><th>Sprite keys</th><th>Evidence / gaps</th></tr></thead><tbody>${body}</tbody></table></html>`;
}

export function renderArtCoverageMarkdown(rows = buildArtCoverage()): string {
  const table = rows
    .map(
      (row) =>
        `| ${row.group} | ${row.item} | ${row.webgl2} | ${row.canvas2d} | ${row.assetKeys.join(', ') || '—'} | ${row.missing.length ? `Missing: ${row.missing.join(', ')}` : row.notes} |`,
    )
    .join('\n');
  return `# Art coverage\n\nAudited against the current ride and scenery catalogs, runtime sprite-key selectors, generator definitions, prepared prop sheets, and both renderers. This table includes every catalog ride and placeable scenery item, all supported track/path/terrain variants, transient entities, weather, UI, and placement previews.\n\n“Sprite” means authored sprite-sheet art or a pre-rendered model sprite. “Vector/CSS” denotes intentional UI artwork and weather effects. “Sprite + overlay” denotes sprite art with an intentional placement-validity tint. Missing keys fail the coverage test. Lazy atlas pages can temporarily use fallback cells while loading; that runtime state is reported separately from whether the key exists.\n\n| Renderable | Entry | WebGL2 | Canvas2D | Required sprite keys | Evidence / notes |\n| --- | --- | --- | --- | --- | --- |\n${table}\n\n## Browser evidence\n\n- Before: [art-coverage-before.png](../screenshots/art-coverage-before.png)\n- After: [art-coverage-after.png](../screenshots/art-coverage-after.png)\n\n## Verification scope\n\nThe automated inventory test enumerates all rides and scenery catalogs, coaster and transport track pieces, water ride pieces, path masks and ramps, terrain surfaces and cliffs, path additions, gate, water frames, staff roles, guests, litter, UI, weather, and placement previews. It fails if a required sprite key is absent. Canvas2D and WebGL2 still retain generic emergency fallback drawing for load failures; these are not used as catalog coverage evidence.\n`;
}

export async function writeArtCoverageReport(): Promise<void> {
  const destination = resolve('docs/art/coverage.md');
  await mkdir(resolve('docs/art'), { recursive: true });
  await writeFile(destination, renderArtCoverageMarkdown());
  console.log(`Wrote ${destination}`);
}

if (process.argv[1]?.endsWith('/coverage.ts')) await writeArtCoverageReport();
