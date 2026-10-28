import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const tsx = resolve('node_modules/tsx/dist/cli.mjs');

function runArtCommand(script: string, args: string[] = []): void {
  const result = spawnSync(process.execPath, [tsx, script, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${script} exited with status ${result.status ?? result.signal}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.E2E_SKIP_SPRITE_PREP !== '1') {
    runArtCommand('tools/art/prepare.ts');
    runArtCommand('tools/art/process-sprites.ts', [
      '--input',
      'tools/art/source/staff-costumes.png',
      '--output',
      'public/sprites/people/staff-costumes.png',
      '--name',
      'staff-costumes',
      '--columns',
      '4',
      '--rows',
      '4',
      '--cell-size',
      '32',
      '--palette-variants',
      '1',
    ]);
    runArtCommand('tools/art/pack-cli.ts');
  }

  if (!process.env.CI) {
    const reuseExistingServer = await fetch('http://127.0.0.1:4173/@vite/client')
      .then((response) => response.ok)
      .catch(() => false);
    if (reuseExistingServer) return async () => {};
  }

  const server = await createServer({
    configFile: resolve('vite.config.ts'),
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
  });
  await server.listen();
  return () => server.close();
}
