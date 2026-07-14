import { expect, test } from '@playwright/test';

test('solo AI shows thinking, dialogue, and applies one legal action', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ai/decision', async (route) => {
    calls += 1;
    const request = route.request().postDataJSON();
    expect(request.legalActions.canFold).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: request.requestId,
        turnId: request.turnId,
        playerId: request.playerId,
        action: { type: 'fold', playerId: request.playerId, turnId: request.turnId },
        dialogue: '这轮先观察。',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  await page.getByRole('button', { name: '跟注' }).click();

  await expect(page.getByText('正在思考…')).toBeVisible();
  await expect(page.getByText('这轮先观察。')).toBeVisible();
  expect(calls).toBe(1);
});

test('solo game continues when the AI endpoint is unavailable', async ({ page }) => {
  await page.route('**/api/ai/decision', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{}',
  }));

  await page.goto('/');
  await page.getByRole('button', { name: '单机对战' }).click();
  await page.getByRole('button', { name: '弃牌' }).click();

  await expect(page.getByRole('dialog', { name: '本局结算' })).toBeVisible({ timeout: 20_000 });
});
