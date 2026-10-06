import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Select, move, resize, text, undo/redo and export, on every project. All of it works offline,
// so no server is needed.
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

/** Two animation frames: whatever was scheduled has been painted. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

const pick = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

async function pickShape(page: Page, name: string) {
  if (!(await page.locator('.shapes-popover').isVisible())) await pick(page, 'Shapes');
  await pick(page, name);
}

async function drawRect(page: Page, b = box(page)) {
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
}

/** Whether there is ink at a screen point, or anywhere within `r` pixels of it. */
const inkAt = (page: Page, x: number, y: number, r = 0) =>
  page.evaluate(
    ([px, py, pr]) => {
      const canvas = document.querySelector('canvas')!;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.max(1, Math.round((2 * pr + 1) * dpr));
      const data = canvas
        .getContext('2d')!
        .getImageData(Math.round((px - pr) * dpr), Math.round((py - pr) * dpr), size, size).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    },
    [x, y, r],
  );

/** The color of the canvas at a screen point, as [r, g, b, a]. */
const colorAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector('canvas')!;
      const dpr = window.devicePixelRatio || 1;
      return [
        ...canvas.getContext('2d')!.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1)
          .data,
      ];
    },
    [x, y],
  );

const actions = (page: Page) => page.getByRole('toolbar', { name: /^Selection/ });

test('clicking a shape selects it; dragging moves it; undo and redo put it back', async ({
  page,
}) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'Select');

  await page.mouse.click(b.left, b.midY);
  await expect(actions(page)).toBeVisible();

  // Grabbed by the outline, clear of the edge's resize handle at its middle.
  await drag(page, { x: b.left, y: b.top + 20 }, { x: b.left + 60, y: b.top + 60 });
  await settle(page);
  expect(await inkAt(page, b.left, b.midY - 20)).toBe(false);
  expect(await inkAt(page, b.left + 60, b.bottom + 20, 1)).toBe(true);

  await pick(page, 'Undo');
  await settle(page);
  expect(await inkAt(page, b.left, b.midY - 20, 1)).toBe(true);
  expect(await inkAt(page, b.left + 60, b.bottom + 20)).toBe(false);

  await pick(page, 'Redo');
  await settle(page);
  expect(await inkAt(page, b.left + 60, b.bottom + 20, 1)).toBe(true);
});

test('a hollow shape can be picked up by its middle', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'Select');
  await drag(page, { x: b.midX, y: b.midY }, { x: b.midX + 30, y: b.midY });
  await settle(page);
  expect(await inkAt(page, b.left + 30, b.midY, 1)).toBe(true);
  expect(await inkAt(page, b.left, b.midY)).toBe(false);
});

test('dragging the corner handle resizes without a jump', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'Select');
  await page.mouse.click(b.left, b.midY);
  // The handle is drawn just outside the corner.
  await drag(page, { x: b.right + 4, y: b.bottom + 4 }, { x: b.right + 64, y: b.bottom + 44 });
  await settle(page);
  expect(await inkAt(page, b.right + 60, b.midY + 20, 1)).toBe(true);
  expect(await inkAt(page, b.right, b.midY)).toBe(false);
  // The opposite corner stayed.
  expect(await inkAt(page, b.left, b.top + 10, 1)).toBe(true);
});

test('a marquee selects several elements, and Delete removes them in one undo step', async ({
  page,
}) => {
  await open(page);
  const b = box(page);
  await drawRect(page, { ...b, right: b.left + 40, bottom: b.top + 30 });
  await drawRect(page, {
    ...b,
    left: b.left + 70,
    top: b.top + 40,
    right: b.right,
    bottom: b.bottom,
  });
  await pick(page, 'Select');
  await drag(page, { x: b.left - 20, y: b.top - 20 }, { x: b.right + 20, y: b.bottom + 20 });
  await expect(actions(page)).toHaveAccessibleName('Selection, 2 elements');

  await page.keyboard.press('Delete');
  await settle(page);
  expect(await inkAt(page, b.left, b.top + 15, 1)).toBe(false);
  expect(await inkAt(page, b.right, b.bottom - 20, 1)).toBe(false);

  await pick(page, 'Undo');
  await settle(page);
  expect(await inkAt(page, b.left, b.top + 15, 1)).toBe(true);
  expect(await inkAt(page, b.right, b.bottom - 20, 1)).toBe(true);
});

