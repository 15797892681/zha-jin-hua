import type { Card, HandCategory, HandValue, Rank } from './types';

const RANK_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const CATEGORY_SCORE: Record<HandCategory, number> = {
  'high-card': 1,
  pair: 2,
  straight: 3,
  flush: 4,
  'straight-flush': 5,
  triple: 6,
};

function value(category: HandCategory, tieBreakers: number[]): HandValue {
  return { category, categoryScore: CATEGORY_SCORE[category], tieBreakers };
}

function straightHighCard(sortedAscending: number[]): number | null {
  if (sortedAscending[0] === 2 && sortedAscending[1] === 3 && sortedAscending[2] === 14) {
    return 3;
  }

  if (
    sortedAscending[1] === sortedAscending[0] + 1
    && sortedAscending[2] === sortedAscending[1] + 1
  ) {
    return sortedAscending[2];
  }

  return null;
}

export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length !== 3) {
    throw new Error('手牌必须正好为三张');
  }

  const ranks = cards.map((card) => RANK_VALUE[card.rank]).sort((left, right) => left - right);
  const counts = new Map<number, number>();
  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }

  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const highStraight = counts.size === 3 ? straightHighCard(ranks) : null;

  if (counts.size === 1) {
    return value('triple', [ranks[0]]);
  }

  if (isFlush && highStraight !== null) {
    return value('straight-flush', [highStraight]);
  }

  if (isFlush) {
    return value('flush', [...ranks].reverse());
  }

  if (highStraight !== null) {
    return value('straight', [highStraight]);
  }

  const pairRank = [...counts.entries()].find(([, count]) => count === 2)?.[0];
  if (pairRank !== undefined) {
    const kicker = ranks.find((rank) => rank !== pairRank);
    return value('pair', [pairRank, kicker ?? 0]);
  }

  return value('high-card', [...ranks].reverse());
}

export function compareHands(left: readonly Card[], right: readonly Card[]): number {
  const leftValue = evaluateHand(left);
  const rightValue = evaluateHand(right);

  if (leftValue.categoryScore !== rightValue.categoryScore) {
    return leftValue.categoryScore - rightValue.categoryScore;
  }

  const length = Math.max(leftValue.tieBreakers.length, rightValue.tieBreakers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftValue.tieBreakers[index] ?? 0) - (rightValue.tieBreakers[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
