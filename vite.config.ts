import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// COOP/COEP make the page cross-origin isolated, which unlocks SharedArrayBuffer and
// high-resolution timers. The current transport (transferable snapshots) does not require
// them, but keeping them on in dev/preview means we notice early if a future dependency breaks
// under isolation, and keeps the SharedArrayBuffer upgrade path open. See docs/ARCHITECTURE.md.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const workerSource = readFileSync(resolve('src/pwa/service-worker.js'), 'utf8');

function publicFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolutePath = resolve(directory, name);
    const relativePath = `${prefix}${name}`;
    return statSync(absolutePath).isDirectory()
      ? publicFiles(absolutePath, `${relativePath}/`)
      : [relativePath];
  });
}

function pwaPlugin(): Plugin {
  return {
    name: 'opencoaster-pwa',
    configureServer(server) {
      server.middlewares.use('/service-worker.js', (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Service-Worker-Allowed', '/');
        response.end(workerSource.replace('self.__PRECACHE_URLS__', JSON.stringify(['/'])));
      });
    },
    generateBundle(_options, bundle) {
      // Relative to the worker script, so the precache works at any deploy base (e.g. /opencoaster/).
      const urls = Object.keys(bundle).filter((fileName) => fileName !== 'service-worker.js');
      urls.push('index.html', './', ...publicFiles(resolve('public')));
      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: workerSource.replace('self.__PRECACHE_URLS__', JSON.stringify(urls)),
      });
    },
  };
}

// Production builds default to a relative base so the same dist/ works at the site root or under a
// path prefix such as GitHub Pages' /opencoaster/. Set OC_BASE to pin an absolute base instead.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.OC_BASE ?? './') : '/',
  plugins: [pwaPlugin()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'bench/**/*.test.ts', 'tools/art/**/*.test.ts', 'tools/sprites/**/*.test.ts'],
  },
}));
