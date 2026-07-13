import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/client/App';

describe('solo game UI', () => {
  it('opens a playable solo table from the home screen', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: '金局' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '单机对战' }));

    expect(screen.getByText('底池')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '操作区' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '看牌' })).toBeEnabled();
  });

  it('keeps the human cards face-down until the player looks', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '单机对战' }));

    expect(screen.getAllByLabelText('自己的暗牌')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '看牌' }));

    expect(screen.getAllByLabelText(/自己的牌：/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '看牌' })).not.toBeInTheDocument();
  });

  it('opens rules from the home screen and can close them', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '玩法规则' }));
    expect(screen.getByRole('dialog', { name: '玩法规则' })).toBeInTheDocument();
    expect(screen.getByText('豹子')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭规则' }));
    expect(screen.queryByRole('dialog', { name: '玩法规则' })).not.toBeInTheDocument();
  });
});
