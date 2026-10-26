# PR #129 proof: Polish visible gameplay details

Before = `main` (b04f9d1), after = PR branch. WebGL2 via SwiftShader (`--use-gl=angle --use-angle=swiftshader`), Canvas2D by hiding WebGL contexts. Desktop 1280x800, Pixel 8 emulation.


## 1. Litter (default zoom, zoom 4)


**webgl2 / desktop**

| before: 1a-litter-default-zoom | before: 1b-litter-zoom4 | after: 1a-litter-default-zoom | after: 1b-litter-zoom4 |
|---|---|---|---|
| ![before-webgl2-desktop-1a-litter-default-zoom.png](litter/before-webgl2-desktop-1a-litter-default-zoom.png) | ![before-webgl2-desktop-1b-litter-zoom4.png](litter/before-webgl2-desktop-1b-litter-zoom4.png) | ![after-webgl2-desktop-1a-litter-default-zoom.png](litter/after-webgl2-desktop-1a-litter-default-zoom.png) | ![after-webgl2-desktop-1b-litter-zoom4.png](litter/after-webgl2-desktop-1b-litter-zoom4.png) |

**webgl2 / pixel8**

| before: 1a-litter-default-zoom | before: 1b-litter-zoom4 | after: 1a-litter-default-zoom | after: 1b-litter-zoom4 |
|---|---|---|---|
| ![before-webgl2-pixel8-1a-litter-default-zoom.png](litter/before-webgl2-pixel8-1a-litter-default-zoom.png) | ![before-webgl2-pixel8-1b-litter-zoom4.png](litter/before-webgl2-pixel8-1b-litter-zoom4.png) | ![after-webgl2-pixel8-1a-litter-default-zoom.png](litter/after-webgl2-pixel8-1a-litter-default-zoom.png) | ![after-webgl2-pixel8-1b-litter-zoom4.png](litter/after-webgl2-pixel8-1b-litter-zoom4.png) |

**canvas2d / desktop**

| before: 1a-litter-default-zoom | before: 1b-litter-zoom4 | after: 1a-litter-default-zoom | after: 1b-litter-zoom4 |
|---|---|---|---|
| ![before-canvas2d-desktop-1a-litter-default-zoom.png](litter/before-canvas2d-desktop-1a-litter-default-zoom.png) | ![before-canvas2d-desktop-1b-litter-zoom4.png](litter/before-canvas2d-desktop-1b-litter-zoom4.png) | ![after-canvas2d-desktop-1a-litter-default-zoom.png](litter/after-canvas2d-desktop-1a-litter-default-zoom.png) | ![after-canvas2d-desktop-1b-litter-zoom4.png](litter/after-canvas2d-desktop-1b-litter-zoom4.png) |

**canvas2d / pixel8**

| before: 1a-litter-default-zoom | before: 1b-litter-zoom4 | after: 1a-litter-default-zoom | after: 1b-litter-zoom4 |
|---|---|---|---|
| ![before-canvas2d-pixel8-1a-litter-default-zoom.png](litter/before-canvas2d-pixel8-1a-litter-default-zoom.png) | ![before-canvas2d-pixel8-1b-litter-zoom4.png](litter/before-canvas2d-pixel8-1b-litter-zoom4.png) | ![after-canvas2d-pixel8-1a-litter-default-zoom.png](litter/after-canvas2d-pixel8-1a-litter-default-zoom.png) | ![after-canvas2d-pixel8-1b-litter-zoom4.png](litter/after-canvas2d-pixel8-1b-litter-zoom4.png) |

## 2. Ride window preview (Merry-Go-Round, coaster)


**webgl2 / desktop**

| before: 2a-ride-window-merry-go-round | before: 2b-ride-window-coaster | after: 2a-ride-window-merry-go-round | after: 2b-ride-window-coaster |
|---|---|---|---|
| ![before-webgl2-desktop-2a-ride-window-merry-go-round.png](ui/before-webgl2-desktop-2a-ride-window-merry-go-round.png) | ![before-webgl2-desktop-2b-ride-window-coaster.png](ui/before-webgl2-desktop-2b-ride-window-coaster.png) | ![after-webgl2-desktop-2a-ride-window-merry-go-round.png](ui/after-webgl2-desktop-2a-ride-window-merry-go-round.png) | ![after-webgl2-desktop-2b-ride-window-coaster.png](ui/after-webgl2-desktop-2b-ride-window-coaster.png) |

**webgl2 / pixel8**

