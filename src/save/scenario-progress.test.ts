import { describe, expect, it } from 'vitest';
import {
  loadScenarioProgress,
  markScenarioCompleted,
  parseScenarioProgress,
  SCENARIO_PROGRESS_KEY,
} from './scenario-progress';

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

describe('scenario progress', () => {
  it('starts empty and remembers a win across loads', () => {
    const storage = memoryStorage();
    expect(loadScenarioProgress(storage)).toEqual({});
    expect(markScenarioCompleted('alpine', 1000, storage)).toBe(true);
    expect(loadScenarioProgress(storage)).toEqual({ alpine: { completedAt: 1000 } });
  });

  it('keeps the first completion time when a scenario is won again', () => {
    const storage = memoryStorage();
    markScenarioCompleted('alpine', 1000, storage);
    expect(markScenarioCompleted('alpine', 2000, storage)).toBe(false);
    expect(loadScenarioProgress(storage).alpine.completedAt).toBe(1000);
  });

  it('ignores corrupt or malformed storage', () => {
    expect(parseScenarioProgress('{nope')).toEqual({});
    expect(parseScenarioProgress('[1,2]')).toEqual({});
    expect(
      parseScenarioProgress(
        JSON.stringify({ a: { completedAt: 'x' }, b: null, c: { completedAt: 5 } }),
      ),
    ).toEqual({
      c: { completedAt: 5 },
    });
    const storage = memoryStorage();
    storage.setItem(SCENARIO_PROGRESS_KEY, 'garbage');
    expect(markScenarioCompleted('x', 1, storage)).toBe(true);
  });
});
