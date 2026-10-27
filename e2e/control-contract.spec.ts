import { devices, expect, test } from './support/test';
import type { Locator, Page } from './support/test';
import { createTestContext } from './support/test-contexts';
import { readFileSync } from 'node:fs';
import { pickTile, project } from '../src/render/projection';
import { ElementType } from '../src/sim/map/tile-map';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { World } from '../src/sim/core/world';
import { deserialize } from '../src/save/save';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';

const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

const toolbarActions = [
  'Game options',
  'Zoom out',
  'Zoom in',
  'Rotate right',
  'Rotate left',
  'View options',
  'Map',
  'Clear scenery',
  'Land',
  'Water',
  'Scenery',
  'Footpaths',
  'New ride',
  'Finances',
  'Research',
  'Rides',
  'Park',
  'Staff',
  'Guests',
  'Messages',
  'Save / Load',
];

const panelForAction: Record<string, string> = {
  'Game options': 'options',
  'View options': 'view',
  Map: 'map',
  'Clear scenery': 'clear',
  Land: 'land',
  Water: 'water',
  Scenery: 'scenery',
  Footpaths: 'paths',
  'New ride': 'ride-select',
  Finances: 'finance',
  Research: 'research',
  Rides: 'ride-list',
  Park: 'park',
  Staff: 'staff',
  Guests: 'guests',
  Messages: 'news',
};

const visitedDetailTypes = new Set<string>();

