import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shapes, on every project. Drawing works offline, so no server is needed.
const boardUrl = () => `/board/e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function open(page: Page) {
  await page.goto(boardUrl());
  await page.waitForSelector('.toolbar');
}

/** A 120 x 80 box whose top-left corner sits at 30% / 30% of the viewport. */
function box(page: Page) {
  const { width, height } = page.viewportSize()!;
  const left = Math.round(width * 0.3);
  const top = Math.round(height * 0.3);
  return { left, top, right: left + 120, bottom: top + 80, midX: left + 60, midY: top + 40 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const pick = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

/** The shapes live in a popover under one toolbar button. */
async function openShapes(page: Page) {
  if (!(await page.locator('.shapes-popover').isVisible())) await pick(page, 'Shapes');
  await expect(page.locator('.shapes-popover')).toBeVisible();
}

async function pickShape(page: Page, name: string) {
  await openShapes(page);
  await pick(page, name);
}

const inkAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector('canvas')!;
      const dpr = window.devicePixelRatio || 1;
      const data = canvas
        .getContext('2d')!
        .getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data;
      return data[3] > 0;
    },
    [x, y],
  );

const inkCount = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });

test('a rectangle is drawn as an outline between the dragged corners', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });

  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true); // top edge
  expect(await inkAt(page, b.left, b.midY)).toBe(true); // left edge
  expect(await inkAt(page, b.midX, b.midY)).toBe(false); // hollow
  expect(await inkAt(page, b.right + 20, b.midY)).toBe(false);
});

test('dragging the other way draws the same rectangle', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.right, y: b.bottom }, { x: b.left, y: b.top });

  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true);
  expect(await inkAt(page, b.midX, b.bottom)).toBe(true);
});

test('the fill option fills rectangles and ellipses', async ({ page }) => {
  await open(page);
  const b = box(page);
  await openShapes(page);
  await pick(page, 'Fill rectangles and ellipses');
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
  await expect.poll(() => inkAt(page, b.midX, b.midY)).toBe(true);

  await pickShape(page, 'Ellipse');
  const lowerTop = b.bottom + 40;
  await drag(page, { x: b.left, y: lowerTop }, { x: b.right, y: lowerTop + 80 });
  await expect.poll(() => inkAt(page, b.midX, lowerTop + 40)).toBe(true);
  // The corner of an ellipse's bounding box stays empty.
  expect(await inkAt(page, b.left + 3, lowerTop + 3)).toBe(false);
});

test('an ellipse touches its bounding box at the edge midpoints only', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Ellipse');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });

  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true);
  expect(await inkAt(page, b.right, b.midY)).toBe(true);
  expect(await inkAt(page, b.midX, b.midY)).toBe(false);
  expect(await inkAt(page, b.left + 2, b.top + 2)).toBe(false);
});

test('a line and an arrow follow the drag, and the arrow has a head', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Line');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.top });
  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true);
  const lineInk = await inkCount(page);

  await pickShape(page, 'Arrow');
  const y = b.bottom + 40;
  await drag(page, { x: b.left, y }, { x: b.right, y });
  await expect.poll(() => inkAt(page, b.midX, y)).toBe(true);
  // Same length, but the head adds ink above and below the line near its tip.
  expect(await inkAt(page, b.right - 8, y - 6)).toBe(true);
  expect(await inkCount(page)).toBeGreaterThan(lineInk * 2);
});

test('a click without a drag does not leave a shape behind', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await page.mouse.click(b.midX, b.midY);
  await page.mouse.move(b.midX, b.midY);
  await page.mouse.down();
  await page.mouse.move(b.midX + 1, b.midY + 1);
  await page.mouse.up();
  expect(await inkCount(page)).toBe(0);
});

test('the preview follows the pointer and is only kept on release', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await page.mouse.move(b.left, b.top);
  await page.mouse.down();
  await page.mouse.move(b.right, b.bottom, { steps: 6 });
  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true); // visible while dragging
  await page.mouse.move(b.left + 40, b.top + 40, { steps: 6 }); // shrink it again
  await expect.poll(() => inkAt(page, b.right, b.midY)).toBe(false);
  await page.mouse.up();
  await expect.poll(() => inkAt(page, b.left + 40, b.top + 20)).toBe(true);
});

test('the eraser removes a whole shape', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true);

  await pick(page, 'Eraser');
  await page.mouse.click(b.midX, b.top);
  await expect.poll(() => inkCount(page)).toBe(0);
});

test('a hollow shape is not erased by clicking inside it', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true);

  await pick(page, 'Eraser');
  await page.mouse.click(b.midX, b.midY);
  expect(await inkAt(page, b.midX, b.top)).toBe(true);
});

test('shapes move with the view when zoomed', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pickShape(page, 'Rectangle');
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(true);

  await page.getByRole('button', { name: 'Zoom out' }).click();
  // The old top edge position is empty once the board has zoomed out around the center.
  await expect.poll(() => inkAt(page, b.midX, b.top)).toBe(false);
  expect(await inkCount(page)).toBeGreaterThan(0);
});

test('the Shapes button opens a popover with every shape, and Escape closes it', async ({
  page,
}) => {
  await open(page);
  await pick(page, 'Shapes');
  const popover = page.locator('.shapes-popover');
  await expect(popover).toBeVisible();
  for (const name of ['Rectangle', 'Ellipse', 'Line', 'Arrow', 'Fill rectangles and ellipses']) {
    await expect(popover.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const viewport = page.viewportSize()!;
  const box = (await popover.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  // The shape tool stays selected after the popover closes.
  await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('starting to draw closes the popover', async ({ page }) => {
  await open(page);
  const b = box(page);
  await pick(page, 'Shapes');
  await expect(page.locator('.shapes-popover')).toBeVisible();
  await drag(page, { x: b.left, y: b.top }, { x: b.right, y: b.bottom });
  await expect(page.locator('.shapes-popover')).toBeHidden();
});
