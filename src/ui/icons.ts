/** Original line glyphs (24×24 viewBox) for controls outside the generated icon sheet. */

const GLYPHS = {
  pause: '<path d="M8 5v14M16 5v14" />',
  play: '<path d="M7 4l13 8-13 8z" />',
  speed: '<path d="M4 5l8 7-8 7zM12 5l8 7-8 7z" />',
  options:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  zoomIn: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M10 7v6M7 10h6"/>',
  zoomOut: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M7 10h6"/>',
  rotateLeft: '<path d="M5 9a8 8 0 1 1-1 6"/><path d="M5 3v6h6"/>',
  rotateRight: '<path d="M19 9a8 8 0 1 0 1 6"/><path d="M19 3v6h-6"/>',
  view: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  land: '<path d="M2 20l7-12 4 6 3-4 6 10z"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  scenery: '<path d="M12 3l6 9h-4l5 7H5l5-7H6z"/><path d="M12 19v3"/>',
  paths: '<path d="M9 21L11 3M15 21L13 3M12 7v2M12 12v2M12 17v2"/>',
  rides:
    '<circle cx="12" cy="11" r="7"/><path d="M12 4v14M5 11h14M7 7l10 8M17 7L7 15M8 21l4-3 4 3"/>',
  park: '<path d="M6 21V3M6 4h12l-3 4 3 4H6"/>',
  staff: '<circle cx="12" cy="8" r="4"/><path d="M5 21c0-5 3-8 7-8s7 3 7 8M8 5h8"/>',
  guests:
    '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-4 2-7 6-7s6 3 6 7M15 14c4 0 7 2 7 6"/>',
  finances:
    '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-1-1-5-1.5-5 1s5 1.5 5 4-4.5 2.5-6 1M12 5.5v13"/>',
  research: '<path d="M9 3h6M10 3v6l-6 11h16L14 9V3"/><path d="M7 15h10"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  pin: '<path d="M9 3h6l-1 6 3 3H7l3-3zM12 12v9"/>',
  news: '<path d="M4 5h16v14H4zM8 9h8M8 13h8M8 16h5"/>',
  cash: '<rect x="2" y="7" width="20" height="10" rx="1"/><circle cx="12" cy="12" r="2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 4.5 4.5 0 0 1 17 18z"/>',
  rain: '<path d="M7 14a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 4.5 4.5 4.5 0 0 1 17 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  storm:
    '<path d="M7 13a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 3.5 4.5 4.5 0 0 1 17 13zM12 13l-2 4h4l-2 4"/>',
  raise: '<path d="M12 20V6M6 12l6-6 6 6"/>',
  lower: '<path d="M12 4v14M6 12l6 6 6-6"/>',
  bin: '<path d="M6 7h12l-1 14H7zM4 7h16M9 7V4h6v3"/>',
  bench: '<path d="M3 11h18M5 11v8M19 11v8M4 7h16v4"/>',
  shelter: '<path d="M3 11l9-7 9 7zM6 11v9M18 11v9"/>',
  flower:
    '<circle cx="12" cy="9" r="3"/><path d="M12 3v3M12 12v1M6 9h3M15 9h3M12 13v8M12 17l-4-2M12 18l4-2"/>',
  lamp: '<path d="M8 3h8l2 6H6zM12 9v12M9 21h6"/>',
  food: '<path d="M6 3v7a3 3 0 0 0 6 0V3M9 3v18M18 3c-3 2-3 8 0 9v9"/>',
  drink: '<path d="M6 4h12l-2 17H8zM7 9h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  toilet: '<path d="M7 3h10v7H7zM6 10h12c0 5-2 8-6 8s-6-3-6-8zM9 21h6"/>',
  coaster: '<path d="M2 20L8 5c2 6 3 12 5 5s3-12 9-3M2 20h20"/>',
  carousel: '<path d="M3 9l9-6 9 6zM6 9v9M12 9v9M18 9v9M3 21h18"/>',
  ship: '<path d="M4 6l16 0M12 6v6M5 14l7 5 7-5z"/>',
  wheel:
    '<circle cx="12" cy="11" r="8"/><path d="M12 3v16M4 11h16M6 5l12 12M18 5L6 17M8 22l4-3 4 3"/>',
  twist: '<circle cx="12" cy="12" r="8"/><path d="M12 4c6 4 6 12 0 16M12 4c-6 4-6 12 0 16"/>',
  straight: '<path d="M12 20V4M9 7l3-3 3 3"/>',
  curveLeftSmall: '<path d="M16 20v-4a4 4 0 0 0-4-4h-4M10 9l-3 3 3 3"/>',
  curveLeftMedium: '<path d="M16 20v-6a6 6 0 0 0-6-6H6M9 5L6 8l3 3"/>',
  curveLeftLarge: '<path d="M18 20v-8a8 8 0 0 0-8-8H5M8 1L5 4l3 3" transform="translate(0 2)"/>',
  curveRightSmall: '<path d="M8 20v-4a4 4 0 0 1 4-4h4M14 9l3 3-3 3"/>',
  curveRightMedium: '<path d="M8 20v-6a6 6 0 0 1 6-6h4M15 5l3 3-3 3"/>',
  curveRightLarge: '<path d="M6 20v-8a8 8 0 0 1 8-8h5M16 1l3 3-3 3" transform="translate(0 2)"/>',
  station: '<path d="M4 18h16M6 18V8h12v10M9 12h6"/>',
  loop: '<circle cx="12" cy="9" r="6"/><path d="M12 15l-3 6M12 15l3 6"/>',
  sBend: '<path d="M8 21c0-6 8-6 8-12V3M13 6l3-3 3 3" transform="translate(-2 0)"/>',
  corkscrew: '<path d="M5 18c6 0 6-6 0-6s-6-6 0-6h14M5 12h14"/>',
  helix: '<path d="M4 17c0-6 16-6 16-10M4 12c0-4 16-4 16-8M4 21h16"/>',
  slopeDownSteep: '<path d="M4 4l16 16M14 20h6v-6"/>',
  slopeDown: '<path d="M4 8l16 8M14 17h6v-5"/>',
  slopeLevel: '<path d="M4 12h16M15 8l5 4-5 4"/>',
  slopeUp: '<path d="M4 16l16-8M14 7h6v5"/>',
  slopeUpSteep: '<path d="M4 20L20 4M14 4h6v6"/>',
  bankLeft: '<path d="M4 18l16-6M4 18v-6"/>',
  bankNone: '<path d="M4 15h16"/>',
  bankRight: '<path d="M4 12l16 6M20 18v-6"/>',
  demolish:
    '<path d="M3 18h18M5 15h14l2 3H3zM7 15l1-5h8l2 5M10 10V7h5l2 3M6 19v2M18 19v2M4 12h3M3 10h4"/>',
  build: '<path d="M4 20l9-9M13 5l6 6-3 3-6-6zM14 4l-2-2"/>',
  entrance: '<path d="M3 20V8l9-5 9 5v12M9 20v-7h6v7"/>',
  exit: '<path d="M14 4h6v16h-6M3 12h12M11 8l4 4-4 4"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  prev: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  locate: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
} as const;

export type IconName = keyof typeof GLYPHS;

const SPRITE_ICONS: Partial<Record<IconName, readonly [number, number]>> = {
  land: [0, 0],
  water: [1, 0],
  scenery: [2, 0],
  paths: [3, 0],
  coaster: [1, 1],
  entrance: [2, 1],
  finances: [3, 1],
  park: [0, 2],
  staff: [1, 2],
  guests: [2, 2],
  research: [3, 2],
  zoomIn: [0, 3],
  rotateLeft: [1, 3],
  play: [2, 3],
};

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export function iconArtKind(name: IconName): 'sprite-sheet' | 'vector' {
  return SPRITE_ICONS[name] ? 'sprite-sheet' : 'vector';
}

/** A decorative SVG icon; the caller supplies the accessible name on the control. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const sprite = SPRITE_ICONS[name];
  svg.setAttribute('class', sprite ? 'ui-icon ui-icon-sheet' : 'ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (sprite) {
    svg.style.backgroundPosition = `${(sprite[0] / 3) * 100}% ${(sprite[1] / 3) * 100}%`;
  } else {
    svg.innerHTML = GLYPHS[name];
  }
  return svg;
}

export function hasIcon(name: string): name is IconName {
  return name in GLYPHS;
}