async function observableState(page: Page): Promise<string> {
  const ui = await page.locator('body').evaluate(() => ({
    windows: Array.from(document.querySelectorAll('.ui-window'))
      .filter((window) => {
        const style = getComputedStyle(window);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((window) => [
        window.getAttribute('data-panel'),
        window.className,
        window.querySelector('.ui-titlebar')?.textContent,
        window.innerText.slice(0, 500),
      ]),
    controls: Array.from(document.querySelectorAll('button,input,select,[role="tab"]'))
      .filter((control) => {
        if (control instanceof HTMLElement && control.classList.contains('guest-entry'))
          return false;
        const style = getComputedStyle(control);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((control) => [
        control.getAttribute('aria-label'),
        control.getAttribute('aria-pressed'),
        control.getAttribute('aria-selected'),
        control.getAttribute('aria-expanded'),
        control.getAttribute('title'),
        control instanceof HTMLButtonElement ? control.disabled : '',
        control instanceof HTMLInputElement ? control.type : '',
        control instanceof HTMLInputElement ? control.checked : '',
        control instanceof HTMLInputElement || control instanceof HTMLSelectElement
          ? control.value
          : '',
        control.textContent,
      ]),
    status: document.querySelector('.tool-status')?.textContent,
    saveMessage: document.querySelector('.save-message')?.textContent,
    camera:
      '__camera' in window
        ? {
            x: (window as unknown as { __camera: { x: number } }).__camera.x,
            y: (window as unknown as { __camera: { y: number } }).__camera.y,
            zoom: (window as unknown as { __camera: { zoom: number } }).__camera.zoom,
            rotation: (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
          }
        : null,
  }));
  return JSON.stringify(ui);
}

async function clickAndObserve(page: Page, control: Locator, mobile = false): Promise<void> {
  const before = await observableState(page);
  if (mobile) await control.tap({ timeout: 5_000 });
  else await control.click({ timeout: 5_000 });
  await expect.poll(() => observableState(page), { timeout: 1_000 }).not.toBe(before);
}

async function setSimulationPaused(page: Page, mobile: boolean, paused: boolean): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
  if (mobile && (await actions.getAttribute('aria-expanded')) !== 'true')
    await actions.tap({ timeout: 5_000 });
  const control = toolbar.getByRole('button', { name: paused ? 'Pause' : 'Resume', exact: true });
  if (mobile) await control.tap({ timeout: 5_000 });
  else await control.click();
}

async function exercisePane(page: Page, pane: Locator, mobile: boolean): Promise<void> {
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 100; attempt++) {
    const selector = 'button,input,select,textarea,[role="listitem"],.guest-entry,.ride-card';
    const items = await pane.locator(selector).evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const control = node as
          HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const label =
          control.getAttribute('aria-label') ??
          control.getAttribute('title') ??
          control.closest('label')?.textContent?.trim() ??
          control.textContent?.trim() ??
          '';
        const action =
          control.dataset.action ??
          control.dataset.campaign ??
          control.dataset.funding ??
          (control.classList.contains('guest-entry') ? 'guest-entry' : '');
        const selectorAttribute = control.dataset.action
          ? 'data-action'
          : control.dataset.campaign
            ? 'data-campaign'
            : control.dataset.funding
              ? 'data-funding'
              : '';
        const selectorValue = selectorAttribute
          ? (control.getAttribute(selectorAttribute) ?? '')
          : '';
        return {
          index,
          key: `${control.tagName}:${action}:${action === 'guest-entry' ? '' : label}`,
          selectorAttribute,
          selectorValue,
          tagName: control.tagName,
          disabled: control.disabled,
          type: control instanceof HTMLInputElement ? control.type : '',
          checked: control instanceof HTMLInputElement ? control.checked : false,
          value:
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement
              ? control.value
              : '',
          ariaPressed: control.getAttribute('aria-pressed'),
          funding: control.dataset.funding,
          label,
        };
      }),
    );
    const item = items.find((candidate) => !seen.has(candidate.key));
    if (!item) return;
    seen.add(item.key);
    if (item.label === 'Track guest') {
      const track = pane.getByRole('button', { name: 'Track guest', exact: true });
      await expect(track).toBeDisabled();
      await expect(track).toHaveAttribute('title', /not available/i);
      continue;
    }
    if (item.label === 'Back to title') continue;
    if (item.disabled) {
      await expect(pane.locator(selector).nth(item.index)).toHaveAttribute('title', /.+/);
      continue;
    }
    if (item.type === 'file' || item.label === 'Close' || item.label.startsWith('Close ')) continue;
    console.log(`control ${mobile ? 'Pixel 8' : 'desktop'}: ${item.label || item.key}`);

    const control = item.selectorAttribute
      ? pane.locator(`[${item.selectorAttribute}="${item.selectorValue}"]`).first()
      : pane.locator(selector).nth(item.index);
    if (!(await control.isVisible())) continue;
    if (await control.isDisabled()) {
      await expect(control).toHaveAttribute('title', /.+/);
      continue;
    }
    const ownerPanel = await pane.evaluate(
      (node) => node.closest<HTMLElement>('.ui-window')?.dataset.panel ?? '',
    );
    if (item.type === 'checkbox') {
      const requiresSimulationTick = /^worker-\d+$/.test(ownerPanel) || ownerPanel === 'research';
      if (requiresSimulationTick) await setSimulationPaused(page, mobile, false);
      await control.setChecked(!item.checked);
      await expect(control).toHaveJSProperty('checked', !item.checked);
      if (requiresSimulationTick) await setSimulationPaused(page, mobile, true);
    } else if (item.type === 'range') {
      const old = Number(item.value);
      const max = Number((await control.getAttribute('max')) ?? 100);
      await control.focus();
      await control.press(old >= max ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(async () => Number(await control.inputValue())).not.toBe(old);
    } else if ((await control.evaluate((node) => node.tagName)) === 'SELECT') {
      const values = await control
        .locator('option')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
      const next = values.find((value) => value !== item.value);
      if (!next) continue;
      await control.selectOption(next);
      await expect(control).toHaveValue(next);
    } else if (['text', 'search', 'number'].includes(item.type) || item.tagName === 'TEXTAREA') {
      const next = `Audit ${item.label}`;
      await control.fill(next);
      await expect(control).toHaveValue(next);
    } else if (item.label === 'Save, load and quit…') {
      const menu = page.locator('[aria-label="Game menu"]');
      if (await menu.isVisible())
        await menu.getByRole('button', { name: 'Close', exact: true }).click();
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect(menu).toBeVisible();
      await menu.getByRole('button', { name: 'Close', exact: true }).click();
    } else if (item.label === 'Guests +1,000') {
      await setSimulationPaused(page, mobile, false);
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect
        .poll(async () => {
          const hud = await page.locator('.hud').innerText();
          return Number(hud.match(/guests (\d+)/)?.[1] ?? 0);
        })
        .toBeGreaterThan(1_000);
      await setSimulationPaused(page, mobile, true);
    } else if (item.label.includes('/wk for') || item.funding !== undefined) {
      await setSimulationPaused(page, mobile, false);
      const tick = async () =>
        Number((await page.locator('.hud').innerText()).match(/tick (\d+)/)?.[1] ?? -1);
      const beforeTick = await tick();
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      if (item.funding !== undefined) {
        await expect(control).toHaveAttribute('aria-pressed', 'true');
      } else {
        await expect.poll(tick).toBeGreaterThan(beforeTick);
        await setSimulationPaused(page, mobile, true);
        const campaignName = item.label.split(':')[0];
        await expect(pane).toContainText(`Running: ${campaignName}`);
        continue;
      }
      await setSimulationPaused(page, mobile, true);
    } else if (item.label.startsWith('Hire ')) {
      await setSimulationPaused(page, mobile, false);
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect(page.locator('.ui-window[data-panel="staff"]')).toContainText(
        /Staff employed\s+1/,
      );
      await setSimulationPaused(page, mobile, true);
    } else if (item.label === 'Export save file') {
      const downloadPromise = page.waitForEvent('download');
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      expect((await downloadPromise).suggestedFilename()).toMatch(/\.ocsave$/);
      await expect(page.locator('[aria-label="Game menu"]')).toContainText('Save file downloaded.');
    } else if (item.label === 'Import save file') {
      const chooserPromise = page.waitForEvent('filechooser');
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: 'invalid-save.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{}'),
      });
      await expect(page.locator('[aria-label="Game menu"]')).toContainText(/Failed:/);
    } else if (item.label === 'Load') {
      await clickAndObserve(page, control, mobile);
      const menu = page.locator('[aria-label="Game menu"]');
      if (!(await menu.isVisible())) {
        await toolbarClick(page, 'Game options', mobile);
        await page.getByRole('button', { name: 'Save, load and quit…' }).click();
        await expect(menu).toBeVisible();
      }
    } else if (item.label === 'Rename') {
      await setSimulationPaused(page, mobile, false);
      const dialogPromise = page.waitForEvent('dialog');
      const clickPromise = mobile
        ? control.tap({ timeout: 5_000 })
        : control.click({ timeout: 5_000 });
      const dialog = await dialogPromise;
      await dialog.accept('Audit Staff');
      await clickPromise;
      await expect(page.locator('.ui-window[data-panel="staff"]')).toContainText('Audit Staff');
      await setSimulationPaused(page, mobile, true);
    } else if (item.label === 'Sack') {
      await setSimulationPaused(page, mobile, false);
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect(page.locator('.ui-window[data-panel^="worker-"]')).toBeHidden();
      await setSimulationPaused(page, mobile, true);
    } else if (/^Patrol (Handyman|Mechanic|Security|Entertainer)$/.test(item.label)) {
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect(page.locator('.tool-status')).toContainText(
        `Patrol tool selected for ${item.label.replace('Patrol ', '')}`,
      );
    } else if (
      (item.label === 'Patrol' || item.label.toLowerCase().includes('patrol area')) &&
      (await page.locator('.tool-status').innerText()).includes('Patrol tool selected')
    ) {
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect(page.locator('.tool-status')).toContainText('Patrol tool selected');
    } else if (item.label === 'Queue line') {
      await setSimulationPaused(page, mobile, false);
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await expect(page.locator('.tool-status')).toContainText(/Queue line (on|off)\b/);
      await setSimulationPaused(page, mobile, true);
    } else if (item.ariaPressed !== null) {
      await setSimulationPaused(page, mobile, false);
      const group = control.locator('xpath=..');
      const before = await group.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-pressed')),
      );
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      if (item.ariaPressed === 'false') {
        await expect(control).toHaveAttribute('aria-pressed', 'true');
      } else {
        const state = () =>
          group.evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute('aria-pressed')),
          );
        if (JSON.stringify(await state()) === JSON.stringify(before)) {
          const alternative = group.locator('button[aria-pressed="false"]').first();
          await expect(alternative).toBeVisible();
          const alternativeLabel = (await alternative.innerText()).trim();
          if (mobile) await alternative.tap({ timeout: 5_000 });
          else await alternative.click({ timeout: 5_000 });
          await expect(
            group.getByRole('button', { name: alternativeLabel, exact: true }),
          ).toHaveAttribute('aria-pressed', 'true');
          await expect(control).toHaveAttribute('aria-pressed', 'false');
        } else {
          await expect.poll(state).not.toEqual(before);
        }
      }
      await setSimulationPaused(page, mobile, true);
    } else if (item.label === 'Rotate scenery piece') {
      await pane.getByLabel('Scenery category').selectOption({ label: 'Fences and walls' });
      await pane.getByLabel('Scenery item').selectOption('6');
      const target = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
        const rect = canvas.getBoundingClientRect();
        for (let y = rect.top + 8; y < rect.bottom; y += 12) {
          for (let x = rect.left + 8; x < rect.right; x += 12) {
            if (document.elementFromPoint(x, y) === canvas) return { x, y };
          }
        }
        return null;
      });
      expect(target, 'a visible map point is available for the scenery preview').not.toBeNull();
      await page.mouse.move(target!.x, target!.y);
      const canvas = page.locator('#game');
      const before = await canvas.screenshot();
      if (mobile) await control.tap({ timeout: 5_000 });
      else await control.click({ timeout: 5_000 });
      await page.mouse.move(target!.x, target!.y);
      await expect.poll(async () => !(await canvas.screenshot()).equals(before)).toBe(true);
    } else if (item.label === 'Land rights') {
      await clickAndObserve(page, control, mobile);
      const rights = page.locator('.ui-window[data-panel="land-rights"]');
      await expect(rights).toBeVisible();
      await rights.getByRole('button', { name: /^Close / }).click({ timeout: 5_000 });
      await expect(rights).toBeHidden();
    } else if (item.label === 'Remove' && ownerPanel === 'paths') {
      const slope = pane.getByRole('button', { name: 'Down', exact: true });
      if (mobile) await slope.tap({ timeout: 5_000 });
      else await slope.click({ timeout: 5_000 });
      await expect(page.locator('.tool-status')).toHaveText('Slope: Down.');
      await clickAndObserve(page, control, mobile);
      await expect(page.locator('.tool-status')).toHaveText(
        'Click a tile to set the cursor first.',
      );
    } else {
      const existingDetailWindows = await page
        .locator('.ui-window:visible')
        .evaluateAll((windows) =>
          windows
            .map((window) => window.getAttribute('data-panel') ?? '')
            .filter((id) => /^(guest|worker|ride)-\d+$/.test(id)),
        );
      const firingWorker = item.label === 'Fire';
      if (firingWorker) await setSimulationPaused(page, mobile, false);
      try {
        await clickAndObserve(page, control, mobile);
      } catch (error) {
        const clickWasBlocked =
          error instanceof Error && /element is not enabled/.test(error.message);
        const unavailableReason = await control
          .evaluate((node) =>
            node instanceof HTMLButtonElement ||
            node instanceof HTMLInputElement ||
            node instanceof HTMLSelectElement
              ? node.disabled && node.title
              : '',
          )
          .catch(() => '');
        if (clickWasBlocked && unavailableReason) continue;
        if ((await control.count()) === 0) continue;
        throw new Error(`Control did not produce an observable effect: ${item.key}`, {
          cause: error,
        });
      } finally {
        if (firingWorker) await setSimulationPaused(page, mobile, true);
      }
      const detailWindows = await page
        .locator('.ui-window:visible')
        .evaluateAll(
          (windows, existing) =>
            windows
              .map((window) => window.getAttribute('data-panel') ?? '')
              .filter((id) => /^(guest|worker|ride)-\d+$/.test(id) && !existing.includes(id)),
          existingDetailWindows,
        );
      for (const id of detailWindows) {
        const detail = page.locator(`.ui-window[data-panel="${id}"]:visible`);
        const type = id.split('-')[0]!;
        if (visitedDetailTypes.has(type)) {
          await detail.getByRole('button', { name: /^Close / }).click({ timeout: 5_000 });
          await expect(detail).toBeHidden();
        } else {
          visitedDetailTypes.add(type);
          await exerciseWindow(page, detail, mobile);
        }
      }
    }
  }
  throw new Error('Control sweep exceeded 100 unique controls without completing the active pane.');
}

