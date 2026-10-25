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
      { rotateTile, unrotateTile },
      { pathSpriteName, terrainSurfaceSpriteName },
    ] = await Promise.all([
      import('/src/render/canvas2d-renderer.ts'),
      import('/src/render/webgl2-renderer.ts'),
      import('/src/render/sprite-pages.ts'),
      import('/src/worker/snapshot.ts'),
      import('/src/render/projection.ts'),
      import('/src/render/projection.ts'),
      import('/src/render/world-art.ts'),
    ]);
    const atlas = document.createElement('canvas');
    atlas.width = 96;
    atlas.height = 64;
    const guestAtlas = document.createElement('canvas');
    guestAtlas.width = 32;
    guestAtlas.height = 32;
    guestAtlas.getContext('2d')!.fillStyle = '#2050e0';
    guestAtlas.getContext('2d')!.fillRect(0, 0, 32, 32);
    const atlasContext = atlas.getContext('2d')!;
    atlasContext.fillStyle = '#e02020';
    atlasContext.fillRect(0, 0, 32, 48);
    atlasContext.fillRect(32, 0, 32, 32);
    atlasContext.fillStyle = '#5aa24a';
    atlasContext.fillRect(64, 0, 32, 32);
    const spriteCatalog: Record<string, unknown> = {
      'trees/tree-oak': {
        category: 'world',
        frames: [{ page: 0, x: 0, y: 0, width: 32, height: 48 }],
        anchor: { x: 16, y: 48 },
        footprint: { width: 1, height: 1 },
        native: true,
      },
      'people/guest-walk': {
        category: 'people',
        frames: [{ page: 1, x: 0, y: 0, width: 32, height: 32 }],
        anchor: { x: 16, y: 32 },
        footprint: { width: 1, height: 1 },
      },
    };
    spriteCatalog[terrainSurfaceSpriteName('grass')] = {
      category: 'world',
      frames: [{ page: 0, x: 64, y: 0, width: 32, height: 32 }],
      anchor: { x: 0, y: 0 },
      footprint: { width: 1, height: 1 },
    };
    for (let rotation = 0; rotation < 4; rotation++)
      spriteCatalog[pathSpriteName('tarmac', 0, undefined, rotation as 0 | 1 | 2 | 3)] = {
        category: 'world',
        frames: [{ page: 0, x: 32, y: 0, width: 32, height: 32 }],
        anchor: { x: 16, y: 16 },
        footprint: { width: 1, height: 1 },
      };
    spritePages.install(
      {
        pages: [
          { file: 'depth-tree.png', width: 96, height: 64, category: 'world' },
          { file: 'depth-guest.png', width: 32, height: 32, category: 'people' },
        ],
        categories: {
          world: { lazy: false, pages: [0] },
          people: { lazy: false, pages: [0] },
        },
        sprites: spriteCatalog as never,
      },
      new Map([
        [0, atlas as unknown as ImageBitmap],
        [1, guestAtlas as unknown as ImageBitmap],
      ]),
    );

    const map = {
      width: 8,
      height: 8,
      heights: new Uint8Array(64),
      surface: new Uint8Array(64),
      slope: new Uint8Array(64),
      sceneryElements: Int32Array.of(3, 3, 0, 0, 0),
      sceneryCount: 1,
      pathElements: new Int32Array(0),
      pathCount: 0,
    };
    const snapshot = createSnapshot({ guests: 1, staff: 0, vehicles: 0, litter: 0 });
    snapshot.guests.count = 1;
    snapshot.guests.data.set([3 * 256 + 192, 3 * 256 + 128, 0, 0]);
    const result: Array<{
      rotation: number;
      backend: string;
      rgba: number[];
      guestOnly: number[];
      pathOverlap: number[];
      pathOnly: number[];
      hillOverlap: number[];
      hillOnly: number[];
    }> = [];

    for (const Renderer of [Canvas2DRenderer, WebGL2Renderer]) {
      for (let rotation = 0; rotation < 4; rotation++) {
        map.sceneryCount = 1;
        map.pathElements = new Int32Array(0);
        map.pathCount = 0;
        snapshot.guests.data.set([3 * 256 + 192, 3 * 256 + 128, 0, 0]);
        const canvas = document.createElement('canvas');
        const renderer = new Renderer();
        const cameraPoint = new Float64Array(2);
        project(
          3 * 256 + 128,
          3 * 256 + 128,
          0,
          map.width,
          map.height,
          rotation as 0 | 1 | 2 | 3,
          cameraPoint,
        );
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
        const guestPoint = new Float64Array(2);
        project(
          3 * 256 + 192,
          3 * 256 + 128,
          0,
          map.width,
          map.height,
          rotation as 0 | 1 | 2 | 3,
          guestPoint,
        );
        const guestX = Math.round(128 + Math.sign(guestPoint[0]! - cameraPoint[0]!) * 23);
        const guestOnly =
          Renderer === Canvas2DRenderer
            ? Array.from(canvas.getContext('2d')!.getImageData(guestX, 112, 1, 1).data)
            : await new Promise<number[]>((resolve) => {
                const gl = canvas.getContext('webgl2')!;
                const pixel = new Uint8Array(4);
                gl.readPixels(guestX, canvas.height - 112, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                resolve(Array.from(pixel));
              });
        map.sceneryCount = 0;
        map.pathElements = Int32Array.of(3, 3, 0, 0, 0, 0);
        map.pathCount = 1;
        snapshot.guests.data.set([3 * 256 + 128, 3 * 256 + 128, 0, 0]);
        snapshot.guests.count = 0;
        renderer.setMap(map);
        renderer.draw(snapshot, {
          x: cameraPoint[0]!,
          y: cameraPoint[1]!,
          zoom: 1,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        const pathOnly =
          Renderer === Canvas2DRenderer
            ? Array.from(canvas.getContext('2d')!.getImageData(128, 116, 1, 1).data)
            : await new Promise<number[]>((resolve) => {
                const gl = canvas.getContext('webgl2')!;
                const pixel = new Uint8Array(4);
                gl.readPixels(128, canvas.height - 116, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                resolve(Array.from(pixel));
              });
        snapshot.guests.count = 1;
        renderer.draw(snapshot, {
          x: cameraPoint[0]!,
          y: cameraPoint[1]!,
          zoom: 1,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        const pathOverlap =
          Renderer === Canvas2DRenderer
            ? Array.from(canvas.getContext('2d')!.getImageData(128, 116, 1, 1).data)
            : await new Promise<number[]>((resolve) => {
                const gl = canvas.getContext('webgl2')!;
                const pixel = new Uint8Array(4);
                gl.readPixels(128, canvas.height - 116, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                resolve(Array.from(pixel));
              });
        map.pathElements = new Int32Array(0);
        map.pathCount = 0;
        const hillHeights = map.heights.slice();
        hillHeights.fill(0);
        const [guestViewX, guestViewY] = rotateTile(
          3,
          3,
          map.width,
          map.height,
          rotation as 0 | 1 | 2 | 3,
        );
        const [hillX, hillY] = unrotateTile(
          guestViewX + 1,
          guestViewY,
          map.width,
          map.height,
          rotation as 0 | 1 | 2 | 3,
        );
        hillHeights[hillY * map.width + hillX] = 2;
        const hillMap = { ...map, heights: hillHeights };
        renderer.setMap(hillMap);
        snapshot.guests.count = 0;
        renderer.draw(snapshot, {
          x: cameraPoint[0]!,
          y: cameraPoint[1]!,
          zoom: 1,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        const hillOnly =
          Renderer === Canvas2DRenderer
            ? Array.from(canvas.getContext('2d')!.getImageData(140, 112, 1, 1).data)
            : await new Promise<number[]>((resolve) => {
                const gl = canvas.getContext('webgl2')!;
                const pixel = new Uint8Array(4);
                gl.readPixels(140, canvas.height - 112, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                resolve(Array.from(pixel));
              });
        snapshot.guests.count = 1;
        renderer.draw(snapshot, {
          x: cameraPoint[0]!,
          y: cameraPoint[1]!,
          zoom: 1,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        const hillOverlap =
          Renderer === Canvas2DRenderer
            ? Array.from(canvas.getContext('2d')!.getImageData(140, 112, 1, 1).data)
            : await new Promise<number[]>((resolve) => {
                const gl = canvas.getContext('webgl2')!;
                const pixel = new Uint8Array(4);
                gl.readPixels(140, canvas.height - 112, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                resolve(Array.from(pixel));
              });
        result.push({
          rotation,
          backend: renderer.backend,
          rgba,
          guestOnly,
          pathOverlap,
          pathOnly,
          hillOverlap,
          hillOnly,
        });
        renderer.dispose();
      }
    }
    return result;
  });

  expect(samples).toHaveLength(8);
  for (const sample of samples) {
    expect(
      sample.rgba[0],
      `${sample.backend} rotation ${sample.rotation} should show the foreground tree's red pixel; samples=${JSON.stringify(samples)}`,
    ).toBeGreaterThan(200);
    expect(sample.pathOnly[0]).toBeGreaterThan(200);
    expect(sample.pathOnly[1]).toBeLessThan(60);
    expect(sample.pathOnly[2]).toBeLessThan(60);
    expect(sample.rgba[1]).toBeLessThan(60);
    expect(sample.rgba[2]).toBeLessThan(60);
    expect(sample.guestOnly[0]).toBeLessThan(60);
    expect(sample.guestOnly[2]).toBeGreaterThan(200);
    expect(
      sample.pathOverlap[2],
      `${sample.backend} rotation ${sample.rotation} should show the guest in front of a path`,
    ).toBeGreaterThan(200);
    expect(
      sample.hillOverlap[2],
      `${sample.backend} rotation ${sample.rotation} should show raised terrain in front of a lower guest; samples=${JSON.stringify(samples)}`,
    ).toBeLessThan(150);
    expect(sample.hillOverlap).toEqual(sample.hillOnly);
  }
});
