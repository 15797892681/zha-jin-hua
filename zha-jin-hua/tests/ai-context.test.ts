import { describe, expect, it } from 'vitest';

import {
  aiDecisionResponseSchema,
  deepSeekDecisionSchema,
  intentToGameAction,
  isLegalIntent,
  type PublicMemoryEntry,
} from '../src/ai/contracts';
import { actionToMemory, appendPublicMemory, buildAiDecisionRequest } from '../src/ai/context';
import { createGame } from '../src/shared/game';
import type { Card, GameState, Rank, Suit } from '../src/shared/types';

function cards(text: string): Card[] {
  return text.split(' ').map((token) => ({
    rank: token.slice(0, -1) as Rank,
    suit: token.at(-1) as Suit,
  }));
}

function fixture(hasLooked = false): GameState {
  const state = createGame({
    players: [
      { id: 'bot', name: '青竹' },
      { id: 'human', name: '你' },
      { id: 'other', name: '赤焰' },
    ],
    startingChips: 1000,
    ante: 10,
    deck: [
      ...cards('AS AH AD'),
      ...cards('2S 7H 9D'),
      ...cards('KS KH 3D'),
      ...cards('4S 5H 6D'),
    ],
  });
  state.players[0].hasLooked = hasLooked;
  return state;
}

describe('AI request contract', () => {
  it('redacts the deck, every opponent hand, and an unviewed bot hand', () => {
    const request = buildAiDecisionRequest(fixture(false), 'bot', 'cautious', [], 'req-1');
    expect(request.self.cards).toBeNull();
    expect(request.table.players.every((player) => !('cards' in player))).toBe(true);
    expect('deck' in request.table).toBe(false);
    expect(JSON.stringify(request)).not.toContain('2S');
  });

  it('includes only the acting bot hand after look and preserves action costs', () => {
    const request = buildAiDecisionRequest(fixture(true), 'bot', 'cautious', [], 'req-2');
    expect(request.self.cards).toEqual(cards('AS AH AD'));
    expect(request.legalActions.callCost).toBe(20);
    expect(request.legalActions.compareCost).toBe(40);
  });

  it('keeps only the latest eight public entries', () => {
    const entries = Array.from({ length: 10 }, (_, index): PublicMemoryEntry => ({
      kind: 'dialogue', actorId: 'bot', text: `台词${index}`,
    }));
    expect(entries.reduce(appendPublicMemory, [])).toEqual(entries.slice(2));
  });

  it('converts an executed action into public memory without hidden data', () => {
    expect(actionToMemory({ type: 'raise', playerId: 'bot', amount: 20, turnId: 3 }))
      .toEqual({ kind: 'action', actorId: 'bot', action: 'raise', amount: 20 });
  });

  it('rejects extra model fields and dialogue longer than 40 characters', () => {
    expect(deepSeekDecisionSchema.safeParse({
      action: { type: 'fold', playerId: 'fake' }, dialogue: '收手。',
    }).success).toBe(false);
    expect(deepSeekDecisionSchema.safeParse({
      action: { type: 'fold' }, dialogue: '长'.repeat(41),
    }).success).toBe(false);
  });

  it('matches raise amounts and compare targets exactly', () => {
    const legal = buildAiDecisionRequest(fixture(true), 'bot', 'bold', [], 'req-3').legalActions;
    expect(isLegalIntent({ type: 'raise', amount: legal.raiseAmounts[0] }, legal)).toBe(true);
    expect(isLegalIntent({ type: 'raise', amount: 11 }, legal)).toBe(false);
    expect(isLegalIntent({ type: 'compare', targetId: 'human' }, legal)).toBe(true);
    expect(isLegalIntent({ type: 'compare', targetId: 'missing' }, legal)).toBe(false);
  });

  it('injects player and turn identity outside the model output', () => {
    const request = buildAiDecisionRequest(fixture(true), 'bot', 'bold', [], 'req-4');
    expect(intentToGameAction({ type: 'fold' }, request)).toEqual({
      type: 'fold', playerId: 'bot', turnId: 1,
    });
    expect(aiDecisionResponseSchema.parse({
      requestId: 'req-4', turnId: 1, playerId: 'bot',
      action: { type: 'fold', playerId: 'bot', turnId: 1 }, dialogue: '先让你一手。',
    }).playerId).toBe('bot');
  });
});