async function exerciseWindow(page: Page, panel: Locator, mobile: boolean): Promise<void> {
  if (await panel.evaluate((window) => window.classList.contains('collapsed')))
    await panel.locator('.ui-titlebar').click();
  let pinnedForSweep = false;
  if (!mobile) {
    const pin = panel.getByRole('button', { name: /^Pin / });
    if (await pin.count()) {
      await pin.click();
      await expect(panel).toHaveClass(/pinned/);
      pinnedForSweep = true;
    } else {
      await panel.locator('.ui-titlebar').click({ position: { x: 8, y: 8 } });
    }
  }

  const tabs = panel.getByRole('tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    if (!(await panel.isVisible())) return;
    const tab = tabs.nth(index);
    if ((await tab.getAttribute('aria-selected')) !== 'true') {
      if (mobile) await tab.tap({ timeout: 5_000 });
      else await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
    await exercisePane(page, panel.locator('.ui-pane.active'), mobile);
  }

  if (!(await panel.isVisible())) return;
  if (mobile) return;
  const pin = panel.getByRole('button', { name: /^Pin / });
  if (pinnedForSweep && (await pin.count())) {
    await pin.click();
    await expect(panel).not.toHaveClass(/pinned/);
  }
  const close = panel.getByRole('button', { name: /^Close / });
  if (await close.count()) {
    if (mobile) await close.tap({ timeout: 5_000 });
    else await close.click({ timeout: 5_000 });
    await expect(panel).toBeHidden();
  }
}

async function startSandbox(page: Page, mobile = false): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText('WebGL2');
  await expect(page.locator('.hud')).toContainText(/guests 1000/);
  const toolbar = page.locator('.game-toolbar');
  if (mobile)
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap({ timeout: 5_000 });
  await toolbar.getByRole('button', { name: 'Pause' }).click();
  if (mobile) {
    const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
    await actions.tap({ timeout: 5_000 });
    await expect(toolbar.getByRole('button', { name: 'Resume' })).toBeVisible();
    await toolbar.getByRole('button', { name: 'Resume' }).tap({ timeout: 5_000 });
    await actions.tap({ timeout: 5_000 });
    await toolbar.getByRole('button', { name: 'Pause' }).tap({ timeout: 5_000 });
    await actions.tap({ timeout: 5_000 });
  } else {
    await expect(toolbar.getByRole('button', { name: 'Resume' })).toBeVisible();
  }
  const park = page.locator('.ui-window[data-panel="park"]:visible');
  if (await park.count()) await park.getByRole('button', { name: 'Close Park' }).click();
}

