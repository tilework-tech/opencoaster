# Noridoc: User Interface

Path: @/src/ui

### Overview

- Builds the RCT2-style park interface from DOM elements: a top toolbar, floating bevelled windows with per-kind title-bar colours, a lower-left status box (cash, guests, rating bar), a lower-right date/weather box and a news ticker. Layout and behaviour follow [docs/fidelity/ui.md](../../docs/fidelity/ui.md) where implemented; deferred items are listed under Things to Know.
- Displays worker snapshots and timing statistics; authoritative game state remains in the simulation worker.
- Below 700 px width windows become stacked bottom sheets (only the front sheet is expanded; tapping a title collapses/expands) and the toolbar becomes one horizontally scrolling row. Controls have 44 px minimum touch targets (checked by `e2e/mobile.spec.ts`).
- Hosts the game shell: a title screen, an in-game menu (reached from Game options), and a one-time scenario outcome dialog.

### How it fits into the larger codebase

- [src/main.ts](../main.ts) creates a [WindowManager](window-manager.ts), the [CoasterPanel](coaster-panel.ts) and the [GameUI](game-ui.ts), and connects `GameUIActions` to [SimClient](../worker/sim-client.ts), the camera, screen-to-tile picking and the renderer. Placement input becomes simulation commands at the main-thread boundary.
- Windows read `Snapshot` fields only. `Snapshot.economy` (price mode, admission, monthly ledger totals, loan limit) and `Snapshot.research` exist for the Park, Finances and Research windows; `RideInfo.RideX/RideY` locate a ride for clicks on news items and the map.
- [Hud](hud.ts) shows worker timing and render statistics; it is hidden until View options > Performance overlay is turned on.
- [title-screen.ts](title-screen.ts), [save-menu.ts](save-menu.ts) and [scenario-dialog.ts](scenario-dialog.ts) are DOM overlays. They call into the save layer ([game-saves.ts](../save/game-saves.ts), [slot-store.ts](../save/slot-store.ts)) and the worker ([SimClient](../worker/sim-client.ts)) through callbacks wired in `main.ts`.

### Core Implementation

- [game-ui.ts](game-ui.ts) owns the toolbar ([toolbar.ts](toolbar.ts)), [status-bar.ts](status-bar.ts), news ([news.ts](news.ts) derives messages from successive snapshots: builds, breakdowns, repairs, guest milestones, objective and weather changes) and a map of window controllers. Opening a construction window (Land, Water, Scenery, Footpaths, New ride, Clear scenery) closes the other construction windows; closing one returns to the Select tool. A new game opens the Park window.
- [src/main.ts](../main.ts) connects [src/input](../input/docs.md) pointer gestures to camera movement and placement: one-finger drag pans, pinch zooms on the discrete zoom ladder, twist and Q/E rotate, and taps select or issue the active build command. A hold selects the object under the finger even while a build tool is active; path and land tools paint while dragging. The canvas uses CSS-pixel coordinates, capped device-pixel ratio, and viewport/orientation resize events; the simulation pauses while the tab is hidden.
- [window-manager.ts](window-manager.ts) and [window-layout.ts](window-layout.ts): draggable windows (title bar), pin, close, tab strip, z-order, cascade. Positions are CSS variables, so the mobile bottom-sheet layout needs no JS positioning.
- [windows/](windows) has one file per window: ride selection (category tabs: Transport, Gentle, Roller Coasters, Thrill, Water, Shops & Stalls, Research; stalls and facilities are built from here), ride list (Rides / Shops and stalls / Guest facilities), the ten-tab ride window (View, Description, Mechanics, Maintenance record, Colour and style, Music, Ride statistics, Data log, Financial data, Guest data; ticket price is under Financial data), guest window, Park (View, Park rating, Guests, Admission, Park statistics, Objectives, Awards; pay-to-enter mode and admission price), Finances (accounts with loan controls, cash/value/profit graphs, marketing, research funding), Research, Map (Guests / Objects; tap to recentre), Staff (tab per role), recent messages, and the build-tool windows.
- [guest-window.ts](windows/guest-window.ts) maps thought ids from the selected guest snapshot to display labels, including the lost-guest thought; its Rides tab remains a placeholder because individual ride history is not tracked.
- [coaster-panel.ts](coaster-panel.ts) is the Ride construction window: shape, slope and bank icon buttons, a Special elements dropdown, drive select, start direction, Build piece / Demolish last piece, Track / Entrance / Exit modes, Test / Open / Close, and the ride readout. It opens while the track tool is active.
- [shortcuts.ts](shortcuts.ts) maps the default keys (Backspace, Shift+Backspace, Esc, Pause/Space, Page Up/Down, Enter, F1-F5, F/D/R/P/G/S/M, Tab); [zoom.ts](zoom.ts) holds the four-level discrete zoom ladder used by the toolbar, Page Up/Down, wheel steps and pinch gestures.
- [track-tool.ts](track-tool.ts) is pure logic (`resolvePiece`, `allowedModes`, `previewStatus`, `footprintTiles`, `feedbackMessage`); [track-preview.ts](track-preview.ts) draws the placement ghost.
- [icons.ts](icons.ts) holds placeholder line icons by name so art can replace them later; [ui.css](ui.css) holds the interface styles.

