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

const options = parseOptions(process.argv.slice(2).filter((arg) => arg !== '--'));
if (!options) {
  process.stdout.write(`${usage()}\n`);
} else {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  runPnpm(root, ['art:prepare']);
  runPnpm(root, ['art:pack']);
  const sessionBrowser = process.env.NORI_SESSION_URL !== undefined;
  const result = spawnSync(
    'corepack',
    [
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--config=playwright.art-review.config.ts',
      '--grep=@art-review',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ART_REVIEW_OUTPUT: resolve(root, options.outputDir),
        ART_REVIEW_FLOWERBEDS_ONLY: options.flowerbedsOnly ? '1' : '0',
        ...(sessionBrowser
          ? { ART_REVIEW_CDP: process.env.ART_REVIEW_CDP ?? 'http://127.0.0.1:9222' }
          : {}),
      },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
