/**
 * Object kinds of world sprites, used to label the renderers' object-ID images (see
 * occlusion-oracle.ts). Ground, water and the land overlay are single shared objects; every other
 * drawn instance gets its own id.
 */
export const GROUND_OBJECT_ID = 1;
export const WATER_OBJECT_ID = 2;
/** The land overlay (unowned land and its sale borders), drawn on the terrain while land tools are open. */
export const LAND_OVERLAY_OBJECT_ID = 3;
/** First id handed to an individual (non-ground, non-water) instance. */
export const FIRST_INSTANCE_OBJECT_ID = 4;

export type ObjectKind =
  | 'guest'
  | 'staff'
  | 'rider'
  | 'path'
  | 'path-addition'
  | 'shelter'
  | 'tree'
  | 'scenery'
  | 'wall'
  | 'flowerbed'
  | 'flat-ride'
  | 'stall'
  | 'entrance'
  | 'exit'
  | 'park-gate'
  | 'track'
  | 'support'
  | 'vehicle'
  | 'litter'
  | 'park-fence'
  | 'land-overlay'
  | 'ground'
  | 'water'
  | 'other';

export const OBJECT_KINDS: readonly ObjectKind[] = [
  'guest',
  'staff',
  'rider',
  'path',
  'path-addition',
  'shelter',
  'tree',
  'scenery',
  'wall',
  'flowerbed',
  'flat-ride',
  'stall',
  'entrance',
  'exit',
  'park-gate',
  'track',
  'support',
  'vehicle',
  'litter',
  'park-fence',
  'land-overlay',
  'ground',
  'water',
  'other',
];

/** Distinct bit per kind, for sets of kinds covering a pixel. */
export function objectKindBit(kind: string): number {
  const index = OBJECT_KINDS.indexOf(kind as ObjectKind);
  return 1 << (index < 0 ? OBJECT_KINDS.length - 1 : index);
}

const PATH_ADDITIONS = new Set([
  'bench',
  'bench-broken',
  'bin',
  'bin-broken',
  'lamp',
  'lamp-broken',
]);

/** Kind of the world object an atlas key (optionally with a `#frame` suffix) draws. */
export function objectKind(spriteKey: string): ObjectKind {
  const hash = spriteKey.indexOf('#');
  const key = hash < 0 ? spriteKey : spriteKey.slice(0, hash);
  const parts = key.split('/');
  const [group, second] = parts;
  switch (group) {
    case 'terrain':
      return 'ground';
    case 'water':
      return 'water';
    case 'paths':
      return parts[1] === 'support' ? 'support' : 'path';
    case 'litter':
      return 'litter';
    case 'trees':
      return 'tree';
    case 'stalls':
      return 'stall';
    case 'track':
      return 'track';
    case 'vehicles':
      return 'vehicle';
    case 'people':
      if (second === 'guest-walk') return 'guest';
      if (second === 'rider-seated') return 'rider';
      if (second === 'staff' || second === 'staff-costumes') return 'staff';
      return 'other';
    case 'scenery':
      if (second === undefined) return 'other';
      if (second === 'park-entrance') return 'park-gate';
      if (second === 'park-fence') return 'park-fence';
      if (second === 'shelter') return 'shelter';
      if (second === 'flower-bed') return 'flowerbed';
      if (PATH_ADDITIONS.has(second)) return 'path-addition';
      if (parts[2]?.startsWith('edge-')) return 'wall';
      return 'scenery';
    case 'rides':
    case 'transport':
      return rideKind(parts);
    default:
      return 'other';
  }
}

function rideKind(parts: readonly string[]): ObjectKind {
  const stations = parts.indexOf('stations');
  if (stations >= 0) {
    if (parts.includes('entrance')) return 'entrance';
    if (parts.includes('exit')) return 'exit';
    return 'other';
  }
  if (parts.includes('track')) return 'track';
  if (parts.includes('vehicles')) return 'vehicle';
  if (parts.some((part) => part.startsWith('support-'))) return 'support';
  if (parts[0] === 'rides' && (parts[1] === 'coaster' || parts[1] === 'water')) return 'other';
  return parts.length >= 3 ? 'flat-ride' : 'other';
}
