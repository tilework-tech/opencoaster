import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { precacheUrls } from './precache-urls';

let root = '';

function publicDir(files: string[]): string {
  root = mkdtempSync(join(tmpdir(), 'oc-public-'));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  return root;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('service worker precache list', () => {
  it('holds the built bundle, the shell and the public files the game requests', () => {
    const dir = publicDir([
      'CNAME',
      'manifest.webmanifest',
      'icons/icon.svg',
      'scenario-previews/forest.png',
      'sprites/manifest.json',
      'sprites/atlas/world-0.png',
      'sprites/atlas/world-0.depth.png',
      'sprites/ui-icons/16/pause.png',
      'sprites/rides/coaster/steel/track/flat/view-0/cell-0.png',
      'sprites/rides/coaster/steel/track/flat/view-0/cell-0.json',
      'sprites/scenery/bench/view-0.depth.png',
      'sprites/people/staff-costumes.png',
    ]);

    expect(precacheUrls(['assets/index-abc.js', 'assets/index-abc.css'], dir).sort()).toEqual(
      [
        './',
        'assets/index-abc.css',
        'assets/index-abc.js',
        'icons/icon.svg',
        'index.html',
        'manifest.webmanifest',
        'scenario-previews/forest.png',
        'sprites/atlas/world-0.depth.png',
        'sprites/atlas/world-0.png',
        'sprites/manifest.json',
        'sprites/ui-icons/16/pause.png',
      ].sort(),
    );
  });
});