| before: 2a-ride-window-merry-go-round | before: 2b-ride-window-coaster | after: 2a-ride-window-merry-go-round | after: 2b-ride-window-coaster |
|---|---|---|---|
| ![before-webgl2-pixel8-2a-ride-window-merry-go-round.png](ui/before-webgl2-pixel8-2a-ride-window-merry-go-round.png) | ![before-webgl2-pixel8-2b-ride-window-coaster.png](ui/before-webgl2-pixel8-2b-ride-window-coaster.png) | ![after-webgl2-pixel8-2a-ride-window-merry-go-round.png](ui/after-webgl2-pixel8-2a-ride-window-merry-go-round.png) | ![after-webgl2-pixel8-2b-ride-window-coaster.png](ui/after-webgl2-pixel8-2b-ride-window-coaster.png) |

**canvas2d / desktop**

| before: 2a-ride-window-merry-go-round | before: 2b-ride-window-coaster | after: 2a-ride-window-merry-go-round | after: 2b-ride-window-coaster |
|---|---|---|---|
| ![before-canvas2d-desktop-2a-ride-window-merry-go-round.png](ui/before-canvas2d-desktop-2a-ride-window-merry-go-round.png) | ![before-canvas2d-desktop-2b-ride-window-coaster.png](ui/before-canvas2d-desktop-2b-ride-window-coaster.png) | ![after-canvas2d-desktop-2a-ride-window-merry-go-round.png](ui/after-canvas2d-desktop-2a-ride-window-merry-go-round.png) | ![after-canvas2d-desktop-2b-ride-window-coaster.png](ui/after-canvas2d-desktop-2b-ride-window-coaster.png) |

**canvas2d / pixel8**

| before: 2a-ride-window-merry-go-round | before: 2b-ride-window-coaster | after: 2a-ride-window-merry-go-round | after: 2b-ride-window-coaster |
|---|---|---|---|
| ![before-canvas2d-pixel8-2a-ride-window-merry-go-round.png](ui/before-canvas2d-pixel8-2a-ride-window-merry-go-round.png) | ![before-canvas2d-pixel8-2b-ride-window-coaster.png](ui/before-canvas2d-pixel8-2b-ride-window-coaster.png) | ![after-canvas2d-pixel8-2a-ride-window-merry-go-round.png](ui/after-canvas2d-pixel8-2a-ride-window-merry-go-round.png) | ![after-canvas2d-pixel8-2b-ride-window-coaster.png](ui/after-canvas2d-pixel8-2b-ride-window-coaster.png) |

## 3. Names: ride list, staff list, guest window, ticker


**webgl2 / desktop**

| before: 3a-ride-list | before: 3b-staff-list | before: 3d-ticker-built-message | after: 3a-ride-list | after: 3b-staff-list | after: 3d-ticker-built-message |
|---|---|---|---|---|---|
| ![before-webgl2-desktop-3a-ride-list.png](ui/before-webgl2-desktop-3a-ride-list.png) | ![before-webgl2-desktop-3b-staff-list.png](ui/before-webgl2-desktop-3b-staff-list.png) | ![before-webgl2-desktop-3d-ticker-built-message.png](ui/before-webgl2-desktop-3d-ticker-built-message.png) | ![after-webgl2-desktop-3a-ride-list.png](ui/after-webgl2-desktop-3a-ride-list.png) | ![after-webgl2-desktop-3b-staff-list.png](ui/after-webgl2-desktop-3b-staff-list.png) | ![after-webgl2-desktop-3d-ticker-built-message.png](ui/after-webgl2-desktop-3d-ticker-built-message.png) |

**webgl2 / pixel8**

| before: 3a-ride-list | before: 3b-staff-list | before: 3d-ticker-built-message | after: 3a-ride-list | after: 3b-staff-list | after: 3d-ticker-built-message |
|---|---|---|---|---|---|
| ![before-webgl2-pixel8-3a-ride-list.png](ui/before-webgl2-pixel8-3a-ride-list.png) | ![before-webgl2-pixel8-3b-staff-list.png](ui/before-webgl2-pixel8-3b-staff-list.png) | ![before-webgl2-pixel8-3d-ticker-built-message.png](ui/before-webgl2-pixel8-3d-ticker-built-message.png) | ![after-webgl2-pixel8-3a-ride-list.png](ui/after-webgl2-pixel8-3a-ride-list.png) | ![after-webgl2-pixel8-3b-staff-list.png](ui/after-webgl2-pixel8-3b-staff-list.png) | ![after-webgl2-pixel8-3d-ticker-built-message.png](ui/after-webgl2-pixel8-3d-ticker-built-message.png) |

