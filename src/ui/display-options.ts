/** Switches in Game options > Display. They live in the browser's local storage, not in a save. */
export type DisplayOption =
  | 'height-labels'
  | 'gridlines'
  | 'construction-marker'
  | 'performance-overlay'
  | 'underground-view'
  | 'reduce-resolution-when-slow'
  | 'day-night-cycle'
  | 'lamp-lighting';

const ON_BY_DEFAULT: ReadonlySet<DisplayOption> = new Set(['day-night-cycle', 'lamp-lighting']);

export function displayOptionKey(option: DisplayOption): string {
  return `opencoaster-option-${option}`;
}

export function displayOptionEnabled(
  option: DisplayOption,
  storage: Storage = localStorage,
): boolean {
  const stored = storage.getItem(displayOptionKey(option));
  return stored === null ? ON_BY_DEFAULT.has(option) : stored === 'true';
}

export function setDisplayOption(
  option: DisplayOption,
  enabled: boolean,
  storage: Storage = localStorage,
): void {
  storage.setItem(displayOptionKey(option), String(enabled));
}
