/** Small DOM helpers shared by the menu components. */

import { icon } from './icons';
import type { IconName } from './icons';

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  className = 'menu-button',
): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Starts a browser download of in-memory bytes. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/octet-stream' }));
  const link = element('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Hidden file input that reports the chosen file and clears itself, so the same file can be picked again. */
export function fileChooser(onFile: (file: File) => void): HTMLInputElement {
  const input = element('input');
  input.type = 'file';
  input.accept = '.ocsave';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
  return input;
}

/** A button with an icon, an accessible name and an optional visible caption. */
export function iconButton(
  name: IconName,
  label: string,
  onClick: () => void,
  className = 'icon-button',
  caption?: string,
  size: 16 | 24 = 24,
): HTMLButtonElement {
  const node = element('button', className);
  node.type = 'button';
  node.title = label;
  node.setAttribute('aria-label', label);
  node.append(icon(name, size));
  if (caption) node.append(element('span', 'icon-caption', caption));
  node.addEventListener('click', onClick);
  return node;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** A label/value line used by the information windows. */
export function statRow(label: string, value = ''): { row: HTMLElement; value: HTMLElement } {
  const row = element('div', 'stat-row');
  const valueNode = element('span', 'stat-value', value);
  row.append(element('span', 'stat-label', label), valueNode);
  return { row, value: valueNode };
}

/** A horizontal gauge; `set` takes a 0..1 fraction. */
export function gauge(label: string): {
  row: HTMLElement;
  set(fraction: number, text?: string): void;
} {
  const row = element('div', 'gauge-row');
  const fill = element('div', 'gauge-fill');
  const track = element('div', 'gauge-track');
  const text = element('span', 'gauge-text');
  track.append(fill);
  row.append(element('span', 'stat-label', label), track, text);
  return {
    row,
    set(fraction, caption = '') {
      const clamped = Math.max(0, Math.min(1, fraction));
      fill.style.width = `${(clamped * 100).toFixed(1)}%`;
      setText(text, caption);
    },
  };
}
