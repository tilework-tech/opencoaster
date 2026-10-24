import { defineConfig } from 'vitest/config';

// COOP/COEP make the page cross-origin isolated, which unlocks SharedArrayBuffer and
// high-resolution timers. The current transport (transferable snapshots) does not require
// them, but keeping them on in dev/preview means we notice early if a future dependency breaks
// under isolation, and keeps the SharedArrayBuffer upgrade path open. See docs/ARCHITECTURE.md.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'bench/**/*.test.ts'] },
});
