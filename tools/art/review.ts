import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Options {
  outputDir: string;
  flowerbedsOnly: boolean;
}

function usage(): string {
  return [
    'Usage: pnpm art:review [options]',
    '',
    'Loads the game in Playwright and writes labelled contact sheets to docs/art/review/.',
    '',
    'Options:',
    '  --output <directory>  Write images to another directory',
    '  --flowerbeds-only     Capture flowerbeds at every zoom level',
    '  -h, --help            Show this help without opening a browser',
  ].join('\n');
}

function parseOptions(args: readonly string[]): Options | null {
  const options: Options = {
    outputDir: 'docs/art/review',
    flowerbedsOnly: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') return null;
    if (arg === '--flowerbeds-only') options.flowerbedsOnly = true;
    else if (arg === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output requires a directory');
      options.outputDir = value;
      index++;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function runPnpm(root: string, args: readonly string[]): void {
  const result = spawnSync('corepack', ['pnpm', ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runReviewTests(root: string, env: NodeJS.ProcessEnv, grep: string): number {
  const result = spawnSync(
    'corepack',
    [
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--config=playwright.art-review.config.ts',
      `--grep=${grep}`,
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const options = parseOptions(process.argv.slice(2).filter((arg) => arg !== '--'));
if (!options) {
  process.stdout.write(`${usage()}\n`);
} else {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  runPnpm(root, ['art:prepare']);
  runPnpm(root, ['art:pack']);
  const sessionBrowser = process.env.NORI_SESSION_URL !== undefined;
  const env = {
    ...process.env,
    ART_REVIEW_OUTPUT: resolve(root, options.outputDir),
    ART_REVIEW_FLOWERBEDS_ONLY: options.flowerbedsOnly ? '1' : '0',
    ...(sessionBrowser
      ? { ART_REVIEW_CDP: process.env.ART_REVIEW_CDP ?? 'http://127.0.0.1:9222' }
      : {}),
  };
  const backends = ['webgl2', 'canvas2d'] as const;
  const zooms = [1, 4] as const;
  const rotations = [0, 1, 2, 3] as const;
  if (!options.flowerbedsOnly) {
    for (const backend of backends)
      for (const zoom of zooms)
        for (const rotation of rotations) {
          const title = `captures ${backend} inventory at zoom ${zoom}, rotation ${rotation} @art-review`;
          process.exitCode = runReviewTests(root, env, title);
          if (process.exitCode !== 0) process.exit(process.exitCode);
        }
  }
  process.exitCode = runReviewTests(
    root,
    env,
    'captures flowerbeds across renderers, zooms, and rotations @art-review',
  );
}
