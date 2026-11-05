# Noridoc: Progressive Web App

Path: @/src/pwa

### Overview

- Registers the browser service worker that supplies the offline app shell.
- In production the worker precaches the built bundle, the page shell, and the public files the game requests at runtime, then caches other same-origin GET responses as they are used.
- PWA metadata and icons live in the public web root and are linked from [index.html](../../index.html).
- Every URL is relative to the deploy base, so the app works at the origin root (dev) and under a subpath such as GitHub Pages' `/opencoaster/`.

### How it fits into the larger codebase

- [src/app/bootstrap/index.ts](../app/bootstrap/index.ts) calls `registerPwa` during app startup; browser support or registration failure does not prevent the game from starting.
- [vite.config.ts](../../vite.config.ts) serves a development worker (precaching only `/`) and emits a production worker. Production builds default to a relative base (`./`, overridable with `OC_BASE`), and the worker's precache list is relative to the worker script, so the worker's scope is the deploy base.
- The production precache list comes from [tools/pwa/precache-urls.ts](../../tools/pwa/precache-urls.ts): bundle files, `index.html`, `./`, and the files under `public/`, except `CNAME` and any `sprites/` file other than the sprite manifest, atlas pages, and UI icons. The rest of `public/sprites/` is per-sprite packer input from [tools/art](../../tools/art/README.md) that the game never requests.
- [register.ts](register.ts), the atlas loader in [sprite-pages.ts](../render/sprite-pages.ts), and the UI icon URLs in [icons.ts](../ui/icons.ts) prefix `import.meta.env.BASE_URL`; the deploy workflow is described in [docs/deploy](../../docs/deploy/README.md).
- The worker caches JavaScript modules, worker chunks, and other same-origin requests used by the client. This allows the simulation worker to start when the app is reopened offline after its assets have been cached.
- The web app remains responsible for simulation state and save persistence; the worker never touches IndexedDB or `localStorage`, so park saves and settings survive worker updates.

### Core Implementation

- [register.ts](register.ts) calls `navigator.serviceWorker.register` when the API exists and reports registration errors through the browser console.
- [service-worker.js](service-worker.js) installs into a cache named for the build (`opencoaster-static-<build stamp>`, filled in by [vite.config.ts](../../vite.config.ts)), removes older OpenCoaster static caches on activation, and claims controlled clients.
- Install downloads the precache list with a small fixed number of downloads in flight, storing each response with `cache.put`. URLs already present in this build's cache are skipped, so an install retried after a failure only downloads what is missing. The first failed or non-OK download empties the queue so no new downloads start, and install rejects once in-flight downloads settle; the worker activates only once the whole list is cached.
- Page navigations go to the network first (`cache: 'no-cache'`, so the browser HTTP cache cannot supply an old shell naming old assets) and update the cache; offline they fall back to the cached page or the shell at the worker's scope. Every other same-origin GET is served from the cache first, otherwise fetched and stored. Install downloads use `cache: 'reload'` for the same reason.
- [manifest.webmanifest](../../public/manifest.webmanifest) describes standalone launch, orientation, theme colors, and scalable/raster app icons.

### Things to Know

- Offline startup requires one successful online load so the worker can install and cache the shell and requested assets.
- The precache list must stay small. Precaching all of `public/` (tens of thousands of per-sprite packer files) in one atomic `cache.addAll` made GitHub Pages answer with 503s; one failed response discarded the whole install, so the page was never controlled and every reload restarted the full download, re-flooding the origin. The filtered list, bounded concurrency, stop-on-first-failure, and resumable install exist to prevent that loop. A new runtime-requested file outside the allowed `sprites/` paths must be added to [precache-urls.ts](../../tools/pwa/precache-urls.ts), or it is only cached on first use.
- Each build has its own cache, and activation removes the caches of earlier builds. A page that is already open keeps running the build it loaded until it is reloaded; the next navigation gets the new build. A browser still running the previous cache-first worker serves its old shell once more before the new worker takes over.
- [returning-visitor.spec.ts](../../smoke/returning-visitor.spec.ts) covers install and repeat visits against the production build (`pnpm smoke:subpath` only): an earlier build's cache is removed, reloads stay controlled, and seeded saves and settings remain intact.
- The PWA layer does not cache or migrate game saves; save slots remain in the save subsystem's IndexedDB or its in-memory fallback.

Created and maintained by Nori.
