# ui

Responsibility: HUD, toolbars, windows, input handling (DOM). Currently a debug HUD only.

Interface: `Hud.update(stats, fps, rotation)`. UI talks to the sim only through `SimClient` commands.
