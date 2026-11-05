const CACHE_NAME = 'opencoaster-static-' + self.__CACHE_VERSION__;
const PRECACHE_URLS = self.__PRECACHE_URLS__;
const PRECACHE_CONCURRENCY = 6;

/**
 * Downloads the precache list a few files at a time into this build's cache, skipping files a
 * failed earlier attempt already stored, so a retried install fetches only what is missing.
 * The first failed download stops the queue, so a throttled server is not sent the rest.
 */
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const pending = [];
  for (const url of PRECACHE_URLS) {
    const request = new Request(url, { cache: 'reload' });
    if (!(await cache.match(request))) pending.push(request);
  }
  const store = async (request) => {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Precache of ${request.url} failed: ${response.status}`);
    await cache.put(request, response);
  };
  const download = async () => {
    for (let request = pending.shift(); request; request = pending.shift()) {
      await store(request).catch((error) => {
        pending.length = 0;
        throw error;
      });
    }
  };
  const results = await Promise.allSettled(Array.from({ length: PRECACHE_CONCURRENCY }, download));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('opencoaster-static-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function remember(request, response) {
  if (!response.ok || response.type !== 'basic') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

/** The page shell names the current build's assets, so it always comes from the network first. */
async function freshShell(request) {
  try {
    const response = await fetch(request.url, { cache: 'no-cache' });
    await remember(request, response);
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) ?? (await caches.match(self.registration.scope));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(freshShell(request));
    return;
  }
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      await remember(request, response);
      return response;
    }),
  );
});
