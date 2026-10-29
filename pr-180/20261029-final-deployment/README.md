# OpenCoaster final merge and deployment smoke

Date: 2026-10-29 UTC

## Merge and CI

- PR #179 merged to `main` as `7ec893a8c7e1c8c10ecf3818dc6861d2ae22d5df`: https://github.com/tilework-tech/opencoaster/pull/179
- PR #180 merged to `main` as `bd72461462d8bf9e24119fd80c938dac96631105`: https://github.com/tilework-tech/opencoaster/pull/180
- Final-head PR CI passed: https://github.com/tilework-tech/opencoaster/actions/runs/40819153099
- Final-main CI passed: https://github.com/tilework-tech/opencoaster/actions/runs/40820329895
- GitHub Pages deployment passed: https://github.com/tilework-tech/opencoaster/actions/runs/40820329904
- PR #178 was closed as superseded.

Final main uses save format 34. The migration order is v32→v33 spawn-point data→v34 ambient-tree scenery.

## Browser smoke

The final deployment returned HTTP 200 at `http://opencoaster.noriagentic.com/`, with title `OpenCoaster` and no browser console or page errors. The sandbox started with 0 guests at tick 100; an arriving guest later appeared on the approach from the map edge. Tree belts appeared in clusters and the gate path was clear.

On an unsaved disposable sandbox, the Clear scenery preview reported `Clear 1 item: $0.25`; after clearing, it reported `Nothing to clear here.` A coaster track placement over scenery was refused with `Blocked by Scenery at (48, 96).` The park was not saved.

HTTPS remains broken: Chrome reported `ERR_CERT_COMMON_NAME_INVALID`, and curl reported that the certificate has no subject alternative name for `opencoaster.noriagentic.com`. DNS and Pages settings were not changed during this run.
