export const SUITS = ['S', 'H', 'D', 'C'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'straight'
  | 'flush'
  | 'straight-flush'
  | 'triple';

export interface HandValue {
  category: HandCategory;
  categoryScore: number;
  tieBreakers: number[];
}
