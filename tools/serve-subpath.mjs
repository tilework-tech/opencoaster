import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

// Serves a built directory the way GitHub Pages serves a project site: under a path prefix,
// without cross-origin isolation headers.
// Usage: node tools/serve-subpath.mjs [dist] [port] [/prefix/]

const [, , directory = 'dist', port = '4174', prefix = '/opencoaster/'] = process.argv;
const root = resolve(directory);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

async function resolveFile(relativePath) {
  const candidate = normalize(join(root, relativePath));
  if (!candidate.startsWith(root)) return undefined;
  try {
    const info = await stat(candidate);
    const file = info.isDirectory() ? join(candidate, 'index.html') : candidate;
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const file = pathname.startsWith(prefix)
    ? await resolveFile(decodeURIComponent(pathname.slice(prefix.length)))
    : undefined;
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(Number(port), '127.0.0.1');
