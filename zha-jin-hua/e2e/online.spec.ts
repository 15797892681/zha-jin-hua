import { expect, test } from '@playwright/test';

test('two browsers can join, play, and resume the same room', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await host.getByRole('button', { name: '联网房间' }).click();
  await host.getByLabel('昵称').fill('房主');
  await host.getByRole('button', { name: '创建房间' }).click();
  const roomCode = (await host.locator('.room-code-display strong').textContent())?.trim();
  expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

  await guest.goto('/');
  await guest.getByRole('button', { name: '联网房间' }).click();
  await guest.getByLabel('昵称').fill('好友');
  await guest.getByLabel('房间码').fill(roomCode as string);
  await guest.getByRole('button', { name: '加入房间' }).click();

  await expect(host.getByText('好友', { exact: true })).toBeVisible();
  await host.getByRole('button', { name: '开始游戏' }).click();
  await expect(host.getByRole('main')).toHaveClass(/game-screen/);
  await expect(guest.getByRole('main')).toHaveClass(/game-screen/);

  await host.getByRole('button', { name: '弃牌' }).click();
  await expect(host.getByRole('dialog', { name: '本局结算' })).toBeVisible();
  await expect(guest.getByRole('dialog', { name: '本局结算' })).toBeVisible();

  await guest.reload();
  await guest.getByRole('button', { name: '联网房间' }).click();
  await expect(guest.getByRole('dialog', { name: '本局结算' })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
