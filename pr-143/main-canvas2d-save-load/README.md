# Canvas2D save-load rendering diagnosis

The main branch at `94dfc83b11a8e1f7d4feab07eb7a3be356b26aba` (current main, #144); the same result was reproduced on its parent `49903c199e5f0eeccc96cc87b38da780f969ef1f` renders the fresh Starter Park normally in Canvas2D and WebGL2. After importing the same prepared Starter Park save used for PR #143's simulation scene, Canvas2D `#game.toDataURL('image/png')` shows terrain fragmented into repeated triangular pieces. WebGL2 renders that imported save with intact terrain. The PR branch at `7ae8538089bb2c70e2045e212997ef875aaa1bd5` shows the same backend-specific result, so this capture path does not isolate a PR #143 regression.

Captures use Playwright Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, a 1280x800 viewport, camera zoom 1, and all 15 sprite categories loaded. The fresh Starter Park Canvas2D baseline is 384x240; after import, Canvas2D is also 384x240 and is exported directly with `canvas.toDataURL`.

The PR #143 proof recapture stopped after reproducing this on current main, as requested. No PR source files were changed and no PR proof comment claiming completion was posted.
