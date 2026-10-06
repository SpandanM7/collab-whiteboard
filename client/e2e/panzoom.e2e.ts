import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Pan and zoom, on every project. Drawing works offline, so no server is needed.
const boardUrl = () => `/board/e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function open(page: Page) {
  await page.goto(boardUrl());
  await page.waitForSelector('.toolbar');
}

/** Draws a short horizontal line and returns its start (the line runs 60px to the right). */
async function drawLine(page: Page) {
  const { width, height } = page.viewportSize()!;
  const x = Math.round(width * 0.3);
  const y = Math.round(height * 0.4);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  await page.mouse.up();
  return { x, y };
}

/** Waits for the canvas to repaint after a view change. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

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

/** The box around everything inked, in CSS pixels, or null for a blank canvas. */
const inkBounds = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const dpr = window.devicePixelRatio || 1;
    const { data, width, height } = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height);
    let left = Infinity;
    let top = Infinity;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (data[(py * width + px) * 4 + 3] > 0) {
          if (px < left) left = px;
          if (py < top) top = py;
        }
      }
    }
    return left === Infinity ? null : { left: Math.round(left / dpr), top: Math.round(top / dpr) };
  });

const zoomPercent = async (page: Page) =>
  Number.parseInt((await page.locator('.zoom-level').textContent())!, 10);

test('the wheel pans the board', async ({ page }) => {
  await open(page);
  const { x, y } = await drawLine(page);
  const before = (await inkBounds(page))!;

  await page.mouse.move(x + 30, y + 40);
  await page.mouse.wheel(0, 80); // scrolling down moves the content up
  await settle(page);
  const up = (await inkBounds(page))!;
  expect(up.top).toBeLessThan(before.top - 10);
  expect(up.left).toBe(before.left);

  await page.mouse.wheel(60, 0); // scrolling right moves the content left
  await settle(page);
  const left = (await inkBounds(page))!;
  expect(left.left).toBeLessThan(up.left - 10);
  expect(left.top).toBe(up.top);
});

test('Ctrl + wheel zooms toward the cursor', async ({ page }) => {
  await open(page);
  const { x, y } = await drawLine(page);
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await settle(page);
  expect(await zoomPercent(page)).toBeGreaterThan(100);
  // The point under the cursor did not move.
  expect(await inkAt(page, x + 1, y)).toBe(true);
});

test('the hand tool drags the board', async ({ page }) => {
  await open(page);
  const { x, y } = await drawLine(page);
  // In the toolbar on wide screens; in the More menu on small ones.
  const hand = page.getByRole('button', { name: 'Hand' });
  if (await hand.isVisible()) await hand.click();
  else {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Hand (pan)' }).click();
  }
  await page.mouse.move(x + 30, y + 60);
  await page.mouse.down();
  await page.mouse.move(x + 30 + 90, y + 60 + 20, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  expect(await inkAt(page, x + 30 + 90, y + 20)).toBe(true);
  expect(await inkAt(page, x + 30, y)).toBe(false);
  // The hand tool must not draw.
  await page.getByRole('button', { name: 'Pen' }).click();
  await page.mouse.move(x + 200, y + 100);
  await page.mouse.down();
  await page.mouse.up();
  expect(await inkAt(page, x + 30 + 90 + 100, y + 20)).toBe(false);
});

test('Space + drag pans, and releasing Space goes back to drawing', async ({ page }) => {
  await open(page);
  const { x, y } = await drawLine(page);
  await page.mouse.move(x + 30, y + 60);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(x + 30 - 50, y + 60 + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await settle(page);
  expect(await inkAt(page, x + 30 - 50, y + 30)).toBe(true);

  // Plain drag draws again.
  await page.mouse.move(x, y + 150);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 150, { steps: 4 });
  await page.mouse.up();
  expect(await inkAt(page, x + 20, y + 150)).toBe(true);
});

test('strokes drawn after panning and zooming land under the pointer', async ({ page }) => {
  await open(page);
  const { x, y } = await drawLine(page);
  await page.mouse.move(x, y + 100);
  await page.mouse.wheel(0, 50);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await settle(page);
  await page.mouse.move(x - 20, y + 120);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 120, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  expect(await inkAt(page, x, y + 120)).toBe(true);
});

test('the zoom buttons zoom, reset to 100%, and respect the limits', async ({ page }) => {
  await open(page);
  expect(await zoomPercent(page)).toBe(100);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await zoomPercent(page)).toBe(125);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  expect(await zoomPercent(page)).toBe(80);
  await page.getByRole('button', { name: /Reset to 100%/ }).click();
  expect(await zoomPercent(page)).toBe(100);

  for (let i = 0; i < 20; i++) {
    if (await page.getByRole('button', { name: 'Zoom out' }).isEnabled()) {
      await page.getByRole('button', { name: 'Zoom out' }).click();
    }
  }
  expect(await zoomPercent(page)).toBe(10);
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
});

test('Fit all brings far-away drawings back into view', async ({ page }) => {
  await open(page);
  await drawLine(page);
  await page.mouse.move(100, 300);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(1500, 0); // pan far to the right
  await settle(page);
  expect(await inkCount(page)).toBe(0);

  await page.getByRole('button', { name: 'Fit all content' }).click();
  await settle(page);
  expect(await inkCount(page)).toBeGreaterThan(0);
});

test('Fit all on an empty board goes back to the start', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Fit all content' }).click();
  expect(await zoomPercent(page)).toBe(100);
});

test.describe('two fingers', () => {
  type Finger = { x: number; y: number; id?: number };
  type TouchKind = 'touchStart' | 'touchMove' | 'touchEnd';
  /** Sends touch events over CDP; the session must live as long as the gesture. */
  const fingers = async (page: Page) => {
    const client = await page.context().newCDPSession(page);
    return (type: TouchKind, points: Finger[]) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p, i) => ({ ...p, id: p.id ?? i })),
      });
  };

  test('pinching zooms and does not leave a stroke behind', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'needs a touch screen');
    await open(page);
    const touch = await fingers(page);
    const { width, height } = page.viewportSize()!;
    const cx = Math.round(width * 0.4);
    const cy = Math.round(height * 0.4);

    await touch('touchStart', [
      { x: cx - 20, y: cy },
      { x: cx + 20, y: cy },
    ]);
    for (let spread = 30; spread <= 90; spread += 10) {
      await touch('touchMove', [
        { x: cx - spread, y: cy },
        { x: cx + spread, y: cy },
      ]);
    }
    await touch('touchEnd', []);
    await settle(page);

    expect(await zoomPercent(page)).toBeGreaterThan(200);
    // The first finger had started a stroke: it must be cancelled, not committed.
    expect(await inkCount(page)).toBe(0);
    await expect(page.locator('.connection-pill')).not.toContainText('unsynced');
  });

  test('dragging two fingers pans', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'needs a touch screen');
    await open(page);
    const touch = await fingers(page);
    const { x, y } = await drawLine(page);
    const fingerY = y + 120;

    await touch('touchStart', [
      { x: x, y: fingerY },
      { x: x + 40, y: fingerY },
    ]);
    for (let dx = 10; dx <= 70; dx += 10) {
      await touch('touchMove', [
        { x: x + dx, y: fingerY + dx },
        { x: x + 40 + dx, y: fingerY + dx },
      ]);
    }
    await touch('touchEnd', []);
    await settle(page);

    expect(await zoomPercent(page)).toBe(100);
    expect(await inkAt(page, x + 30 + 70, y + 70)).toBe(true);
    expect(await inkAt(page, x + 30, y)).toBe(false);
  });

  test('a finger left down after a pinch does not start drawing', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'needs a touch screen');
    await open(page);
    const touch = await fingers(page);
    const { width, height } = page.viewportSize()!;
    const cx = Math.round(width * 0.4);
    const cy = Math.round(height * 0.4);

    await touch('touchStart', [
      { x: cx - 20, y: cy },
      { x: cx + 20, y: cy },
    ]);
    await touch('touchMove', [
      { x: cx - 40, y: cy },
      { x: cx + 40, y: cy },
    ]);
    // The first finger lifts (touchEnd lists the fingers being released); the second stays down.
    await touch('touchEnd', [{ id: 0, x: cx - 40, y: cy }]);
    for (let i = 1; i <= 5; i++) {
      await touch('touchMove', [{ id: 1, x: cx + 40, y: cy + i * 10 }]);
    }
    await touch('touchEnd', []);
    await settle(page);
    expect(await inkCount(page)).toBe(0);
  });
});
