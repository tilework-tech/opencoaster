# Noridoc: Progressive Web App

Path: @/src/pwa

### Overview

- Registers the browser service worker that supplies the offline app shell.
- The worker precaches the app shell and built assets, then caches same-origin GET responses as they are used.
- PWA metadata and icons live in the public web root and are linked from [index.html](../../index.html).
- Every URL is relative to the deploy base, so the app works at the origin root (dev) and under a subpath such as GitHub Pages' `/opencoaster/`.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) registers the worker during app startup; browser support or registration failure does not prevent the game from starting.
- [vite.config.ts](../../vite.config.ts) serves a development worker and emits a production worker. Production builds default to a relative base (`./`, overridable with `OC_BASE`), and the worker's precache list is relative to the worker script, so the worker's scope is the deploy base.
- [register.ts](register.ts) and the sprite fetches in [webgl2-renderer.ts](../render/webgl2-renderer.ts) prefix `import.meta.env.BASE_URL`; the deploy workflow is described in [docs/deploy](../../docs/deploy/README.md).
- The worker caches JavaScript modules, worker chunks, and other same-origin requests used by the client. This allows the simulation worker to start when the app is reopened offline after its assets have been cached.
- The web app remains responsible for simulation state and save persistence; service-worker caches hold application resources rather than park saves.

### Core Implementation

- [register.ts](register.ts) calls `navigator.serviceWorker.register` when the API exists and reports registration errors through the browser console.
- [service-worker.js](service-worker.js) installs a versioned cache from the build-generated URL list, removes older OpenCoaster static caches on activation, and claims controlled clients.
- Fetch handling serves a cached response first, otherwise fetches and stores successful basic same-origin responses. Failed navigation requests fall back to the cached shell at the worker's scope.
- [manifest.webmanifest](../../public/manifest.webmanifest) describes standalone launch, orientation, theme colors, and scalable/raster app icons.

### Things to Know

- Offline startup requires one successful online load so the worker can install and cache the shell and requested assets.
- Static cache version changes are the invalidation boundary: activation removes older caches with the OpenCoaster static-cache prefix.
- The PWA layer does not cache or migrate game saves; save slots remain in the save subsystem's IndexedDB or its in-memory fallback.

Created and maintained by Nori.