async function auditToolbar(page: Page, mobile = false): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
  if (mobile && (await actions.getAttribute('aria-expanded')) !== 'true')
    await actions.tap({ timeout: 5_000 });
  const tick = async () =>
    Number((await page.locator('.hud').innerText()).match(/tick (\d+)/)?.[1] ?? -1);
  await expect(toolbar.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  const beforeResume = await tick();
  await setSimulationPaused(page, mobile, false);
  await expect.poll(tick).toBeGreaterThan(beforeResume);
  if (mobile && (await actions.getAttribute('aria-expanded')) !== 'true')
    await actions.tap({ timeout: 5_000 });
  await expect(toolbar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await setSimulationPaused(page, mobile, true);
  await page.waitForTimeout(1_000);
  const pausedAt = await tick();
  await page.waitForTimeout(300);
  expect(await tick()).toBe(pausedAt);
  if (mobile && (await actions.getAttribute('aria-expanded')) !== 'true')
    await actions.tap({ timeout: 5_000 });
  await expect(toolbar.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();

  for (const label of toolbarActions) {
    console.log(`toolbar ${mobile ? 'Pixel 8' : 'desktop'}: ${label}`);
    if (mobile) {
      const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
      if ((await actions.getAttribute('aria-expanded')) !== 'true')
        await actions.tap({ timeout: 5_000 });
    }
    const action = toolbar.getByRole('button', { name: label, exact: true });
    if (await action.isDisabled()) {
      await expect(action).toHaveAttribute('title', /not available/i);
      continue;
    }
    if (label === 'Rotate right' || label === 'Rotate left') {
      const hud = page.locator('.hud');
      const before = (await hud.innerText()).match(/rot (\d+)/)?.[1];
      if (mobile) await action.tap({ timeout: 5_000 });
      else await action.click();
      await expect
        .poll(async () => (await hud.innerText()).match(/rot (\d+)/)?.[1])
        .not.toBe(before);
    } else if (label === 'Zoom in' || label === 'Zoom out') {
      const before = await page.evaluate(
        () => (window as unknown as { __camera: { zoom: number } }).__camera.zoom,
      );
      if (mobile) await action.tap({ timeout: 5_000 });
      else await action.click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { __camera: { zoom: number } }).__camera.zoom),
        )
        .not.toBe(before);
    } else {
      const before = await observableState(page);
      if (mobile) await action.tap({ timeout: 5_000 });
      else await action.click();
      await expect.poll(() => observableState(page), { timeout: 3_000 }).not.toBe(before);
    }

    const expectedPanel = panelForAction[label];
    if (expectedPanel) {
      const panel = page.locator(`.ui-window[data-panel="${expectedPanel}"]:visible`);
      await expect(panel).toBeVisible();
      if (mobile && (await actions.getAttribute('aria-expanded')) === 'true')
        await actions.tap({ timeout: 5_000 });
      await exerciseWindow(page, panel, mobile);
    } else if (label === 'Save / Load') {
      const menu = page.locator('[aria-label="Game menu"]');
      await expect(menu).toBeVisible();
      await exercisePane(page, menu, mobile);
      await menu.getByRole('button', { name: 'Back to title' }).click();
      await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
    }
  }
}

