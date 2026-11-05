import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
const ORIGIN = 'https://example.test';
const SCOPE = `${ORIGIN}/opencoaster/`;

type Listener = (event: Record<string, unknown>) => void;

class FakeRequest {
  method = 'GET';
  mode = 'cors';
  constructor(
    public url: string,
    public init: { cache?: string } = {},
  ) {}
}

interface FakeResponse {
  ok: boolean;
  status?: number;
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
  precache?: string[];
  latencyMs?: number;
}) {
  const listeners = new Map<string, Listener>();
  const stores = options.stores ?? new Map<string, Map<string, FakeResponse>>();
  const fetched: Array<{ url: string; cache?: string }> = [];
  let online = true;
  let inFlight = 0;
  let peakInFlight = 0;
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: { url: string } | string, value: FakeResponse) =>
          void store.set(typeof request === 'string' ? request : request.url, value),
        match: async (request: { url: string } | string) =>
          store.get(typeof request === 'string' ? request : request.url),
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
    __PRECACHE_URLS__: options.precache ?? [`${SCOPE}index.html`, `${SCOPE}assets/index-aaa.js`],
  };
  const fetchImpl = async (
    target: string | FakeRequest,
    init?: { cache?: string },
  ): Promise<FakeResponse> => {
    const input = typeof target === 'string' ? target : target.url;
    const cacheMode = init?.cache ?? (typeof target === 'string' ? undefined : target.init.cache);
    fetched.push({ url: input, cache: cacheMode });
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, options.latencyMs ?? 0));
      if (!online) throw new Error('offline');
      const body = options.network.get(input);
      if (body === undefined) return { ...response('Too Many Requests'), ok: false, status: 503 };
      return response(body);
    } finally {
      inFlight--;
    }
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
    peakInFlight: () => peakInFlight,
    setOnline: (value: boolean) => (online = value),
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    navigate: (url: string) =>
      dispatch('fetch', {
        request: { url, method: 'GET', mode: 'navigate' },
      }) as Promise<FakeResponse>,
    load: (url: string) =>
      dispatch('fetch', { request: new FakeRequest(url) }) as Promise<FakeResponse>,
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

  it('resumes a failed precache without downloading what it already stored', async () => {
    const precache = Array.from({ length: 20 }, (_, i) => `${SCOPE}sprites/atlas/page-${i}.png`);
    const network = new Map(precache.map((url) => [url, 'png']));
    network.delete(precache[2]!);
    const first = startWorker({ version: 'v', network, precache });

    await expect(first.install()).rejects.toThrow();
    expect(first.fetched.length).toBeLessThan(precache.length);
    const stored = new Set([...first.stores.values()].flatMap((store) => [...store.keys()]));
    network.set(precache[2]!, 'png');
    const retry = startWorker({ version: 'v', network, precache, stores: first.stores });
    await retry.install();

    const refetched = retry.fetched.map((entry) => entry.url);
    expect(stored.size).toBeGreaterThan(0);
    expect(refetched).toContain(precache[2]);
    expect(refetched.filter((url) => stored.has(url))).toEqual([]);
    expect(refetched.length + stored.size).toBe(precache.length);
    retry.setOnline(false);
    for (const url of precache) expect((await retry.load(url)).body).toBe('png');
  });

  it('downloads each precache file once past the HTTP cache, a few at a time', async () => {
    const precache = Array.from({ length: 200 }, (_, i) => `${SCOPE}sprites/atlas/page-${i}.png`);
    const network = new Map(precache.map((url) => [url, 'png']));
    const worker = startWorker({ version: 'v', network, precache, latencyMs: 1 });

    await worker.install();

    expect(worker.fetched.map((entry) => entry.url).sort()).toEqual([...precache].sort());
    expect(worker.fetched.every((entry) => entry.cache === 'reload')).toBe(true);
    expect(worker.peakInFlight()).toBeGreaterThan(1);
    expect(worker.peakInFlight()).toBeLessThanOrEqual(8);
  });
});
