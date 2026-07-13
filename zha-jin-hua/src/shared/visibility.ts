import { legalActions } from './game';
import type { GameState, PlayerGameView } from './types';

export function toPlayerView(state: GameState, viewerId: string): PlayerGameView {
  const { deck: _deck, players, ...visibleState } = state;

  return {
    ...visibleState,
    players: players.map((player) => {
      const mayReveal = player.id === viewerId
        || (state.status === 'finished' && player.status !== 'folded');
      return {
        ...player,
        cards: mayReveal
          ? player.cards.map((card) => ({ ...card }))
          : player.cards.map(() => null),
      };
    }),
    legalActions: legalActions(state, viewerId),
  };
}
