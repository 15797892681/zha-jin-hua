import { expect, test } from '@playwright/test';

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

test('the desktop table remains crisp at a wide viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();

  await expect(page.getByRole('region', { name: '操作区' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('desktop-table.png'), fullPage: true });
});
