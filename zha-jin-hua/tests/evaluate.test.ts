import { describe, expect, it } from 'vitest';

import { createDeck, shuffleDeck } from '../src/shared/cards';
import { compareHands, evaluateHand } from '../src/shared/evaluate';
import type { Card, Rank, Suit } from '../src/shared/types';

function hand(text: string): Card[] {
  return text.split(' ').map((token) => ({
    rank: token.slice(0, -1) as Rank,
    suit: token.at(-1) as Suit,
  }));
}

describe('cards', () => {
  it('creates a standard deck containing 52 unique cards', () => {
    const deck = createDeck();

    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => `${card.rank}${card.suit}`))).toHaveLength(52);
  });

  it('supports deterministic shuffling with an injected random source', () => {
    const first = shuffleDeck(createDeck(), () => 0);
    const second = shuffleDeck(createDeck(), () => 0);

    expect(first).toEqual(second);
    expect(first).not.toEqual(createDeck());
  });
});

describe('evaluateHand', () => {
  it.each([
    ['AS AH AD', 'triple'],
    ['QH KH AH', 'straight-flush'],
    ['2S 7S JS', 'flush'],
    ['9S 10H JD', 'straight'],
    ['8S 8H KD', 'pair'],
    ['2S 7H KD', 'high-card'],
  ])('recognizes %s as %s', (cards, category) => {
    expect(evaluateHand(hand(cards)).category).toBe(category);
  });

  it('treats A23 as the lowest straight and QKA as the highest straight', () => {
    expect(compareHands(hand('AS 2H 3D'), hand('2S 3H 4D'))).toBeLessThan(0);
    expect(compareHands(hand('QS KH AD'), hand('JS QH KD'))).toBeGreaterThan(0);
  });

  it('orders pairs by pair rank and then kicker', () => {
    expect(compareHands(hand('8S 8H 2D'), hand('7S 7H AD'))).toBeGreaterThan(0);
    expect(compareHands(hand('8S 8H KD'), hand('8D 8C QH'))).toBeGreaterThan(0);
  });

  it('orders high-card hands lexicographically from the highest rank', () => {
    expect(compareHands(hand('AS 9H 3D'), hand('AH 8D 7C'))).toBeGreaterThan(0);
  });

  it('ignores suit and returns zero for equal rank values', () => {
    expect(compareHands(hand('AS KH 9D'), hand('AH KD 9C'))).toBe(0);
  });

  it('rejects a hand that does not contain exactly three cards', () => {
    expect(() => evaluateHand(hand('AS KH'))).toThrowError('手牌必须正好为三张');
  });
});
