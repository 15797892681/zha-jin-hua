import { expect, test } from '@playwright/test';

const raiseViewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
];

for (const viewport of raiseViewports) {
  test(`the raise popover fits above the action dock on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.getByRole('button', { name: '单机对战' }).click();

    const scrollBeforeOpen = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    await page.getByRole('button', { name: '加注' }).click();

    const dialog = page.getByRole('dialog', { name: '选择加注' });
    const dock = page.getByRole('region', { name: '操作区' });
    await expect(dialog).toBeInViewport();
    const [dialogBox, dockBox] = await Promise.all([dialog.boundingBox(), dock.boundingBox()]);
    expect(dialogBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    if (!dialogBox || !dockBox) throw new Error('Raise dialog or action dock has no layout box');
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(dockBox.y - 6);

    const buttons = dialog.getByRole('button');
    for (let index = 0; index < await buttons.count(); index += 1) {
      await expect(buttons.nth(index)).toBeInViewport();
    }

    const layerStyles = await page.locator('.sheet-backdrop').evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        backgroundColor: styles.backgroundColor,
        backdropFilter: styles.backdropFilter,
      };
    });
    expect(layerStyles).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backdropFilter: 'none',
    });
    expect(await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))).toEqual(scrollBeforeOpen);
  });
}

test('the raise popover closes without an action and submits the selected amount', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();

  const raiseButton = page.getByRole('button', { name: '加注' });
  await raiseButton.click();
  const dialog = page.getByRole('dialog', { name: '选择加注' });
  await expect(dialog).not.toHaveAttribute('aria-modal');
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(page.locator('.last-action')).toHaveCount(0);

  await raiseButton.click();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.last-action')).toHaveCount(0);

  await raiseButton.click();
  const firstAmount = dialog.locator('.raise-grid button').first();
  const amount = await firstAmount.locator('strong').textContent();
  expect(amount).not.toBeNull();
  await firstAmount.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.last-action')).toContainText(`加注 ${amount}`);
});

test('the game table fits a phone viewport without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ai/decision', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{}',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  await page.getByRole('button', { name: /跟注 10/ }).click();

  const notice = page.getByRole('status');
  await expect(notice).toBeVisible();
  const overlapsTopSeat = await notice.evaluate((element) => {
    const noticeBox = element.getBoundingClientRect();
    const seatBox = document.querySelector('.seat-2')?.getBoundingClientRect();
    if (!seatBox) return true;
    return !(
      noticeBox.right <= seatBox.left
      || noticeBox.left >= seatBox.right
      || noticeBox.bottom <= seatBox.top
      || noticeBox.top >= seatBox.bottom
    );
  });
  expect(overlapsTopSeat).toBe(false);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('region', { name: '操作区' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('mobile-table.png'), fullPage: true });
});

test('long AI dialogue fits a phone viewport without horizontal overflow', async ({ page }) => {
  const dialogue = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜';
  expect([...dialogue]).toHaveLength(40);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ai/decision', async (route) => {
    const request = route.request().postDataJSON();
    expect(request.legalActions.canFold).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: request.requestId,
        turnId: request.turnId,
        playerId: request.playerId,
        action: { type: 'fold', playerId: request.playerId, turnId: request.turnId },
        dialogue,
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  await page.getByRole('button', { name: /跟注 10/ }).click();
  await expect(page.locator('.ai-speech', { hasText: dialogue })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the desktop table remains crisp at a wide viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();

  await expect(page.getByRole('region', { name: '操作区' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('desktop-table.png'), fullPage: true });
});
