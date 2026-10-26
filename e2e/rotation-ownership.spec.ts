import { expect, test } from '@playwright/test';

/**
 * Renders a fixture park holding one of every placed object kind in all four rotations in both
 * renderers. Every sprite is a solid block of a colour unique to its object kind, anchored on its
 * bottom centre, so the pixel just above the projected anchor must belong to that object.
 */
test('every fixture object owns the pixels at its projected anchor in all rotations and both renderers', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const report = await page.evaluate(async () => {
    const [
      { Canvas2DRenderer },
      { WebGL2Renderer },
      { spritePages },
      { createSnapshot, RideFlag, RideInfo, RIDE_INFO_STRIDE },
      { worldToScreen, rotateDirection },
      { PathFlag },
      { RideType },
    ] = await Promise.all([
      import('/src/render/canvas2d-renderer.ts'),
      import('/src/render/webgl2-renderer.ts'),
      import('/src/render/sprite-pages.ts'),
      import('/src/worker/snapshot.ts'),
      import('/src/render/projection.ts'),
      import('/src/sim/map/tile-map.ts'),
      import('/src/sim/rides/ride-types.ts'),
    ]);

    type Rot = 0 | 1 | 2 | 3;
    const W = 14;
    const H = 12;
    const map = {
      width: W,
      height: H,
      heights: new Uint8Array(W * H),
      surface: new Uint8Array(W * H).fill(4),
      slope: new Uint8Array(W * H),
      pathElements: Int32Array.from([
        // plain path, bench path (two open edges), queue path
        2,
        2,
        0,
        0b0100,
        0,
        0,
        6,
        2,
        0,
        PathFlag.Bench | 0b0101,
        0,
        0,
        10,
        2,
        0,
        PathFlag.Queue | 0b0101,
        0,
        0,
        // path in front of the stall
        3,
        8,
        0,
        0b0100,
        0,
        0,
      ]),
      pathCount: 4,
      sceneryElements: Int32Array.from([2, 5, 0, 0, 0, 6, 5, 0, 0, 5]),
      sceneryCount: 2,
      entranceX: 12,
      entranceY: 6,
    };
    const snapshot = createSnapshot({
      guests: 1,
      staff: 1,
      vehicles: 0,
      litter: 1,
      rides: 4,
      mapTiles: W * H,
    });
    snapshot.park.entranceX = 12;
    snapshot.park.entranceY = 6;
    snapshot.grounds[4 * W + 12] = 0x10;
    const fixed = (v: number) => Math.round(v * 256);
    snapshot.guests.count = 1;
    snapshot.guests.data.set([fixed(10.5), fixed(5.5), 0, 3 | (1 << 16)]);
    snapshot.staff.count = 1;
    snapshot.staff.data.set([fixed(5.5), fixed(10.5), 0, 1 | (1 << 8)]);
    snapshot.litter.count = 1;
    snapshot.litter.data.set([fixed(8.5), fixed(10.5), 0, 0]);
    snapshot.rides.count = 2;
    const setRide = (i: number, type: number, x: number, y: number, hut = false) => {
      const o = i * RIDE_INFO_STRIDE;
      snapshot.rideInfo[o + RideInfo.Id] = i;
      snapshot.rideInfo[o + RideInfo.Type] = type;
      snapshot.rideInfo[o + RideInfo.RideX] = x;
      snapshot.rideInfo[o + RideInfo.RideY] = y;
      if (hut) {
        snapshot.rideInfo[o + RideInfo.Flags] = RideFlag.EntrancePlaced | RideFlag.ExitPlaced;
        snapshot.rideInfo[o + RideInfo.EntranceX] = x;
        snapshot.rideInfo[o + RideInfo.EntranceY] = y - 1;
        snapshot.rideInfo[o + RideInfo.ExitX] = x + 1;
        snapshot.rideInfo[o + RideInfo.ExitY] = y;
      }
      snapshot.rides.data.set([x * 256, y * 256, 0, i], i * 4);
    };
    setRide(0, RideType.MerryGoRound, 9, 8, true);
    setRide(1, RideType.FoodStall, 2, 8);

    interface Target {
      name: string;
      prefix: string;
      colour: [number, number, number];
      x: number;
      y: number;
      view?: (r: Rot) => number;
      /** Vertical pixel range above the anchor searched for the colour (edge-pivoted sprites). */
      search?: [number, number];
    }
    const targets: Target[] = [
      { name: 'path', prefix: 'paths/tarmac', colour: [200, 40, 40], x: 2.5, y: 2.5 },
      { name: 'queue', prefix: 'paths/queue', colour: [40, 40, 200], x: 10.5, y: 2.5 },
      { name: 'oak', prefix: 'trees/tree-oak', colour: [250, 140, 0], x: 2.5, y: 5.5 },
      { name: 'hedge', prefix: 'scenery/hedge', colour: [0, 200, 200], x: 6.5, y: 5.5 },
      { name: 'stall', prefix: 'stalls/', colour: [220, 0, 220], x: 2.5, y: 8.5 },
      { name: 'ride', prefix: 'rides/flat/merry', colour: [250, 250, 0], x: 9.5, y: 8.5 },
      {
        name: 'entrance',
        prefix: 'rides/flat/stations/',
        colour: [120, 60, 250],
        x: 9.5,
        y: 7.5,
      },
      { name: 'gate', prefix: 'scenery/park-entrance', colour: [250, 120, 160], x: 12.5, y: 6.5 },
      { name: 'guest', prefix: 'people/guest-walk', colour: [255, 255, 255], x: 10.5, y: 5.5 },
      { name: 'staff', prefix: 'people/staff/', colour: [0, 0, 0], x: 5.5, y: 10.5 },
      { name: 'litter', prefix: 'litter/', colour: [140, 90, 20], x: 8.5, y: 10.5 },
      {
        name: 'flower bed',
        prefix: 'scenery/flower-bed',
        colour: [20, 120, 250],
        x: 12.5,
        y: 4.5,
        search: [-30, 24],
      },
    ];
    // Bench stands 96/256 tile toward each open edge of its path tile.
    const colourOf = (key: string): [number, number, number] | null => {
      if (key.startsWith('scenery/bench/')) return key === '' ? null : [120, 250, 120];
      const hit = targets.find((t) => key.startsWith(t.prefix));
      return hit ? hit.colour : null;
    };

    // Pass 1: harvest every requested sprite name.
    const names = new Set<string>();
    const realResolve = spritePages.resolve.bind(spritePages);
    spritePages.resolve = (name: string) => {
      names.add(name);
      return undefined;
    };
    const harvest = async (Renderer: new () => InstanceType<typeof Canvas2DRenderer>) => {
      for (let rotation = 0; rotation < 4; rotation++) {
        const canvas = document.createElement('canvas');
        const renderer = new Renderer();
        renderer.attach(canvas);
        renderer.resize(900, 520, 1);
        renderer.setMap(map as never);
        const [hx, hy] = worldToScreen(W / 2, H / 2, 0, rotation as Rot, map);
        renderer.draw(snapshot, { x: hx, y: hy, zoom: 1, rotation: rotation as Rot });
      }
    };
    await harvest(Canvas2DRenderer);
    await harvest(WebGL2Renderer as never);
    spritePages.resolve = realResolve;

    // Install one 24x24 block per name; ground and everything unclaimed gets a mid-grey-green.
    const list = [...names].filter((n) => !n.includes('#') || true).map((n) => n.split('#')[0]!);
    const unique = [...new Set(list)];
    const SIZE = 24;
    const page = document.createElement('canvas');
    page.width = SIZE * unique.length;
    page.height = SIZE;
    const g = page.getContext('2d')!;
    const sprites: Record<string, unknown> = {};
    unique.forEach((name, i) => {
      const c = colourOf(name);
      const isGround = name.startsWith('terrain/') || name.startsWith('water/');
      const fill = c ?? (isGround ? [60, 110, 60] : [90, 90, 90]);
      g.fillStyle = `rgb(${fill.join(',')})`;
      g.fillRect(i * SIZE, 0, SIZE, SIZE);
      sprites[name] = {
        category: 'world',
        frames: Array.from({ length: 160 }, () => ({
          page: 0,
          x: i * SIZE,
          y: 0,
          width: SIZE,
          height: SIZE,
        })),
        anchor: { x: SIZE / 2, y: isGround ? SIZE / 2 : SIZE },
        footprint: { width: 1, height: 1 },
        native: true,
      };
    });
    spritePages.install(
      {
        pages: [{ file: 'own.png', width: page.width, height: page.height, category: 'world' }],
        categories: { world: { lazy: false, pages: [0] } },
        sprites: sprites as never,
      },
      new Map([[0, page as unknown as ImageBitmap]]),
    );

    // Pass 2: draw and sample.
    const VIEW_W = 900;
    const VIEW_H = 520;
    const misses: string[] = [];
    let checked = 0;
    for (const [backend, Renderer] of [
      ['canvas2d', Canvas2DRenderer],
      ['webgl2', WebGL2Renderer],
    ] as const) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const rot = rotation as Rot;
        const canvas = document.createElement('canvas');
        const renderer = new (Renderer as new () => InstanceType<typeof Canvas2DRenderer>)();
        renderer.attach(canvas);
        renderer.resize(VIEW_W, VIEW_H, 1);
        renderer.setMap(map as never);
        const [cx, cy] = worldToScreen(W / 2, H / 2, 0, rot, map);
        renderer.draw(snapshot, { x: cx, y: cy, zoom: 1, rotation: rot });
        const read = (sx: number, sy: number): number[] => {
          if (backend === 'canvas2d')
            return Array.from(canvas.getContext('2d')!.getImageData(sx, sy, 1, 1).data);
          const gl = canvas.getContext('webgl2')!;
          const pixel = new Uint8Array(4);
          gl.readPixels(sx, canvas.height - 1 - sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return Array.from(pixel);
        };
        const owned = [...targets];
        for (const edge of [1, 3]) {
          const d = [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ][edge]!;
          owned.push({
            name: `bench edge ${edge}`,
            prefix: 'scenery/bench/',
            colour: [120, 250, 120],
            x: 6.5 + d[0]! * 0.375,
            y: 2.5 + d[1]! * 0.375,
            view: (r) => rotateDirection(edge, r),
          });
        }
        for (const t of owned) {
          const [ax, ay] = worldToScreen(t.x, t.y, 0, rot, map);
          const px = Math.round(VIEW_W / 2 + (ax - cx));
          const baseY = Math.round(VIEW_H / 2 + (ay - cy));
          const [from, to] = t.search ?? [-6, -6];
          let best = Infinity;
          let last: number[] = [];
          for (let dy = from; dy <= to; dy++) {
            last = read(px, baseY + dy);
            best = Math.min(best, Math.max(...t.colour.map((c, i) => Math.abs(c - last[i]!))));
          }
          checked++;
          if (best > 24) misses.push(`${backend} r${rotation} ${t.name}: got ${last.join(',')}`);
        }
      }
    }
    return { checked, misses };
  });

  expect(report.checked).toBeGreaterThan(80);
  expect(report.misses).toEqual([]);
});

