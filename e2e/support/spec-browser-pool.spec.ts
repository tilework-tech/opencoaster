import { expect, test } from './test';
import { SpecBrowserPool } from './spec-browser-pool';

function fakeBrowser() {
  return { close: async () => {} };
}

test('the spec browser pool reuses a browser for tests in the same spec', async () => {
  const pool = new SpecBrowserPool<ReturnType<typeof fakeBrowser>>();
  let launches = 0;
  const launch = async () => {
    launches++;
    return fakeBrowser();
  };

  const first = await pool.acquire('/e2e/first.spec.ts', launch);
  const second = await pool.acquire('/e2e/first.spec.ts', launch);

  expect(second).toBe(first);
  expect(launches).toBe(1);
  await pool.close();
});

test('the spec browser pool closes browsers when the spec changes and at teardown', async () => {
  const pool = new SpecBrowserPool<ReturnType<typeof fakeBrowser>>();
  let firstClosed = 0;
  let secondClosed = 0;
  const first = { close: async () => firstClosed++ };
  const second = { close: async () => secondClosed++ };

  await pool.acquire('/e2e/first.spec.ts', async () => first);
  await pool.acquire('/e2e/second.spec.ts', async () => second);
  expect(firstClosed).toBe(1);

  await pool.close();
  expect(secondClosed).toBe(1);
});