**canvas2d / desktop**

| before: 3a-ride-list | before: 3b-staff-list | before: 3d-ticker-built-message | after: 3a-ride-list | after: 3b-staff-list | after: 3d-ticker-built-message |
|---|---|---|---|---|---|
| ![before-canvas2d-desktop-3a-ride-list.png](ui/before-canvas2d-desktop-3a-ride-list.png) | ![before-canvas2d-desktop-3b-staff-list.png](ui/before-canvas2d-desktop-3b-staff-list.png) | ![before-canvas2d-desktop-3d-ticker-built-message.png](ui/before-canvas2d-desktop-3d-ticker-built-message.png) | ![after-canvas2d-desktop-3a-ride-list.png](ui/after-canvas2d-desktop-3a-ride-list.png) | ![after-canvas2d-desktop-3b-staff-list.png](ui/after-canvas2d-desktop-3b-staff-list.png) | ![after-canvas2d-desktop-3d-ticker-built-message.png](ui/after-canvas2d-desktop-3d-ticker-built-message.png) |

**canvas2d / pixel8**

| before: 3a-ride-list | before: 3b-staff-list | before: 3d-ticker-built-message | after: 3a-ride-list | after: 3b-staff-list | after: 3d-ticker-built-message |
|---|---|---|---|---|---|
| ![before-canvas2d-pixel8-3a-ride-list.png](ui/before-canvas2d-pixel8-3a-ride-list.png) | ![before-canvas2d-pixel8-3b-staff-list.png](ui/before-canvas2d-pixel8-3b-staff-list.png) | ![before-canvas2d-pixel8-3d-ticker-built-message.png](ui/before-canvas2d-pixel8-3d-ticker-built-message.png) | ![after-canvas2d-pixel8-3a-ride-list.png](ui/after-canvas2d-pixel8-3a-ride-list.png) | ![after-canvas2d-pixel8-3b-staff-list.png](ui/after-canvas2d-pixel8-3b-staff-list.png) | ![after-canvas2d-pixel8-3d-ticker-built-message.png](ui/after-canvas2d-pixel8-3d-ticker-built-message.png) |

## 4. Queue join (frames over time)


**webgl2 / desktop**

| before: strip0 | before: strip3 | after: strip0 | after: strip3 |
|---|---|---|---|
| ![before-webgl2-desktop-strip0.png](queue/before-webgl2-desktop-strip0.png) | ![before-webgl2-desktop-strip3.png](queue/before-webgl2-desktop-strip3.png) | ![after-webgl2-desktop-strip0.png](queue/after-webgl2-desktop-strip0.png) | ![after-webgl2-desktop-strip3.png](queue/after-webgl2-desktop-strip3.png) |

**webgl2 / pixel8**

| before: strip0 | before: strip3 | after: strip0 | after: strip3 |
|---|---|---|---|
| ![before-webgl2-pixel8-strip0.png](queue/before-webgl2-pixel8-strip0.png) | ![before-webgl2-pixel8-strip3.png](queue/before-webgl2-pixel8-strip3.png) | ![after-webgl2-pixel8-strip0.png](queue/after-webgl2-pixel8-strip0.png) | ![after-webgl2-pixel8-strip3.png](queue/after-webgl2-pixel8-strip3.png) |

**canvas2d / desktop**

| before: strip0 | before: strip3 | after: strip0 | after: strip3 |
|---|---|---|---|
| ![before-canvas2d-desktop-strip0.png](queue/before-canvas2d-desktop-strip0.png) | ![before-canvas2d-desktop-strip3.png](queue/before-canvas2d-desktop-strip3.png) | ![after-canvas2d-desktop-strip0.png](queue/after-canvas2d-desktop-strip0.png) | ![after-canvas2d-desktop-strip3.png](queue/after-canvas2d-desktop-strip3.png) |

**canvas2d / pixel8**

| before: strip0 | before: strip3 | after: strip0 | after: strip3 |
|---|---|---|---|
| ![before-canvas2d-pixel8-strip0.png](queue/before-canvas2d-pixel8-strip0.png) | ![before-canvas2d-pixel8-strip3.png](queue/before-canvas2d-pixel8-strip3.png) | ![after-canvas2d-pixel8-strip0.png](queue/after-canvas2d-pixel8-strip0.png) | ![after-canvas2d-pixel8-strip3.png](queue/after-canvas2d-pixel8-strip3.png) |