test('coaster circuit tiles keep world ownership beside path and stall in every view', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const report = await page.evaluate(async () => {
    const [
      { Canvas2DRenderer },
      { WebGL2Renderer },
      { CoasterScene },
      { spritePages },
      { worldToScreen },
      { createSnapshot, writeSnapshot, RideInfo, RIDE_INFO_STRIDE },
      { buildCircuit, connectStation, createCoaster, flatOwnedSim },
      { RideType },
    ] = await Promise.all([
      import('/src/render/canvas2d-renderer.ts'),
      import('/src/render/webgl2-renderer.ts'),
      import('/src/render/coaster-scene.ts'),
      import('/src/render/sprite-pages.ts'),
      import('/src/render/projection.ts'),
      import('/src/worker/snapshot.ts'),
      import('/src/sim/rides/coaster-fixtures.ts'),
      import('/src/sim/rides/ride-types.ts'),
    ]);
    const sim = flatOwnedSim(31);
    const rideId = createCoaster(sim, RideType.WoodenCoaster);
    buildCircuit(sim, rideId);
    connectStation(sim, rideId);
    const stallId = createCoaster(sim, RideType.FoodStall, 22, 18);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    sim.step();
    sim.step();
    const world = sim.world;
    const width = world.map.width;
    const height = world.map.height;
    const snapshot = createSnapshot({
      guests: 0,
      staff: 0,
      vehicles: 8,
      cars: 64,
      litter: 0,
      rides: 4,
      tracks: 64,
      mapTiles: width * height,
    });
    writeSnapshot(world, snapshot);
    if (snapshot.tracks.count < 10 || snapshot.cars.count === 0)
      throw new Error('coaster circuit or test train is missing from the render snapshot');
    const map = {
      width,
      height,
      heights: world.map.heights,
      surface: world.map.surface,
      slope: world.map.slope,
      waterLevel: world.map.waterLevel,
      pathElements: Int32Array.from([20, 19, 2, 0b1111, 0, 0]),
      pathCount: 1,
    };
    spritePages.start();
    const manifestDeadline = Date.now() + 15_000;
    while (spritePages.pageInfos.length === 0) {
      if (Date.now() > manifestDeadline) throw new Error('sprite manifest did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const categories = ['coaster-wood', 'people', 'stalls', 'vehicles', 'world'];
    for (const category of categories) spritePages.requestCategory(category);
    const deadline = Date.now() + 30_000;
    while (categories.some((category) => !spritePages.isLoaded(category))) {
      if (Date.now() > deadline) throw new Error('track sprite pages did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const grid = document.createElement('main');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(4,450px);gap:8px;padding:12px;background:#182312;color:white;font:14px sans-serif';
    document.body.replaceChildren(grid);
    const scene = new CoasterScene();
    const checked: string[] = [];
    for (let rotation = 0; rotation < 4; rotation++) {
      scene.build(snapshot, map, rotation);
      const track = scene.items.find((item) => item.key.includes('/track/station/'));
      if (!track) throw new Error('station track sprite was not built');
      const trackScreen = worldToScreen(track.x / 256, track.y / 256, track.z / 64, rotation, map);
      const expectedTrack = worldToScreen(20.5, 20.5, 2, rotation, map);
      if (Math.hypot(trackScreen[0] - expectedTrack[0], trackScreen[1] - expectedTrack[1]) > 1)
        throw new Error(`station moved from its world tile at rotation ${rotation}`);
      if (!scene.items.some((item) => item.key.includes('/vehicles/car/')))
        throw new Error(`test train is not being drawn at rotation ${rotation}`);
      const path = worldToScreen(20.5, 19.5, 2, rotation, map);
      const stall = worldToScreen(22.5, 18.5, 2, rotation, map);
      const relativeTrackPath = [trackScreen[0] - path[0], trackScreen[1] - path[1]];
      const canonicalRelative = [expectedTrack[0] - path[0], expectedTrack[1] - path[1]];
      if (
        Math.hypot(
          relativeTrackPath[0] - canonicalRelative[0],
          relativeTrackPath[1] - canonicalRelative[1],
        ) > 1
      )
        throw new Error(`track to path offset changed at rotation ${rotation}`);
      const relativeTrackStall = [trackScreen[0] - stall[0], trackScreen[1] - stall[1]];
      const canonicalTrackStall = [expectedTrack[0] - stall[0], expectedTrack[1] - stall[1]];
      if (
        Math.hypot(
          relativeTrackStall[0] - canonicalTrackStall[0],
          relativeTrackStall[1] - canonicalTrackStall[1],
        ) > 1
      )
        throw new Error(`track to stall offset changed at rotation ${rotation}`);
      const stallIndex = Array.from({ length: snapshot.rides.count }, (_, i) => i).find(
        (i) => snapshot.rideInfo[i * RIDE_INFO_STRIDE + RideInfo.Id] === stallId,
      );
      if (stallIndex === undefined) throw new Error('stall is missing from rendered ride data');
      if (
        snapshot.rideInfo[stallIndex * RIDE_INFO_STRIDE + RideInfo.RideX] !== 22 ||
        snapshot.rideInfo[stallIndex * RIDE_INFO_STRIDE + RideInfo.RideY] !== 18
      )
        throw new Error('stall world tile changed');
      const center = worldToScreen(width / 2, height / 2, 0, rotation, map);
      for (const [backend, Renderer] of [
        ['Canvas2D', Canvas2DRenderer],
        ['WebGL2', WebGL2Renderer],
      ] as const) {
        const renderer = new Renderer();
        const canvas = document.createElement('canvas');
        renderer.attach(canvas);
        renderer.resize(450, 260, 1);
        renderer.setMap(map as never);
        renderer.draw(snapshot, { x: center[0], y: center[1], zoom: 1, rotation });
        const panel = document.createElement('section');
        panel.innerHTML = `<h2>${backend} · rotation ${rotation}</h2>`;
        panel.append(canvas);
        grid.append(panel);
      }
      checked.push(`rotation-${rotation}:ride-${rideId}:stall-${stallId}:${Math.round(stall[0])}`);
    }
    return checked;
  });
  expect(report).toHaveLength(4);
  await page.screenshot({
    path: '.local/pr-proof/coaster-circuit-rotations-after.png',
    fullPage: true,
  });
});
