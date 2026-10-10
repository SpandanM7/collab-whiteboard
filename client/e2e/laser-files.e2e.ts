import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Laser pointer, SVG export, and saving to / opening from a file, on every project. All of it
// works offline, so no server is needed (the laser's relay is covered by the server tests).
const boardUrl = () => `/board/e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function open(page: Page) {
  await page.goto(boardUrl());
  await page.waitForSelector('.toolbar');
}

/** A 120 x 80 box whose top-left corner sits at 30% / 35% of the viewport. */
function box(page: Page) {
  const { width, height } = page.viewportSize()!;
  const left = Math.round(width * 0.3);
  const top = Math.round(height * 0.35);
  return { left, top, right: left + 120, bottom: top + 80, midX: left + 60, midY: top + 40 };
}

type P = { x: number; y: number };

async function drag(page: Page, from: P, to: P) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

const pick = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

async function menu(page: Page, item: string) {
  await pick(page, 'More');
  await page.getByRole('menuitem', { name: item }).click();
}

async function drawRect(page: Page, b = box(page)) {
  if (!(await page.locator('.shapes-popover').isVisible())) await pick(page, 'Shapes');
  await pick(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
}

/** Whether a canvas has ink anywhere within `r` pixels of a screen point. */
const inkAt = (page: Page, x: number, y: number, r = 0, selector = 'canvas.whiteboard') =>
  page.evaluate(
    ([px, py, pr, sel]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(sel as string)!;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.max(1, Math.round((2 * (pr as number) + 1) * dpr));
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.round(((px as number) - (pr as number)) * dpr),
          Math.round(((py as number) - (pr as number)) * dpr),
          size,
          size,
        ).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    },
    [x, y, r, selector] as const,
  );

/** Picks the laser: a toolbar button on wide screens, the More menu on small ones. */
async function pickLaser(page: Page) {
  const button = page.getByRole('button', { name: 'Laser', exact: true });
  if (await button.isVisible()) await button.click();
  else await menu(page, 'Laser pointer');
}

test('the laser pointer shows a trail that fades and leaves the board untouched', async ({
  page,
}) => {
  await open(page);
  const b = box(page);
  await pickLaser(page);
  await drag(page, { x: b.left, y: b.midY }, { x: b.right, y: b.midY });
  await settle(page);

  expect(await inkAt(page, b.midX, b.midY, 2, 'canvas.laser-layer')).toBe(true);
  expect(await inkAt(page, b.midX, b.midY, 2)).toBe(false);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // Gone within about a second, and nothing was added to the board.
  await expect
    .poll(() => inkAt(page, b.midX, b.midY, 4, 'canvas.laser-layer'), { timeout: 3000 })
    .toBe(false);
  expect(await inkAt(page, b.midX, b.midY, 2)).toBe(false);
});

test('K picks the laser pointer, and it never selects or erases', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('k');
  await drag(page, { x: b.left - 20, y: b.midY }, { x: b.right + 20, y: b.midY });
  await settle(page);
  expect(await inkAt(page, b.left, b.midY, 1)).toBe(true);
  await expect(page.getByRole('toolbar', { name: /^Selection/ })).toBeHidden();
});

test('the export dialog downloads an SVG of the board', async ({ page }) => {
  await open(page);
  await drawRect(page);
  await menu(page, 'Export image…');
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await dialog.getByRole('button', { name: 'SVG', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Scale 2x' })).toBeHidden();
  await expect(dialog.locator('.export-size')).toContainText('vector');
  await expect(dialog.getByRole('img', { name: 'Preview of the exported image' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^whiteboard-e2e-.*\.svg$/);
  const svg = await readFile(await download.path(), 'utf8');
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain('<path d="M');
  await expect(dialog).toBeHidden();
});

test('a board saved to a file opens on another board in the same place', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await page.keyboard.press('Escape');

  const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'Save to file')]);
  expect(download.suggestedFilename()).toMatch(/^whiteboard-e2e-.*\.json$/);
  const saved = await download.path();

  // A fresh board: open the file there.
  await open(page);
  expect(await inkAt(page, b.left, b.midY, 1)).toBe(false);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu(page, 'Open file…')]);
  await chooser.setFiles(saved);
  await expect(page.locator('.toast-region')).toContainText('Added 1 element from the file.');
  await settle(page);
  expect(await inkAt(page, b.left, b.midY, 1)).toBe(true);
  await expect(page.getByRole('toolbar', { name: /^Selection/ })).toBeVisible();

  // Opening is one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await settle(page);
  expect(await inkAt(page, b.left, b.midY, 1)).toBe(false);
});

test('Ctrl+S saves the board instead of the browser saving the page', async ({ page }) => {
  await open(page);
  await drawRect(page);
  await page.keyboard.press('Escape');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
});

test('opening something that is not a saved board says so and changes nothing', async ({
  page,
}) => {
  await open(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu(page, 'Open file…')]);
  await chooser.setFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect(page.locator('.toast-region')).toContainText("isn't a saved board");
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('Save to file is unavailable on an empty board', async ({ page }) => {
  await open(page);
  await pick(page, 'More');
  await expect(page.getByRole('menuitem', { name: 'Save to file' })).toBeDisabled();
});
