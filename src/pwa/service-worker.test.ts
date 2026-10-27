import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
const ORIGIN = 'https://example.test';
const SCOPE = `${ORIGIN}/opencoaster/`;

type Listener = (event: Record<string, unknown>) => void;

interface FakeResponse {
  ok: boolean;
  type: string;
  body: string;
  clone(): FakeResponse;
}

function response(body: string): FakeResponse {
  return { ok: true, type: 'basic', body, clone: () => response(body) };
}

/** Runs the worker script against an in-memory Cache Storage and a scripted network. */
function startWorker(options: {
  version: string;
  network: Map<string, string>;
  stores?: Map<string, Map<string, FakeResponse>>;
}) {
  const listeners = new Map<string, Listener>();
  const stores = options.stores ?? new Map<string, Map<string, FakeResponse>>();
  const fetched: Array<{ url: string; cache?: string }> = [];
  let online = true;
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        addAll: async (requests: Array<{ url: string }>) => {
          for (const request of requests) {
            const body = options.network.get(request.url);
            if (body === undefined) throw new Error(`no network for ${request.url}`);
            store.set(request.url, response(body));
          }
        },
        put: async (request: { url: string }, value: FakeResponse) =>
          void store.set(request.url, value),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: { url: string } | string) => {
      const url = typeof request === 'string' ? request : request.url;
      for (const store of stores.values()) if (store.has(url)) return store.get(url);
      return undefined;
    },
  };
  const self = {
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    location: new URL(`${SCOPE}service-worker.js`),
    registration: { scope: SCOPE },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    __CACHE_VERSION__: options.version,
    __PRECACHE_URLS__: [`${SCOPE}index.html`, `${SCOPE}assets/index-aaa.js`],
  };
  class FakeRequest {
    constructor(
      public url: string,
      public init: { cache?: string } = {},
    ) {}
  }
  const fetchImpl = async (target: string | { url: string }, init?: { cache?: string }) => {
    const input = typeof target === 'string' ? target : target.url;
    fetched.push({ url: input, cache: init?.cache });
    if (!online) throw new Error('offline');
    const body = options.network.get(input);
    if (body === undefined) throw new Error(`no network for ${input}`);
    return response(body);
  };
  new Function('self', 'caches', 'fetch', 'Request', SOURCE)(self, caches, fetchImpl, FakeRequest);

  const dispatch = async (type: string, event: Record<string, unknown> = {}): Promise<unknown> => {
    let result: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({
      ...event,
      waitUntil: (value: Promise<unknown>) => (result = value),
      respondWith: (value: Promise<unknown>) => (result = value),
    });
    return result;
  };
  return {
    stores,
    fetched,
    setOnline: (value: boolean) => (online = value),
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    navigate: (url: string) =>
      dispatch('fetch', {
        request: { url, method: 'GET', mode: 'navigate' },
      }) as Promise<FakeResponse>,
    load: (url: string) =>
      dispatch('fetch', { request: { url, method: 'GET', mode: 'cors' } }) as Promise<FakeResponse>,
  };
}

describe('service worker', () => {
  it('opens the newest page shell on navigation even when an older one is cached', async () => {
    const network = new Map([
      [SCOPE, 'new shell'],
      [`${SCOPE}index.html`, 'new shell'],
      [`${SCOPE}assets/index-aaa.js`, 'js'],
    ]);
    const stale = new Map([['opencoaster-static-old', new Map([[SCOPE, response('old shell')]])]]);
    const worker = startWorker({ version: 'new', network, stores: stale });
    await worker.install();
    await worker.activate();

    const page = await worker.navigate(SCOPE);

    expect(page.body).toBe('new shell');
    expect(worker.fetched.at(-1)).toEqual({ url: SCOPE, cache: 'no-cache' });
    expect((await worker.load(SCOPE))?.body).toBe('new shell');
  });

  it('opens the cached shell when the network is unavailable', async () => {
    const network = new Map([
      [SCOPE, 'shell'],
      [`${SCOPE}index.html`, 'shell'],
      [`${SCOPE}assets/index-aaa.js`, 'js'],
    ]);
    const worker = startWorker({ version: 'v', network });
    await worker.install();
    await worker.navigate(SCOPE);
    worker.setOnline(false);

    expect((await worker.navigate(SCOPE)).body).toBe('shell');
    expect((await worker.navigate(`${SCOPE}?park=1`)).body).toBe('shell');
  });

  it('serves built assets from the cache and fetches the rest once', async () => {
    const network = new Map([
      [`${SCOPE}index.html`, 's'],
      [`${SCOPE}assets/index-aaa.js`, 'js'],
      [`${SCOPE}sprites/a.png`, 'png'],
    ]);
    const worker = startWorker({ version: 'v', network });
    await worker.install();
    const before = worker.fetched.length;

    expect((await worker.load(`${SCOPE}assets/index-aaa.js`)).body).toBe('js');
    expect(worker.fetched.length).toBe(before);
    await worker.load(`${SCOPE}sprites/a.png`);
    await worker.load(`${SCOPE}sprites/a.png`);
    expect(worker.fetched.length).toBe(before + 1);
  });

  it('precaches past the browser HTTP cache and drops the caches of earlier builds', async () => {
    const network = new Map([
      [`${SCOPE}index.html`, 's'],
      [`${SCOPE}assets/index-aaa.js`, 'js'],
    ]);
    const stores = new Map([
      ['opencoaster-static-previous', new Map<string, FakeResponse>()],
      ['unrelated', new Map<string, FakeResponse>()],
    ]);
    const worker = startWorker({ version: 'current', network, stores });

    await worker.install();
    await worker.activate();

    expect([...worker.stores.keys()].sort()).toEqual(['opencoaster-static-current', 'unrelated']);
  });
});
