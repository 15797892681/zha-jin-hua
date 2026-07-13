import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GameTable } from '../src/client/components/GameTable';
import { createGame } from '../src/shared/game';
import { toPlayerView } from '../src/shared/visibility';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T08:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

it('renders the server deadline as a visible countdown', () => {
  const game = createGame({
    players: [
      { id: 'p1', name: '阿林' },
      { id: 'p2', name: '小满' },
    ],
    startingChips: 1000,
    ante: 10,
  });
  game.turnDeadline = Date.now() + 30_000;

  render(
    <GameTable
      view={toPlayerView(game, 'p1')}
      viewerId="p1"
      onAction={vi.fn()}
      onNextRound={vi.fn()}
      onReset={vi.fn()}
      onExit={vi.fn()}
    />,
  );

  expect(screen.getByLabelText('行动剩余时间')).toHaveTextContent('30 秒');
  act(() => vi.advanceTimersByTime(1_001));
  expect(screen.getByLabelText('行动剩余时间')).toHaveTextContent('29 秒');
});
