# OpenCoaster save and HTTPS evidence

Captured 2026-10-29 UTC in the headed session browser. No browser storage was cleared, no pre-existing slot was overwritten, and only disposable new sandbox parks were used.

## Save failure on deployed HTTP

- URL: `http://opencoaster.noriagentic.com/`
- Origin is insecure (`isSecureContext: false`); `typeof crypto.randomUUID` is `undefined`; `crypto.getRandomValues` is available; IndexedDB is available and `opencoaster-saves` opens successfully.
- Manual “Save to new slot” displayed exactly: `Failed: crypto.randomUUID is not a function`.
- The UI catches the exception, so there was no unhandled page error or save-related console/network/storage failure. The failure occurred before the IndexedDB write, while building the new slot ID.
- Export save file completed and the browser download event had no failure. The app has no autosave implementation.
- Screenshot: `live-http-save-error.png`.

## Fix verification on an insecure local origin

- Local Vite app at `http://172.20.20.201:4173/` is also insecure, with `crypto.randomUUID` unavailable, but `crypto.getRandomValues` and IndexedDB available.
- After the fallback, manual save showed `Game saved.`. After page reload and loading the saved slot, the restored simulation serialized as save version 34, with sandbox entrance `[63, 95]`, edge spawn `{x:63,y:127}`, and 4,686 ambient tree tiles.
- Screenshots: `local-insecure-save-success.png` and `local-insecure-restored.png`.
- Regression E2E is `e2e/save-persistence.spec.ts`; it simulates the missing UUID API in a secure Playwright context and compares the saved/restored entrance, spawns and tree positions.

## HTTPS status

- DNS resolves `opencoaster.noriagentic.com` to the configured `tilework-tech.github.io` GitHub Pages CNAME target. The existing CNAME was previously confirmed INSYNC; no DNS change was made in this run.
- On 2026-10-29 05:55 UTC, TLS served a Let’s Encrypt certificate for `*.github.io`, with SANs `*.github.com`, `*.github.io`, `*.githubusercontent.com`, `github.com`, `github.io`, and `githubusercontent.com`. It does not cover `opencoaster.noriagentic.com`; strict `curl https://...` fails with error 60 hostname mismatch.
- HTTP returns 200 and does not redirect. HTTPS enforcement is not confirmed/enabled.
- `gh api repos/tilework-tech/opencoaster/pages` returns 403 `Resource not accessible by integration`. No settings, DNS, certificate validation bypass, or production deployment change was attempted.