async function toolbarClick(page: Page, name: string, mobile: boolean): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
  if (mobile && (await actions.getAttribute('aria-expanded')) !== 'true')
    await actions.tap({ timeout: 5_000 });
  const action = toolbar.getByRole('button', { name, exact: true });
  if (mobile) await action.tap({ timeout: 5_000 });
  else await action.click();
}

async function checkDisabledControls(page: Page, mobile = false): Promise<void> {
  await toolbarClick(page, 'Game options', mobile);
  const options = page.locator('[data-panel="options"]');
  if (mobile) await options.getByRole('tab', { name: 'Display' }).tap({ timeout: 5_000 });
  else await options.getByRole('tab', { name: 'Display' }).click();
  await options.getByLabel('Gridlines').check();
  if (mobile) await options.getByRole('button', { name: 'Close Options' }).tap({ timeout: 5_000 });
  else await options.getByRole('button', { name: 'Close Options' }).click();
  await toolbarClick(page, 'Finances', mobile);
  const finance = page.locator('[data-panel="finance"]');
  for (const [name, reason] of [
    ['Borrow $1,000', /maximum borrowing limit/i],
    ['Repay $1,000', /repayment requires/i],
  ] as const) {
    const control = finance.getByRole('button', { name });
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute('title', reason);
  }
  if (mobile) await finance.getByRole('button', { name: 'Close Finances' }).tap({ timeout: 5_000 });
  else await finance.getByRole('button', { name: 'Close Finances' }).click();
}

