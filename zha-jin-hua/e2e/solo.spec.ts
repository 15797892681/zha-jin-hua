import { expect, test } from '@playwright/test';

test('a player can look at their cards and finish a solo round', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();

  await expect(page.getByRole('main')).toHaveClass(/game-screen/);
  await page.getByRole('button', { name: '看牌' }).click();
  await expect(page.locator('[aria-label^="自己的牌："]')).toHaveCount(3);

  await page.getByRole('button', { name: '弃牌' }).click();
  await expect(page.getByRole('dialog', { name: '本局结算' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /下一局|重置筹码再来/ })).toBeVisible();
});
