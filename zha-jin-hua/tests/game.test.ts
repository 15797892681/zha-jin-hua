import { describe, expect, it } from 'vitest';

import { applyAction, createGame, legalActions } from '../src/shared/game';
import type { Card, GameConfig, Rank, Suit } from '../src/shared/types';

function cards(text: string): Card[] {
  return text.split(' ').map((token) => ({
    rank: token.slice(0, -1) as Rank,
    suit: token.at(-1) as Suit,
  }));
}

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    players: [
      { id: 'p1', name: '阿林' },
      { id: 'p2', name: '小满' },
      { id: 'p3', name: '老周' },
      { id: 'p4', name: '安安' },
    ],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
    ...overrides,
  };
}

describe('createGame', () => {
  it('collects the ante, deals three cards and starts with the first player', () => {
    const state = createGame(config());

    expect(state.pot).toBe(40);
    expect(state.players.every((player) => player.cards.length === 3 && player.chips === 990)).toBe(true);
    expect(state.currentPlayerId).toBe('p1');
    expect(state.baseBet).toBe(10);
  });

  it('requires between two and six funded players', () => {
    expect(() => createGame(config({ players: [{ id: 'p1', name: '阿林' }] }))).toThrowError('PLAYER_COUNT');
    expect(() => createGame(config({ startingChips: 5 }))).toThrowError('INSUFFICIENT_ANTE');
  });
});

describe('applyAction', () => {
  it('rejects an action from a player whose turn it is not', () => {
    const state = createGame(config());

    expect(() => applyAction(state, { type: 'fold', playerId: 'p2', turnId: state.turnId }))
      .toThrowError('NOT_YOUR_TURN');
  });

  it('rejects an action carrying a stale turn identifier', () => {
    const state = createGame(config());

    expect(() => applyAction(state, { type: 'fold', playerId: 'p1', turnId: state.turnId - 1 }))
      .toThrowError('STALE_TURN');
  });

  it('lets a player look without ending their turn and doubles their call cost', () => {
    const state = createGame(config());
    const looked = applyAction(state, { type: 'look', playerId: 'p1', turnId: state.turnId });

    expect(looked.currentPlayerId).toBe('p1');
    expect(looked.players[0].hasLooked).toBe(true);
    expect(legalActions(looked, 'p1').callCost).toBe(20);
    expect(legalActions(looked, 'p1').canLook).toBe(false);
  });

  it('charges a call and advances clockwise', () => {
    const state = createGame(config());
    const called = applyAction(state, { type: 'call', playerId: 'p1', turnId: state.turnId });

    expect(called.players[0].chips).toBe(980);
    expect(called.pot).toBe(50);
    expect(called.currentPlayerId).toBe('p2');
  });

  it('raises only to an allowed table level and charges the viewed multiplier', () => {
    let state = createGame(config());
    state = applyAction(state, { type: 'look', playerId: 'p1', turnId: state.turnId });
    const raised = applyAction(state, { type: 'raise', playerId: 'p1', amount: 20, turnId: state.turnId });

    expect(raised.baseBet).toBe(20);
    expect(raised.players[0].chips).toBe(950);
    expect(raised.pot).toBe(80);
    expect(() => applyAction(createGame(config()), {
      type: 'raise',
      playerId: 'p1',
      amount: 15,
      turnId: 1,
    })).toThrowError('ILLEGAL_RAISE');
  });

  it('disables calls and raises that a player cannot afford', () => {
    const state = createGame(config({ startingChips: 15, ante: 10 }));
    const actions = legalActions(state, 'p1');

    expect(actions.callCost).toBeNull();
    expect(actions.raiseAmounts).toEqual([]);
  });

  it('finishes and awards the pot when every opponent folds', () => {
    let state = createGame(config({ players: config().players.slice(0, 2) }));
    state = applyAction(state, { type: 'fold', playerId: 'p1', turnId: state.turnId });

    expect(state.status).toBe('finished');
    expect(state.winnerIds).toEqual(['p2']);
    expect(state.players.find((player) => player.id === 'p2')?.chips).toBe(1010);
  });

  it('eliminates the weaker compare target and awards the pot to the last player', () => {
    const state = createGame(config({
      players: config().players.slice(0, 2),
      deck: cards('AS AH AD 2S 7H KD'),
    }));
    const compared = applyAction(state, {
      type: 'compare',
      playerId: 'p1',
      targetId: 'p2',
      turnId: state.turnId,
    });

    expect(compared.status).toBe('finished');
    expect(compared.players.find((player) => player.id === 'p2')?.status).toBe('out');
    expect(compared.winnerIds).toEqual(['p1']);
    expect(compared.pot).toBe(40);
  });

  it('eliminates the compare initiator when both hands tie', () => {
    const state = createGame(config({
      players: config().players.slice(0, 2),
      deck: cards('AS KH 9D AH KD 9C'),
    }));
    const compared = applyAction(state, {
      type: 'compare',
      playerId: 'p1',
      targetId: 'p2',
      turnId: state.turnId,
    });

    expect(compared.players.find((player) => player.id === 'p1')?.status).toBe('out');
    expect(compared.winnerIds).toEqual(['p2']);
  });
});
