import { mkdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { project } from '../src/render/projection';
import type { Rotation } from '../src/render/projection';
import { serialize } from '../src/save/save';
import { buildScene } from './tunnel-proof-scenes';
import type { ProofScene, SceneName } from './tunnel-proof-scenes';
import { toolbarTool } from './footpath-helpers';
import { startOpenGrounds } from './queue-helpers';

/**
 * Renders tunnel scenes built through the simulation for review: close-ups of each portal
 * variant at default and 2x zoom, and the whole tunnel through the land, in every rotation.
 * Runs only when TUNNEL_PROOF_DIR names the output directory; CANVAS2D=1 selects Canvas2D and
 * PROOF_PREFIX names the image set.
 */
const proofDir = process.env.TUNNEL_PROOF_DIR;
const useCanvas2d = process.env.CANVAS2D === '1';
const prefix = process.env.PROOF_PREFIX ?? 'new';
const renderer = useCanvas2d ? 'canvas2d' : 'webgl2';

async function loadScene(page: Page, testInfo: TestInfo, scene: ProofScene): Promise<void> {
  if (useCanvas2d)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return original.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  await startOpenGrounds(page);
  await page.getByRole('button', { name: 'Close Park' }).click();
  const savePath = testInfo.outputPath('scene.park');
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(savePath, serialize(scene.world));
  await toolbarTool(page, 'Save / Load');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
  await expect(page.locator('.hud')).toContainText(useCanvas2d ? 'Canvas2D' : 'WebGL2');
}

async function aim(
  page: Page,
  scene: ProofScene,
  point: readonly [number, number, number],
  zoom: number,
): Promise<void> {
  const rotation = await page.evaluate(
    () => (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
  );
  const at = new Float64Array(2);
  project(
    point[0],
    point[1],
    point[2],
    scene.world.map.width,
    scene.world.map.height,
    rotation as Rotation,
    at,
  );
  await page.evaluate(
    ([x, y, z]) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number } })
        .__camera;
      camera.x = x!;
      camera.y = y!;
      camera.zoom = z!;
    },
    [at[0], at[1], zoom],
  );
  await page.mouse.move(640, 20);
  await page.waitForTimeout(1500);
}

async function capture(page: Page): Promise<Buffer> {
  if (!useCanvas2d) return page.screenshot();
  const url = await page.evaluate(() =>
    (document.querySelector('#game') as HTMLCanvasElement).toDataURL('image/png'),
  );
  return Buffer.from(url.split(',')[1]!, 'base64');
}

async function crop(
  page: Page,
  image: Buffer,
  cx: number,
  cy: number,
  w: number,
  h: number,
): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const scale = meta.width! / page.viewportSize()!.width;
  const box = await page.locator('#game').boundingBox();
  const left = Math.max(0, Math.round((cx - w / 2 - (useCanvas2d ? box!.x : 0)) * scale));
  const top = Math.max(0, Math.round((cy - h / 2 - (useCanvas2d ? box!.y : 0)) * scale));
  return sharp(image)
    .extract({
      left,
      top,
      width: Math.min(Math.round(w * scale), meta.width! - left),
      height: Math.min(Math.round(h * scale), meta.height! - top),
    })
    .resize({ width: Math.round(w * 3), kernel: 'nearest' })
    .png()
    .toBuffer();
}

async function screenPoint(page: Page, scene: ProofScene, p: readonly [number, number, number]) {
  const camera = await page.evaluate(
    () =>
      (
        window as unknown as {
          __camera: { x: number; y: number; zoom: number; rotation: Rotation };
        }
      ).__camera,
  );
  const box = (await page.locator('#game').boundingBox())!;
  const out = new Float64Array(2);
  project(p[0], p[1], p[2], scene.world.map.width, scene.world.map.height, camera.rotation, out);
  return [
    box.x + box.width / 2 + (out[0]! - camera.x) * camera.zoom,
    box.y + box.height / 2 + (out[1]! - camera.y) * camera.zoom,
  ] as const;
}

async function rotate(page: Page): Promise<void> {
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: /^Rotate right/ })
    .click();
}

function save(name: string, image: Buffer): Promise<void> {
  mkdirSync(proofDir!, { recursive: true });
  return writeFile(`${proofDir}/${prefix}-${renderer}-${name}.png`, image);
}

for (const name of ['face', 'slope', 'cut'] as SceneName[]) {
  test(`proof: ${name} portal and the whole tunnel`, async ({ page }, testInfo) => {
    test.skip(!proofDir, 'set TUNNEL_PROOF_DIR to render proof images');
    test.setTimeout(600_000);
    page.setDefaultTimeout(15_000);
    const scene = buildScene(name);
    await loadScene(page, testInfo, scene);
    const mouth = scene.mouths[0]!;
    const entryPoint = [mouth.x, mouth.y, mouth.z] as const;
    const focus = [
      (scene.focus.x + 0.5) * 256,
      (scene.focus.y + 0.5) * 256,
      scene.world.map.heights[scene.world.map.index(scene.focus.x, scene.focus.y)]! * 64,
    ] as const;
    for (let turn = 0; turn < 4; turn++) {
      await aim(page, scene, focus, 1);
      await aim(page, scene, focus, 1);
      await save(`${name}-whole-rot${turn}`, await capture(page));
      const closeups: Buffer[] = [];
      for (const zoom of [1, 2]) {
        await aim(page, scene, entryPoint, zoom);
        const [sx, sy] = await screenPoint(page, scene, entryPoint);
        closeups.push(await crop(page, await capture(page), sx, sy - 12 * zoom, 160, 128));
      }
      await save(`${name}-closeup-zoom1-rot${turn}`, closeups[0]!);
      await save(`${name}-closeup-zoom2-rot${turn}`, closeups[1]!);
      await rotate(page);
    }
  });
}

test('proof: placeholder for tooling', () => {
  expect(true).toBe(true);
});
