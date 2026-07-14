import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { RaiseSheet } from '../src/client/components/RaiseSheet';

it('keeps raise choices accessible without modal semantics', async () => {
  const user = userEvent.setup();
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const anchor = document.createElement('section');
  document.body.append(anchor);

  render(
    <RaiseSheet
      anchor={anchor}
      amounts={[20, 40, 80]}
      multiplier={2}
      onChoose={onChoose}
      onClose={onClose}
    />,
  );

  const dialog = screen.getByRole('dialog', { name: '选择加注' });
  expect(dialog).not.toHaveAttribute('aria-modal');
  const amountButton = screen.getByRole('button', { name: '20支付 40' });
  expect(amountButton).toBeEnabled();

  await user.click(amountButton);
  expect(onChoose).toHaveBeenCalledWith(20);
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('presentation'));
  expect(onClose).toHaveBeenCalledTimes(2);

  anchor.remove();
});
