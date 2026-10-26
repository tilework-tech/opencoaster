/** Pixel-art icon ids shared by toolbar, windows, and compact controls. */
export const ICON_NAMES = [
  'pause',
  'play',
  'speed',
  'fastForward',
  'fastForwardDouble',
  'fastForwardTriple',
  'options',
  'saveLoad',
  'newRide',
  'sound',
  'zoomIn',
  'zoomOut',
  'rotateLeft',
  'rotateRight',
  'view',
  'land',
  'water',
  'scenery',
  'paths',
  'rides',
  'park',
  'award',
  'staff',
  'guests',
  'finances',
  'research',
  'map',
  'menu',
  'close',
  'pin',
  'news',
  'cash',
  'sun',
  'cloud',
  'rain',
  'storm',
  'raise',
  'lower',
  'bin',
  'bench',
  'shelter',
  'flower',
  'lamp',
  'food',
  'drink',
  'info',
  'toilet',
  'coaster',
  'carousel',
  'ship',
  'wheel',
  'twist',
  'straight',
  'curveLeftSmall',
  'curveLeftMedium',
  'curveLeftLarge',
  'curveRightSmall',
  'curveRightMedium',
  'curveRightLarge',
  'station',
  'loop',
  'sBend',
  'corkscrew',
  'helix',
  'slopeDownSteep',
  'slopeDown',
  'slopeLevel',
  'slopeUp',
  'slopeUpSteep',
  'bankLeft',
  'bankNone',
  'bankRight',
  'demolish',
  'build',
  'entrance',
  'exit',
  'next',
  'prev',
  'locate',
  'minus',
  'plus',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export function iconArtKind(name: IconName): 'pixel-art' {
  if (!hasIcon(name)) throw new Error(`Missing pixel-art icon: ${name}`);
  return 'pixel-art';
}

export function iconAssetPath(name: IconName, size: 16 | 24): string {
  return `/sprites/ui-icons/${size}/${name}.png`;
}

/** A decorative generated pixel-art icon; its containing control supplies the accessible name. */
export function icon(name: IconName, size: 16 | 24 = 24): HTMLImageElement {
  const image = document.createElement('img');
  image.className = 'ui-icon';
  image.dataset.iconId = name;
  image.src = iconAssetPath(name, size);
  image.width = size;
  image.height = size;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.style.imageRendering = 'pixelated';
  return image;
}

export function hasIcon(name: string): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}
