import type { Card } from '../../shared/types';

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

interface PlayingCardProps {
  card: Card | null;
  faceUp: boolean;
  isOwn?: boolean;
  delay?: number;
}

export function PlayingCard({ card, faceUp, isOwn = false, delay = 0 }: PlayingCardProps) {
  const revealed = faceUp && card !== null;
  const label = revealed
    ? `${isOwn ? '自己的牌' : '亮出的牌'}：${card.rank}${SUIT_SYMBOL[card.suit]}`
    : `${isOwn ? '自己的' : '对手'}暗牌`;

  return (
    <div
      className={`playing-card ${revealed ? 'is-face-up' : 'is-face-down'} ${card && (card.suit === 'H' || card.suit === 'D') ? 'is-red' : ''}`}
      aria-label={label}
      style={{ '--deal-delay': `${delay}ms` } as React.CSSProperties}
    >
      {revealed ? (
        <>
          <span className="card-rank">{card.rank}</span>
          <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
          <span className="card-watermark" aria-hidden="true">{SUIT_SYMBOL[card.suit]}</span>
        </>
      ) : (
        <span className="card-back-mark" aria-hidden="true">金</span>
      )}
    </div>
  );
}