### Things to Know

- Deferred from docs/fidelity/ui.md: Clear scenery, Water and view overlays (underground, see-through, height marks; keys 1, 3-6, 8-0, H, V) have placeholder windows because the sim and renderer have no support; individual guest/worker windows opened from lists with locate/follow; Rides tab data in the guest window; worker orders and colours; footpath queue-line and slope modes; right-click removal; resizable windows; Ctrl+S screenshot; Options categories and shortcut reassignment; audio; ticker timing/colours beyond the three categories (unresolved in the spec). Enter rotates the view, so building a track piece uses the Build piece button; Delete demolishes the last piece.

- Tool status text reports that a placement was requested. The authoritative outcome arrives in `Snapshot.feedback`, which the panel shows via `feedbackMessage` when `seq` changes. Map-command rejections remain silent.
- The placement preview is a client-side approximation using the snapshot (bounds, ownership via `buildable`, funds); the simulation result is authoritative and may differ.
- Ownership, ride-type rules and funds are enforced by the simulation's track command handler, not by the UI.
- Staff roster identity is matched with stable staff IDs from snapshots; player names travel by ID, while role and position come from the current staff layer. Ground and flower-bed state is carried in per-tile snapshot data, but is not currently drawn by the UI.
- Ride controls request price, open/close, and entrance/exit placement commands. Coaster queue connection and testing remain in the coaster panel; simulation validation is authoritative.
- Game speed and pause controls affect the worker scheduler through [SimClient](../worker/sim-client.ts); rendering and panel refresh continue on the browser animation frame loop.
- Speed and the player's pause choice are saved in `localStorage` ([settings.ts](settings.ts)) and restored on the next visit. The worker is also paused while the title screen, the in-game menu or an outcome dialog is open; that pause is not saved.
- Session lifecycle lives in `main.ts`. A new game, sandbox start, save load or import replaces the worker's game and clears the session's outcome state. Quitting to title clears the session. Loading a save reads only its header first (`summarizeSave`), so a bad file leaves the current game running.
- Scenario outcome: when a snapshot's scenario status leaves Active, the outcome dialog shows once per game. It offers keep playing (sandbox), the menu, or back to title. The objective strip ([objective.ts](objective.ts)) shows progress and the deadline. Until the first rating refresh (tick 512) the rating reads as pending.
- The park panel shows guest and ride counts, simulation tick and park rating. The finance panel shows cash and loan. Guest details remain a point-in-time selection until another selection replaces or clears them.
- Title and menu actions are asynchronous and their failures are shown in the overlay (for example a save that cannot be read, or storage that is unavailable; the title falls back to an in-memory store when IndexedDB cannot be opened, and says so).
- Guest spawning from the toolbar is a development control that sends the existing `spawnGuests` command.

Created and maintained by Nori.