test('enabled desktop toolbar and window controls cause an observable effect', async ({ page }) => {
  test.setTimeout(600_000);
  visitedDetailTypes.clear();
  await startSandbox(page);
  await checkDisabledControls(page);
  await auditToolbar(page);
});

test('enabled Pixel 8 toolbar and window controls cause an observable effect', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  visitedDetailTypes.clear();
  const { defaultBrowserType: _browserType, ...device } = devices['Pixel 8'];
  void _browserType;
  const context = await createTestContext(browser, device);
  const page = await context.newPage();
  try {
    await startSandbox(page, true);
    await checkDisabledControls(page, true);
    await auditToolbar(page, true);
  } finally {
    await context.close();
  }
});

test('keyboard shortcuts and desktop path context-clicks respond visibly', async ({ page }) => {
  await startSandbox(page);
  const toolbar = page.locator('.game-toolbar');
  const canvas = page.locator('#game');
  const hud = page.locator('.hud');

  await toolbar.getByRole('button', { name: 'Land' }).click();
  await expect(page.locator('.tool-status')).toContainText('Land tool selected');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('.tool-status')).toContainText('Select a guest or tile');

  const rotation = (await hud.innerText()).match(/rot (\d+)/)?.[1];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await hud.innerText()).match(/rot (\d+)/)?.[1]).not.toBe(rotation);

  await page.keyboard.press('F1');
  await expect(page.locator('[data-panel="land"]')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(page.locator('[data-panel="land"]')).toBeHidden();

  await toolbar.getByRole('button', { name: 'Footpaths' }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.locator('.tool-status')).toContainText(/Path removal requested at \d+, \d+/);

  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^opencoaster-screenshot-.*\.png$/);
});

