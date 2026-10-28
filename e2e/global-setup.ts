import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tsx = resolve('node_modules/tsx/dist/cli.mjs');

function runArtCommand(script: string, args: string[] = []): void {
  const result = spawnSync(process.execPath, [tsx, script, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${script} exited with status ${result.status ?? result.signal}`);
}

export default function globalSetup(): void {
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
