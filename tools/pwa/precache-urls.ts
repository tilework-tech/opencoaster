import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function publicFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolutePath = resolve(directory, name);
    const relativePath = `${prefix}${name}`;
    return statSync(absolutePath).isDirectory()
      ? publicFiles(absolutePath, `${relativePath}/`)
      : [relativePath];
  });
}

/**
 * Public files the game requests at runtime. Everything else under `sprites/` is atlas packer
 * input that only `public/` holds (see tools/art/README.md); `CNAME` is for GitHub Pages.
 */
function requestedAtRuntime(file: string): boolean {
  if (file === 'CNAME') return false;
  if (!file.startsWith('sprites/')) return true;
  return (
    file === 'sprites/manifest.json' ||
    file.startsWith('sprites/atlas/') ||
    file.startsWith('sprites/ui-icons/')
  );
}

/** The service worker's precache list, relative to the worker script so it works at any base. */
export function precacheUrls(bundleFiles: string[], publicDirectory: string): string[] {
  return [
    ...bundleFiles,
    'index.html',
    './',
    ...publicFiles(publicDirectory).filter(requestedAtRuntime),
  ];
}