test('every window and camera shortcut produces its documented effect', async ({ page }) => {
  await startSandbox(page);
  const shortcuts = [
    ['F1', 'land'],
    ['F2', 'water'],
    ['F3', 'scenery'],
    ['F4', 'paths'],
    ['F5', 'ride-select'],
    ['f', 'finance'],
    ['d', 'research'],
    ['r', 'ride-list'],
    ['p', 'park'],
    ['g', 'guests'],
    ['s', 'staff'],
    ['m', 'news'],
    ['Tab', 'map'],
  ] as const;
  for (const [key, panel] of shortcuts) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(key);
    await expect(page.locator(`.ui-window[data-panel="${panel}"]`)).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(page.locator(`.ui-window[data-panel="${panel}"]`)).toBeHidden();
  }

  await page.keyboard.press('F1');
  await page.keyboard.press('F2');
  await page.keyboard.press('Shift+Backspace');
  await expect(page.locator('.ui-window:visible')).toHaveCount(0);

  const camera = () =>
    page.evaluate(() => (window as unknown as { __camera: { zoom: number } }).__camera.zoom);
  const zoomBefore = await camera();
  await page.keyboard.press('PageDown');
  await expect.poll(camera).not.toBe(zoomBefore);
  const zoomedIn = await camera();
  await page.keyboard.press('PageUp');
  await expect.poll(camera).not.toBe(zoomedIn);

  const toolbar = page.locator('.game-toolbar');
  await expect(toolbar.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toolbar.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press('Pause');
  await expect(toolbar.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('Pixel 8 can close a pinned staff window', async ({ browser }) => {
  const { defaultBrowserType: _browserType, ...device } = devices['Pixel 8'];
  void _browserType;
  const context = await createTestContext(browser, device);
  const page = await context.newPage();
  try {
    await startSandbox(page, true);
    await toolbarClick(page, 'Staff', true);
    const staff = page.locator('.ui-window[data-panel="staff"]');
    const pin = staff.getByRole('button', { name: 'Pin Staff' });
    await pin.tap();
    await expect(staff).toHaveClass(/pinned/);
    await staff.getByRole('button', { name: 'Close Staff' }).tap();
    await expect(staff).toBeHidden();
  } finally {
    await context.close();
  }
});

test('right-click removes scenery while a construction tool is selected', async ({ page }) => {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  const map = world.map;
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tileIndex = map.index(x, y);
      for (let item = map.firstElement(tileIndex); item >= 0; item = map.nextElement(item)) {
        if (map.elType[item] === ElementType.SmallScenery && map.canBuild(tileIndex)) {
          candidates.push({ x, y });
          break;
        }
      }
    }
  }
  if (candidates.length === 0) throw new Error('Starter Park should have removable scenery');
  const sceneryCountAt = (source: World['map'], x: number, y: number): number => {
    let count = 0;
    for (
      let item = source.firstElement(source.index(x, y));
      item >= 0;
      item = source.nextElement(item)
    ) {
      if (source.elType[item] === ElementType.SmallScenery) count++;
    }
    return count;
  };

  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __camera: { x: number } }).__camera.x))
    .not.toBe(0);
  const parkWindow = page.locator('.ui-window[data-panel="park"]:visible');
  if (await parkWindow.count())
    await parkWindow.getByRole('button', { name: 'Close Park' }).click();
  const landAction = page.locator('.game-toolbar').getByRole('button', { name: 'Land' });
  await landAction.click();
  await expect(page.locator('.ui-window[data-panel="land"]')).toBeVisible();
  await expect(landAction).toHaveAttribute('aria-pressed', 'true');

  const camera = await page.evaluate(() => {
    const value = (
      window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      }
    ).__camera;
    return { ...value };
  });
  const canvas = await page.locator('#game').boundingBox();
  if (!canvas) throw new Error('Game canvas is not visible');
  const target = candidates[0]!;
  const index = map.index(target.x, target.y);
  const point = new Float64Array(2);
  project(
    (target.x + 0.5) * TILE_UNITS,
    (target.y + 0.5) * TILE_UNITS,
    map.heights[index]! * Z_STEP,
    map.width,
    map.height,
    camera.rotation,
    point,
  );
  await page.evaluate(
    ({ x, y }) => {
      const camera = (window as unknown as { __camera: { x: number; y: number } }).__camera;
      camera.x = x;
      camera.y = y;
    },
    { x: point[0]!, y: point[1]! },
  );
  const landWindow = await page.locator('.ui-window[data-panel="land"]').boundingBox();
  const candidatePoints = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
  ];
  const position = candidatePoints.find(({ x, y }) => {
    if (!landWindow) return true;
    const absoluteX = canvas.x + canvas.width * x;
    const absoluteY = canvas.y + canvas.height * y;
    return (
      absoluteX < landWindow.x ||
      absoluteX > landWindow.x + landWindow.width ||
      absoluteY < landWindow.y ||
      absoluteY > landWindow.y + landWindow.height
    );
  });
  if (!position) throw new Error('Could not find an unobstructed map point');
  const localX = canvas.width * position.x;
  const localY = canvas.height * position.y;
  const targetCamera = {
    x: point[0]! - (localX - canvas.width / 2) / camera.zoom,
    y: point[1]! - (localY - canvas.height / 2) / camera.zoom,
  };
  await page.evaluate(({ x, y }) => {
    const current = (window as unknown as { __camera: { x: number; y: number } }).__camera;
    current.x = x;
    current.y = y;
  }, targetCamera);
  const picked = pickTile(
    localX,
    localY,
    map,
    { ...camera, ...targetCamera },
    {
      width: canvas.width,
      height: canvas.height,
    },
  );
  expect(picked).toEqual([target.x, target.y]);
  await page.evaluate(() => {
    document.querySelector('#game')!.addEventListener('contextmenu', (event) => {
      (window as unknown as { __contextMenuAudit?: boolean }).__contextMenuAudit =
        event.defaultPrevented;
    });
  });
  await page.mouse.click(canvas.x + localX, canvas.y + localY, { button: 'right' });
  const contextMenuPrevented = await page.evaluate(
    () => (window as unknown as { __contextMenuAudit?: boolean }).__contextMenuAudit,
  );
  expect(contextMenuPrevented).toBe(true);
  await expect(page.locator('.tool-status')).toContainText(
    `Scenery removal requested at ${target.x}, ${target.y}`,
  );
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save file' }).click();
  const savePath = await (await downloadPromise).path();
  if (!savePath) throw new Error('Save export did not produce a file');
  const savedWorld = deserialize(new Uint8Array(readFileSync(savePath)));
  expect(sceneryCountAt(savedWorld.map, target.x, target.y)).toBe(
    sceneryCountAt(map, target.x, target.y) - 1,
  );
  await page
    .locator('[aria-label="Game menu"]')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close Options' }).click();

  let empty: { x: number; y: number } | undefined;
  for (let y = 0; y < map.height && !empty; y++) {
    for (let x = 0; x < map.width && !empty; x++) {
      const tileIndex = map.index(x, y);
      if (!map.canBuild(tileIndex)) continue;
      let hasScenery = false;
      for (let item = map.firstElement(tileIndex); item >= 0; item = map.nextElement(item)) {
        if (map.elType[item] === ElementType.SmallScenery) {
          hasScenery = true;
          break;
        }
      }
      if (!hasScenery) empty = { x, y };
    }
  }
  if (!empty) throw new Error('Starter Park should have an owned terrain tile without scenery');
  const emptyPoint = new Float64Array(2);
  const emptyIndex = map.index(empty.x, empty.y);
  project(
    (empty.x + 0.5) * TILE_UNITS,
    (empty.y + 0.5) * TILE_UNITS,
    map.heights[emptyIndex]! * Z_STEP,
    map.width,
    map.height,
    camera.rotation,
    emptyPoint,
  );
  await page.evaluate(
    ({ x, y }) => {
      const camera = (window as unknown as { __camera: { x: number; y: number } }).__camera;
      camera.x = x;
      camera.y = y;
    },
    {
      x: emptyPoint[0]! - (localX - canvas.width / 2) / camera.zoom,
      y: emptyPoint[1]! - (localY - canvas.height / 2) / camera.zoom,
    },
  );
  await page.mouse.click(canvas.x + localX, canvas.y + localY, { button: 'right' });
  await expect(page.locator('.tool-status')).toHaveText(
    `No scenery on tile ${empty.x}, ${empty.y} to remove.`,
  );
});
