import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Runs on every project in playwright.config.ts (phone, phone landscape, tablet, desktop).
// Board ids are unique per run so tests never share a room. Drawing works offline, so these
// do not depend on the server being reachable.
const boardUrl = () => `/board/e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Box = { x: number; y: number; width: number; height: number };

async function visibleBox(locator: Locator): Promise<Box | null> {
  if (!(await locator.isVisible())) return null;
  return locator.boundingBox();
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

async function open(page: Page) {
  await page.goto(boardUrl());
  await page.waitForSelector('.toolbar');
}

test('the page never scrolls or overflows sideways', async ({ page }) => {
  await open(page);
  const { inner, scroll } = await page.evaluate(() => ({
    inner: [window.innerWidth, window.innerHeight],
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  }));
  expect(scroll[0]).toBeLessThanOrEqual(inner[0]);
  expect(scroll[1]).toBeLessThanOrEqual(inner[1]);
});

test('top bar and toolbar do not overlap and stay on screen', async ({ page }) => {
  await open(page);
  const viewport = page.viewportSize()!;
  const parts: Record<string, Box | null> = {
    toolbar: await visibleBox(page.locator('.toolbar')),
    status: await visibleBox(page.locator('.connection-pill')),
    share: await visibleBox(page.locator('.share-button')),
    chip: await visibleBox(page.locator('.participants-chip')),
    list: await visibleBox(page.locator('.participants')),
  };

  const shown = Object.entries(parts).filter((entry): entry is [string, Box] => entry[1] !== null);
  expect(shown.map(([name]) => name)).toEqual(
    expect.arrayContaining(['toolbar', 'status', 'share']),
  );
  for (const [name, box] of shown) {
    expect(box.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${name} top edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name} right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height, `${name} bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
  }
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      expect(overlaps(shown[i][1], shown[j][1]), `${shown[i][0]} overlaps ${shown[j][0]}`).toBe(
        false,
      );
    }
  }
});

test('toolbar controls do not overlap each other', async ({ page }) => {
  await open(page);
  const boxes: Box[] = [];
  const controls = page.locator(
    '.toolbar > button:visible, .toolbar > label:visible > input[type=color]',
  );
  for (let i = 0; i < (await controls.count()); i++) {
    const box = await controls.nth(i).boundingBox();
    if (box) boxes.push(box);
  }
  expect(boxes.length).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlaps(boxes[i], boxes[j]), `control ${i} overlaps control ${j}`).toBe(false);
    }
  }
});

test('touch targets are at least 44px on touch devices', async ({ page }) => {
  await open(page);
  const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
  test.skip(!coarse, 'mouse-driven layout');
  const targets = page.locator(
    '.toolbar > button:visible, .share-button:visible, .participants-chip:visible',
  );
  for (let i = 0; i < (await targets.count()); i++) {
    const box = (await targets.nth(i).boundingBox())!;
    expect(box.height, `target ${i} height`).toBeGreaterThanOrEqual(40);
    expect(box.width, `target ${i} width`).toBeGreaterThanOrEqual(40);
  }
});

test('strokes land under the pointer, including the far right and bottom', async ({ page }) => {
  await open(page);
  const { width, height } = page.viewportSize()!;
  // Keep clear of the toolbar, which is on top (desktop) or on the bottom edge (compact).
  const spots = [
    { x: 24, y: Math.round(height / 2) },
    { x: Math.round(width / 2), y: Math.round(height / 2) },
    { x: width - 24, y: Math.round(height / 2) },
    { x: width - 24, y: height - 130 },
  ];
  for (const spot of spots) {
    await page.mouse.move(spot.x - 10, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x, spot.y, { steps: 4 });
    await page.mouse.move(spot.x + 4, spot.y, { steps: 2 });
    await page.mouse.up();
  }
  const inked = await page.evaluate((points) => {
    const canvas = document.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    return points.map(
      ({ x, y }) => ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3] > 0,
    );
  }, spots);
  expect(inked).toEqual(spots.map(() => true));
});

test('the compact layout opens the participants list and the width slider', async ({ page }) => {
  await open(page);
  const chip = page.locator('.participants-chip');
  test.skip(!(await chip.isVisible()), 'desktop layout shows both inline');

  await expect(page.locator('.participants')).toBeHidden();
  await chip.click();
  await expect(page.locator('.participants')).toBeVisible();
  await expect(page.getByLabel('Your display name')).toBeVisible();
  const list = (await page.locator('.participants').boundingBox())!;
  expect(list.x).toBeGreaterThanOrEqual(0);
  expect(list.x + list.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await chip.click();

  await expect(page.getByRole('slider', { name: 'Stroke width' })).toBeHidden();
  await page.locator('.width-toggle').click();
  const slider = page.getByRole('slider', { name: 'Stroke width' });
  await expect(slider).toBeVisible();
  const box = (await slider.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('the landing page fits the screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
  const { inner, scroll } = await page.evaluate(() => ({
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(inner);
  const join = (await page.getByPlaceholder('Join with code').boundingBox())!;
  expect(join.x).toBeGreaterThanOrEqual(0);
  expect(join.x + join.width).toBeLessThanOrEqual(inner);
});