test('the selection bar duplicates, and Escape deselects', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'Select');
  await page.mouse.click(b.left, b.midY);
  await actions(page).getByRole('button', { name: 'Duplicate' }).click();
  await settle(page);
  // The copy sits 16 units down and to the right, and is the new selection.
  expect(await inkAt(page, b.left + 16, b.bottom + 16, 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(actions(page)).toBeHidden();
});

test('restyling the selection recolors it', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'Select');
  await page.mouse.click(b.left, b.midY);
  const panel = page.locator('.style-panel');
  if (!(await panel.isVisible())) await pick(page, 'Style');
  await page.getByRole('button', { name: 'Stroke color #e03131' }).click();
  const close = page.getByRole('button', { name: 'Close style' });
  if (await close.isVisible()) await close.click();
  await settle(page);
  const [r, g] = await colorAt(page, b.left, b.midY - 20);
  expect(r).toBeGreaterThan(180);
  expect(g).toBeLessThan(100);
});

test('the text tool types a text in place; double-click edits it', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pick(page, 'Text');
  await page.mouse.click(b.left, b.midY);
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await settle(page);
  expect(await inkAt(page, b.left + 20, b.midY, 8)).toBe(true);

  await pick(page, 'Select');
  await page.mouse.dblclick(b.left + 10, b.midY);
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('Hello');
  await page.keyboard.press('End');
  await page.keyboard.type(' there');
  await page.keyboard.press('Escape');
  await settle(page);
  expect(await inkAt(page, b.left + 80, b.midY, 8)).toBe(true);
});

test('an empty text is not kept', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pick(page, 'Text');
  await page.mouse.click(b.left, b.midY);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('one eraser drag is one undo step', async ({ page }) => {
  await open(page);
  const b = box(page);
  for (const x of [b.left, b.midX, b.right]) {
    await drag(page, { x, y: b.top }, { x, y: b.bottom });
  }
  await pick(page, 'Eraser');
  await drag(page, { x: b.left - 10, y: b.midY }, { x: b.right + 10, y: b.midY });
  await settle(page);
  expect(await inkAt(page, b.midX, b.top + 5, 1)).toBe(false);
  await pick(page, 'Undo');
  await settle(page);
  for (const x of [b.left, b.midX, b.right]) expect(await inkAt(page, x, b.top + 5, 1)).toBe(true);
});

test('Ctrl+Z undoes a stroke and Ctrl+Shift+Z redoes it', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drag(page, { x: b.left, y: b.midY }, { x: b.right, y: b.midY });
  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await inkAt(page, b.midX, b.midY, 1)).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  await settle(page);
  expect(await inkAt(page, b.midX, b.midY, 1)).toBe(true);
});

test('the export dialog previews the board and downloads a PNG', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'More');
  await page.getByRole('menuitem', { name: 'Export image…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Preview of the exported image' })).toBeVisible();
  // 120 x 80 plus the line width and 32 units of padding each side, at 2x.
  await expect(dialog.locator('.export-size')).toContainText('× ');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PNG' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^whiteboard-e2e-.*\.png$/);
  await expect(dialog).toBeHidden();
  // The board is untouched.
  expect(await inkAt(page, b.left, b.midY, 1)).toBe(true);
});

test('the export dialog says when there is nothing to export', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(dialog).toContainText('Nothing to export yet');
  await expect(dialog.getByRole('button', { name: 'Download PNG' })).toBeDisabled();
});

test('the shortcuts dialog opens with ? and closes with Escape', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the selection bar and history controls stay on screen', async ({ page }) => {
  await open(page);
  const b = box(page);
  await drawRect(page);
  await pick(page, 'Select');
  await page.mouse.click(b.left, b.midY);
  const viewport = page.viewportSize()!;
  for (const locator of [actions(page), page.getByRole('group', { name: 'History' })]) {
    const r = (await locator.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(viewport.width);
    expect(r.y + r.height).toBeLessThanOrEqual(viewport.height);
  }
});
