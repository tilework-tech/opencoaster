/** Switches in Game options > Display. They live in the browser's local storage, not in a save. */
export type DisplayOption =
  | 'height-labels'
  | 'gridlines'
  | 'construction-marker'
  | 'performance-overlay'
  | 'underground-view';

export function displayOptionKey(option: DisplayOption): string {
  return `opencoaster-option-${option}`;
}

export function displayOptionEnabled(
  option: DisplayOption,
  storage: Storage = localStorage,
): boolean {
  return storage.getItem(displayOptionKey(option)) === 'true';
}

export function setDisplayOption(
  option: DisplayOption,
  enabled: boolean,
  storage: Storage = localStorage,
): void {
  storage.setItem(displayOptionKey(option), String(enabled));
}
