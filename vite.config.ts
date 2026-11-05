import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { precacheUrls } from './tools/pwa/precache-urls';

// COOP/COEP make the page cross-origin isolated, which unlocks SharedArrayBuffer and
// high-resolution timers. The current transport (transferable snapshots) does not require
// them, but keeping them on in dev/preview means we notice early if a future dependency breaks
// under isolation, and keeps the SharedArrayBuffer upgrade path open. See docs/ARCHITECTURE.md.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const workerSource = readFileSync(resolve('src/pwa/service-worker.js'), 'utf8');

/** Fills in the worker's precache list and the cache name that ties its caches to one build. */
function buildWorker(urls: string[], version: string): string {
  return workerSource
    .replace('self.__PRECACHE_URLS__', JSON.stringify(urls))
    .replace('self.__CACHE_VERSION__', JSON.stringify(version));
}

function pwaPlugin(): Plugin {
  return {
    name: 'opencoaster-pwa',
    configureServer(server) {
      server.middlewares.use('/service-worker.js', (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Service-Worker-Allowed', '/');
        response.end(buildWorker(['/'], 'dev'));
      });
    },
    generateBundle(_options, bundle) {
      const urls = precacheUrls(
        Object.keys(bundle).filter((fileName) => fileName !== 'service-worker.js'),
        resolve('public'),
      );
      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: buildWorker(urls, Date.now().toString(36)),
      });
    },
  };
}

function artCoveragePlugin(): Plugin {
  return {
    name: 'opencoaster-art-coverage',
    configureServer(server) {
      server.middlewares.use('/__art-coverage', (request, response, next) => {
        if (request.method !== 'GET') return next();
        void import('./tools/sprites/coverage')
          .then(({ renderArtCoverageHtml }) => {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.end(renderArtCoverageHtml());
          })
          .catch((error: unknown) => {
            response.statusCode = 500;
            response.end(
              error instanceof Error ? error.message : 'Could not build the art coverage report',
            );
          });
      });
    },
  };
}

// Production builds default to a relative base so the same dist/ works at the site root or under a
// path prefix such as GitHub Pages' /opencoaster/. Set OC_BASE to pin an absolute base instead.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.OC_BASE ?? './') : '/',
  plugins: [pwaPlugin(), artCoveragePlugin()],
  server: {
    headers: isolationHeaders,
    watch: { ignored: ['**/public/sprites/**'] },
  },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'bench/**/*.test.ts',
      'tools/art/**/*.test.ts',
      'tools/sprites/**/*.test.ts',
      'tools/pwa/**/*.test.ts',
    ],
  },
}));
