import { expect, test } from '@playwright/test';

test('the game table fits a phone viewport without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();

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
