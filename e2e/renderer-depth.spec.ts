import { expect, test } from '@playwright/test';

test('the foreground tree wins its pixel overlap with a guest in every renderer orientation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const samples = await page.evaluate(async () => {
    const [
      { Canvas2DRenderer },
      { WebGL2Renderer },
      { spritePages },
      { createSnapshot },
      { project },
    ] = await Promise.all([
        import('/src/render/canvas2d-renderer.ts'),
        import('/src/render/webgl2-renderer.ts'),
        import('/src/render/sprite-pages.ts'),
        import('/src/worker/snapshot.ts'),
        import('/src/render/projection.ts'),
      ]);
    const atlas = document.createElement('canvas');
    atlas.width = 64;
    atlas.height = 64;
    const atlasContext = atlas.getContext('2d')!;
    atlasContext.fillStyle = '#e02020';
    atlasContext.fillRect(0, 0, 32, 48);
    atlasContext.fillStyle = '#2050e0';
    atlasContext.fillRect(32, 0, 32, 32);
    spritePages.install(
      {
        pages: [{ file: 'depth-test.png', width: 64, height: 64, category: 'world' }],
        categories: {
          world: { lazy: false, pages: [0] },
          people: { lazy: false, pages: [0] },
        },
        sprites: {
          'scenery/tree-oak': {
            category: 'world',
            frames: [{ page: 0, x: 0, y: 0, width: 32, height: 48 }],
            anchor: { x: 16, y: 48 },
            footprint: { width: 1, height: 1 },
            native: true,
          },
          'people/guest-walk': {
            category: 'people',
            frames: [{ page: 0, x: 32, y: 0, width: 32, height: 32 }],
            anchor: { x: 16, y: 32 },
            footprint: { width: 1, height: 1 },
          },
        },
      },
      new Map([[0, atlas as unknown as ImageBitmap]]),
    );

    const map = {
      width: 8,
      height: 8,
      heights: new Uint8Array(64),
      surface: new Uint8Array(64),
      slope: new Uint8Array(64),
      sceneryElements: Int32Array.of(3, 3, 0, 0, 0),
      sceneryCount: 1,
    };
    const snapshot = createSnapshot({ guests: 1, staff: 0, vehicles: 0, litter: 0 });
    snapshot.guests.count = 1;
    snapshot.guests.data.set([3 * 256 + 128, 3 * 256 + 128, 0, 0]);
    const result: Array<{ rotation: number; backend: string; rgba: number[] }> = [];

    for (const Renderer of [Canvas2DRenderer, WebGL2Renderer]) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const canvas = document.createElement('canvas');
        const renderer = new Renderer();
        const cameraPoint = new Float64Array(2);
        project(3 * 256 + 128, 3 * 256 + 128, 0, map.width, map.height, rotation as 0 | 1 | 2 | 3, cameraPoint);
        renderer.attach(canvas);
        renderer.resize(256, 256, 1);
        renderer.setMap(map);
        renderer.draw(snapshot, {
          x: cameraPoint[0]!,
          y: cameraPoint[1]!,
          zoom: 1,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        const rgba =
          Renderer === Canvas2DRenderer
            ? Array.from(canvas.getContext('2d')!.getImageData(128, 112, 1, 1).data)
            : await new Promise<number[]>((resolve) => {
                const gl = canvas.getContext('webgl2')!;
                const pixel = new Uint8Array(4);
                gl.readPixels(128, canvas.height - 112, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                resolve(Array.from(pixel));
              });
        result.push({ rotation, backend: renderer.backend, rgba });
        renderer.dispose();
      }
    }
    return result;
  });

  expect(samples).toHaveLength(8);
  for (const sample of samples) {
    expect(
      sample.rgba[0],
      `${sample.backend} rotation ${sample.rotation} should show the foreground tree's red pixel`,
    ).toBeGreaterThan(sample.rgba[2]!);
  }
});
