# PR #197: GitHub Pages reload failure, proof

## Before (live, main @152523b0, clean profile, session Chrome)
- The live worker precached 24,918 URLs; the script alone was 1.68 MB (`before-live/live-worker-precache.json`).
- `before-live/probe-log.json`: across first visit, 3 reloads, a hard reload and a reopened tab, the page was **never controlled** and its cache stayed at 0 entries. Every load restarted the install with 3k–24k worker requests. After a Pages/Fastly `503` (`server: Varnish`, `retry-after: 0`, 54,887-byte HTML body), `addAll` rejected and about 21k in-flight requests were aborted, so the next load started over.

## Upgrade (local, Pages-like subpath server with no COOP/COEP)
- `upgrade-local/upgrade-log.json`: a real main-build worker was installed first (24,918 downloads) with a saved park. After switching to the new build, the first reload downloaded 280 files; every later reload downloaded 1 (the navigation) and served all 54 assets from the worker. The old cache was gone, the save and settings were intact, and Load game listed the save.
- `scripts/cache-delete-timing.mjs`: deleting a 24,918-entry cache takes 6 ms, so cleanup on activation is not a bottleneck.

## After (live, main @5b47730c, same profile the old worker left behind)
- `after-live/live-save.json`: the worker took control after 7.1 s with 278 requests, all 200. The stale cache was removed and a park was saved through the game UI.
- `after-live/probe-log.json` (run with `--keep-storage`): first visit, 3 reloads, a hard reload (DevTools cache disabled) and a reopened tab. On each one the page stayed controlled, made exactly 1 network request (the shell) with 56/56 assets from the worker, kept 1 save, and logged no console errors.
- `after-live/live-load.json` and `live-loaded-park.png`: the saved park appears under Load game and loads.

Scripts: `scripts/reload-probe.mjs <url> <out> [--keep-storage]`, `scripts/live-save.mjs <url> <out> save|load` (both use the session Chrome over CDP), `scripts/upgrade-probe.mjs <old-dist> <new-dist> <out>` (run from the repo root).
