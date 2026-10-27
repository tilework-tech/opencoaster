import { describe, expect, it } from 'vitest';
import { displayOptionEnabled, displayOptionKey, setDisplayOption } from './display-options';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('display options', () => {
  it('are off until switched on', () => {
    const storage = memoryStorage();
    expect(displayOptionEnabled('height-labels', storage)).toBe(false);
    expect(displayOptionEnabled('construction-marker', storage)).toBe(false);
    expect(displayOptionEnabled('reduce-resolution-when-slow', storage)).toBe(false);
  });

  it('persist across reads and can be switched off again', () => {
    const storage = memoryStorage();
    setDisplayOption('height-labels', true, storage);
    expect(displayOptionEnabled('height-labels', storage)).toBe(true);
    expect(displayOptionEnabled('gridlines', storage)).toBe(false);
    setDisplayOption('height-labels', false, storage);
    expect(displayOptionEnabled('height-labels', storage)).toBe(false);
    setDisplayOption('reduce-resolution-when-slow', true, storage);
    expect(displayOptionEnabled('reduce-resolution-when-slow', storage)).toBe(true);
  });

  it('keeps the storage keys the Display window has always used', () => {
    expect(displayOptionKey('gridlines')).toBe('opencoaster-option-gridlines');
    expect(displayOptionKey('reduce-resolution-when-slow')).toBe(
      'opencoaster-option-reduce-resolution-when-slow',
    );
  });
});
