import { describe, expect, it } from 'vitest';

import { chooseAiAction, type AiStyle } from '../src/ai/strategy';
import { applyAction, createGame } from '../src/shared/game';
import type { Card, GameState, Rank, Suit } from '../src/shared/types';

function cards(text: string): Card[] {
  return text.split(' ').map((token) => ({
    rank: token.slice(0, -1) as Rank,
    suit: token.at(-1) as Suit,
  }));
}

function fixture(hand = '8S 8H KD'): GameState {
  return createGame({
    players: [
      { id: 'bot', name: '青竹' },
      { id: 'p2', name: '小满' },
      { id: 'p3', name: '老周' },
    ],
    startingChips: 1000,
    ante: 10,
    deck: [...cards(hand), ...cards('2S 7H 9D'), ...cards('3S 4H 6D')],
  });
}

describe('chooseAiAction', () => {
  it.each(['cautious', 'bold', 'chaotic'] satisfies AiStyle[])('%s AI always returns a legal action', (style) => {
    for (const randomValue of [0, 0.18, 0.42, 0.76, 0.999]) {
      const state = fixture();
      const action = chooseAiAction(state, 'bot', style, () => randomValue);

      expect(action.playerId).toBe('bot');
      expect(action.turnId).toBe(state.turnId);
      expect(() => applyAction(state, action)).not.toThrow();
    }
  });

  it('makes the bold AI raise with a viewed triple', () => {
    const state = fixture('AS AH AD');
    state.players[0].hasLooked = true;

    expect(chooseAiAction(state, 'bot', 'bold', () => 0).type).toBe('raise');
  });

  it('makes the cautious AI fold a viewed weak hand facing a costly call', () => {
    const state = fixture('2S 7H 9D');
    state.players[0].hasLooked = true;
    state.players[0].chips = 90;
    state.baseBet = 50;

    expect(chooseAiAction(state, 'bot', 'cautious', () => 0).type).toBe('fold');
  });

  it('is reproducible when supplied the same random source', () => {
    const first = chooseAiAction(fixture(), 'bot', 'chaotic', () => 0.61);
    const second = chooseAiAction(fixture(), 'bot', 'chaotic', () => 0.61);

    expect(first).toEqual(second);
  });

  it('forces a comparison after a long round so AI games always terminate', () => {
    const state = fixture('8S 8H KD');
    state.players[0].hasLooked = true;
    state.actionCount = state.players.length * 4;

    expect(chooseAiAction(state, 'bot', 'cautious', () => 0).type).toBe('compare');
  });

  it('rejects attempts to choose for a player who is not acting', () => {
    expect(() => chooseAiAction(fixture(), 'p2', 'bold', () => 0)).toThrowError('AI_NOT_ACTING');
  });
});
