# Hard scenario remixes: proof (PR #190)

Screenshots from the dev build on branch `feat/hard-scenario-remixes`, taken by `e2e/hard-parks-proof.spec.ts` (headless Chromium).

- `*-select-*`: New game list with Terrain, Challenge and Park rules shown before Play.
- `*-overview-*` and `*-ownership-*`: whole map of a fresh game; the ownership shot has the Land rights overlay on (owned land lit, land for sale outlined yellow, rights only outlined blue).
- `*-gate-*`: the gate and arrival path.
- `*-built-*`: the park after the legal play-proof in `bench/hard-parks.test.ts` (gate stalls, first ride and the park's defining move), saved and imported into the browser.
- `*-design-map.png`: generated map at 8 px per tile (owned land outlined magenta; yellow = land for sale; blue = rights; dark = not for sale; dots = trees and rocks; hatching = slopes).

WebGL2 whole-map views of the larger parks, and imported built parks, crash headless SwiftShader in this sandbox. The same happens on `main` with unchanged parks (Lantern Bay, Riverside Fairground) and the repo's Bramblewood save fixture. Those views are therefore shown in Canvas2D; WebGL2 shots cover the rest.

## Copper Ridge

### built-canvas2d-desktop
![Copper Ridge copper-ridge-built-canvas2d-desktop.png](copper-ridge-built-canvas2d-desktop.png)

### built-canvas2d-mobile
![Copper Ridge copper-ridge-built-canvas2d-mobile.png](copper-ridge-built-canvas2d-mobile.png)

### built-wide-canvas2d-desktop
![Copper Ridge copper-ridge-built-wide-canvas2d-desktop.png](copper-ridge-built-wide-canvas2d-desktop.png)

### built-wide-canvas2d-mobile
![Copper Ridge copper-ridge-built-wide-canvas2d-mobile.png](copper-ridge-built-wide-canvas2d-mobile.png)

### design-map
![Copper Ridge copper-ridge-design-map.png](copper-ridge-design-map.png)

### gate-canvas2d-desktop
![Copper Ridge copper-ridge-gate-canvas2d-desktop.png](copper-ridge-gate-canvas2d-desktop.png)

### gate-webgl2-desktop
![Copper Ridge copper-ridge-gate-webgl2-desktop.png](copper-ridge-gate-webgl2-desktop.png)

### gate-webgl2-mobile
![Copper Ridge copper-ridge-gate-webgl2-mobile.png](copper-ridge-gate-webgl2-mobile.png)

### overview-canvas2d-desktop
![Copper Ridge copper-ridge-overview-canvas2d-desktop.png](copper-ridge-overview-canvas2d-desktop.png)

### overview-webgl2-desktop
![Copper Ridge copper-ridge-overview-webgl2-desktop.png](copper-ridge-overview-webgl2-desktop.png)

### overview-webgl2-mobile
![Copper Ridge copper-ridge-overview-webgl2-mobile.png](copper-ridge-overview-webgl2-mobile.png)

### ownership-canvas2d-desktop
![Copper Ridge copper-ridge-ownership-canvas2d-desktop.png](copper-ridge-ownership-canvas2d-desktop.png)

### ownership-webgl2-desktop
![Copper Ridge copper-ridge-ownership-webgl2-desktop.png](copper-ridge-ownership-webgl2-desktop.png)

### ownership-webgl2-mobile
![Copper Ridge copper-ridge-ownership-webgl2-mobile.png](copper-ridge-ownership-webgl2-mobile.png)

### select-canvas2d-desktop
![Copper Ridge copper-ridge-select-canvas2d-desktop.png](copper-ridge-select-canvas2d-desktop.png)

### select-canvas2d-mobile
![Copper Ridge copper-ridge-select-canvas2d-mobile.png](copper-ridge-select-canvas2d-mobile.png)

### select-webgl2-desktop
![Copper Ridge copper-ridge-select-webgl2-desktop.png](copper-ridge-select-webgl2-desktop.png)

### select-webgl2-mobile
![Copper Ridge copper-ridge-select-webgl2-mobile.png](copper-ridge-select-webgl2-mobile.png)

## Tidewater Docks

### built-canvas2d-desktop
![Tidewater Docks tidewater-docks-built-canvas2d-desktop.png](tidewater-docks-built-canvas2d-desktop.png)

### built-canvas2d-mobile
![Tidewater Docks tidewater-docks-built-canvas2d-mobile.png](tidewater-docks-built-canvas2d-mobile.png)

### built-wide-canvas2d-desktop
![Tidewater Docks tidewater-docks-built-wide-canvas2d-desktop.png](tidewater-docks-built-wide-canvas2d-desktop.png)

### built-wide-canvas2d-mobile
![Tidewater Docks tidewater-docks-built-wide-canvas2d-mobile.png](tidewater-docks-built-wide-canvas2d-mobile.png)

### design-map
![Tidewater Docks tidewater-docks-design-map.png](tidewater-docks-design-map.png)

### gate-canvas2d-desktop
![Tidewater Docks tidewater-docks-gate-canvas2d-desktop.png](tidewater-docks-gate-canvas2d-desktop.png)

### overview-canvas2d-desktop
![Tidewater Docks tidewater-docks-overview-canvas2d-desktop.png](tidewater-docks-overview-canvas2d-desktop.png)

### ownership-canvas2d-desktop
![Tidewater Docks tidewater-docks-ownership-canvas2d-desktop.png](tidewater-docks-ownership-canvas2d-desktop.png)

### select-canvas2d-desktop
![Tidewater Docks tidewater-docks-select-canvas2d-desktop.png](tidewater-docks-select-canvas2d-desktop.png)

### select-canvas2d-mobile
![Tidewater Docks tidewater-docks-select-canvas2d-mobile.png](tidewater-docks-select-canvas2d-mobile.png)

### select-webgl2-desktop
![Tidewater Docks tidewater-docks-select-webgl2-desktop.png](tidewater-docks-select-webgl2-desktop.png)

### select-webgl2-mobile
![Tidewater Docks tidewater-docks-select-webgl2-mobile.png](tidewater-docks-select-webgl2-mobile.png)

## Thunderhead Mesa

### built-canvas2d-desktop
![Thunderhead Mesa thunderhead-mesa-built-canvas2d-desktop.png](thunderhead-mesa-built-canvas2d-desktop.png)

### built-canvas2d-mobile
![Thunderhead Mesa thunderhead-mesa-built-canvas2d-mobile.png](thunderhead-mesa-built-canvas2d-mobile.png)

### built-wide-canvas2d-desktop
![Thunderhead Mesa thunderhead-mesa-built-wide-canvas2d-desktop.png](thunderhead-mesa-built-wide-canvas2d-desktop.png)

### built-wide-canvas2d-mobile
![Thunderhead Mesa thunderhead-mesa-built-wide-canvas2d-mobile.png](thunderhead-mesa-built-wide-canvas2d-mobile.png)

### design-map
![Thunderhead Mesa thunderhead-mesa-design-map.png](thunderhead-mesa-design-map.png)

### gate-canvas2d-desktop
![Thunderhead Mesa thunderhead-mesa-gate-canvas2d-desktop.png](thunderhead-mesa-gate-canvas2d-desktop.png)

### gate-webgl2-desktop
![Thunderhead Mesa thunderhead-mesa-gate-webgl2-desktop.png](thunderhead-mesa-gate-webgl2-desktop.png)

### gate-webgl2-mobile
![Thunderhead Mesa thunderhead-mesa-gate-webgl2-mobile.png](thunderhead-mesa-gate-webgl2-mobile.png)

### overview-canvas2d-desktop
![Thunderhead Mesa thunderhead-mesa-overview-canvas2d-desktop.png](thunderhead-mesa-overview-canvas2d-desktop.png)

### overview-webgl2-desktop
![Thunderhead Mesa thunderhead-mesa-overview-webgl2-desktop.png](thunderhead-mesa-overview-webgl2-desktop.png)

### overview-webgl2-mobile
![Thunderhead Mesa thunderhead-mesa-overview-webgl2-mobile.png](thunderhead-mesa-overview-webgl2-mobile.png)

### ownership-canvas2d-desktop
![Thunderhead Mesa thunderhead-mesa-ownership-canvas2d-desktop.png](thunderhead-mesa-ownership-canvas2d-desktop.png)

### ownership-webgl2-desktop
![Thunderhead Mesa thunderhead-mesa-ownership-webgl2-desktop.png](thunderhead-mesa-ownership-webgl2-desktop.png)

### ownership-webgl2-mobile
![Thunderhead Mesa thunderhead-mesa-ownership-webgl2-mobile.png](thunderhead-mesa-ownership-webgl2-mobile.png)

### select-canvas2d-desktop
![Thunderhead Mesa thunderhead-mesa-select-canvas2d-desktop.png](thunderhead-mesa-select-canvas2d-desktop.png)

### select-canvas2d-mobile
![Thunderhead Mesa thunderhead-mesa-select-canvas2d-mobile.png](thunderhead-mesa-select-canvas2d-mobile.png)

### select-webgl2-desktop
![Thunderhead Mesa thunderhead-mesa-select-webgl2-desktop.png](thunderhead-mesa-select-webgl2-desktop.png)

### select-webgl2-mobile
![Thunderhead Mesa thunderhead-mesa-select-webgl2-mobile.png](thunderhead-mesa-select-webgl2-mobile.png)

## Glacier Point

### built-canvas2d-desktop
![Glacier Point glacier-point-built-canvas2d-desktop.png](glacier-point-built-canvas2d-desktop.png)

### built-canvas2d-mobile
![Glacier Point glacier-point-built-canvas2d-mobile.png](glacier-point-built-canvas2d-mobile.png)

### built-wide-canvas2d-desktop
![Glacier Point glacier-point-built-wide-canvas2d-desktop.png](glacier-point-built-wide-canvas2d-desktop.png)

### built-wide-canvas2d-mobile
![Glacier Point glacier-point-built-wide-canvas2d-mobile.png](glacier-point-built-wide-canvas2d-mobile.png)

### design-map
![Glacier Point glacier-point-design-map.png](glacier-point-design-map.png)

### gate-canvas2d-desktop
![Glacier Point glacier-point-gate-canvas2d-desktop.png](glacier-point-gate-canvas2d-desktop.png)

### gate-webgl2-desktop
![Glacier Point glacier-point-gate-webgl2-desktop.png](glacier-point-gate-webgl2-desktop.png)

### gate-webgl2-mobile
![Glacier Point glacier-point-gate-webgl2-mobile.png](glacier-point-gate-webgl2-mobile.png)

### overview-canvas2d-desktop
![Glacier Point glacier-point-overview-canvas2d-desktop.png](glacier-point-overview-canvas2d-desktop.png)

### overview-webgl2-desktop
![Glacier Point glacier-point-overview-webgl2-desktop.png](glacier-point-overview-webgl2-desktop.png)

### overview-webgl2-mobile
![Glacier Point glacier-point-overview-webgl2-mobile.png](glacier-point-overview-webgl2-mobile.png)

### ownership-canvas2d-desktop
![Glacier Point glacier-point-ownership-canvas2d-desktop.png](glacier-point-ownership-canvas2d-desktop.png)

### ownership-webgl2-desktop
![Glacier Point glacier-point-ownership-webgl2-desktop.png](glacier-point-ownership-webgl2-desktop.png)

### ownership-webgl2-mobile
![Glacier Point glacier-point-ownership-webgl2-mobile.png](glacier-point-ownership-webgl2-mobile.png)

### select-canvas2d-desktop
![Glacier Point glacier-point-select-canvas2d-desktop.png](glacier-point-select-canvas2d-desktop.png)

### select-canvas2d-mobile
![Glacier Point glacier-point-select-canvas2d-mobile.png](glacier-point-select-canvas2d-mobile.png)

### select-webgl2-desktop
![Glacier Point glacier-point-select-webgl2-desktop.png](glacier-point-select-webgl2-desktop.png)

### select-webgl2-mobile
![Glacier Point glacier-point-select-webgl2-mobile.png](glacier-point-select-webgl2-mobile.png)

## Mossgrove Isle

### built-canvas2d-desktop
![Mossgrove Isle mossgrove-isle-built-canvas2d-desktop.png](mossgrove-isle-built-canvas2d-desktop.png)

### built-canvas2d-mobile
![Mossgrove Isle mossgrove-isle-built-canvas2d-mobile.png](mossgrove-isle-built-canvas2d-mobile.png)

### built-wide-canvas2d-desktop
![Mossgrove Isle mossgrove-isle-built-wide-canvas2d-desktop.png](mossgrove-isle-built-wide-canvas2d-desktop.png)

### built-wide-canvas2d-mobile
![Mossgrove Isle mossgrove-isle-built-wide-canvas2d-mobile.png](mossgrove-isle-built-wide-canvas2d-mobile.png)

### design-map
![Mossgrove Isle mossgrove-isle-design-map.png](mossgrove-isle-design-map.png)

### gate-canvas2d-desktop
![Mossgrove Isle mossgrove-isle-gate-canvas2d-desktop.png](mossgrove-isle-gate-canvas2d-desktop.png)

### gate-webgl2-desktop
![Mossgrove Isle mossgrove-isle-gate-webgl2-desktop.png](mossgrove-isle-gate-webgl2-desktop.png)

### gate-webgl2-mobile
![Mossgrove Isle mossgrove-isle-gate-webgl2-mobile.png](mossgrove-isle-gate-webgl2-mobile.png)

### overview-canvas2d-desktop
![Mossgrove Isle mossgrove-isle-overview-canvas2d-desktop.png](mossgrove-isle-overview-canvas2d-desktop.png)

### overview-webgl2-desktop
![Mossgrove Isle mossgrove-isle-overview-webgl2-desktop.png](mossgrove-isle-overview-webgl2-desktop.png)

### overview-webgl2-mobile
![Mossgrove Isle mossgrove-isle-overview-webgl2-mobile.png](mossgrove-isle-overview-webgl2-mobile.png)

### ownership-canvas2d-desktop
![Mossgrove Isle mossgrove-isle-ownership-canvas2d-desktop.png](mossgrove-isle-ownership-canvas2d-desktop.png)

### ownership-webgl2-desktop
![Mossgrove Isle mossgrove-isle-ownership-webgl2-desktop.png](mossgrove-isle-ownership-webgl2-desktop.png)

### ownership-webgl2-mobile
![Mossgrove Isle mossgrove-isle-ownership-webgl2-mobile.png](mossgrove-isle-ownership-webgl2-mobile.png)

### select-canvas2d-desktop
![Mossgrove Isle mossgrove-isle-select-canvas2d-desktop.png](mossgrove-isle-select-canvas2d-desktop.png)

### select-canvas2d-mobile
![Mossgrove Isle mossgrove-isle-select-canvas2d-mobile.png](mossgrove-isle-select-canvas2d-mobile.png)

### select-webgl2-desktop
![Mossgrove Isle mossgrove-isle-select-webgl2-desktop.png](mossgrove-isle-select-webgl2-desktop.png)

### select-webgl2-mobile
![Mossgrove Isle mossgrove-isle-select-webgl2-mobile.png](mossgrove-isle-select-webgl2-mobile.png)
