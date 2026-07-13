import { expect, it } from 'vitest';

import { applyAction, createGame } from '../src/shared/game';
import { toPlayerView } from '../src/shared/visibility';

function game() {
  return createGame({
    players: [
      { id: 'p1', name: '阿林' },
      { id: 'p2', name: '小满' },
    ],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
}

it('reveals only the viewer hand while a round is active', () => {
  const view = toPlayerView(game(), 'p1');

  expect(view.players.find((player) => player.id === 'p1')?.cards.every(Boolean)).toBe(true);
  expect(view.players.find((player) => player.id === 'p2')?.cards).toEqual([null, null, null]);
  expect(view).not.toHaveProperty('deck');
});

it('reveals non-folded hands but keeps folded hands hidden after settlement', () => {
  const initial = game();
  const finished = applyAction(initial, {
    type: 'fold',
    playerId: 'p1',
    turnId: initial.turnId,
  });
  const view = toPlayerView(finished, 'p2');

  expect(view.players.find((player) => player.id === 'p1')?.cards).toEqual([null, null, null]);
  expect(view.players.find((player) => player.id === 'p2')?.cards.every(Boolean)).toBe(true);
});

it('returns no legal actions when the viewer is not the current player', () => {
  const view = toPlayerView(game(), 'p2');

  expect(view.legalActions.callCost).toBeNull();
  expect(view.legalActions.canFold).toBe(false);
});
