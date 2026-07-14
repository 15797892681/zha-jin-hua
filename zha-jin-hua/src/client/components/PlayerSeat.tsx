import type { PlayerViewPlayer } from '../../shared/types';
import { PlayingCard } from './PlayingCard';

interface PlayerSeatProps {
  player: PlayerViewPlayer;
  index: number;
  isSelf: boolean;
  isCurrent: boolean;
  gameFinished: boolean;
  isThinking?: boolean;
  dialogue?: string;
}

const STATUS_LABEL = {
  active: '在局',
  folded: '已弃牌',
  out: '比牌出局',
} as const;

export function PlayerSeat({
  player,
  index,
  isSelf,
  isCurrent,
  gameFinished,
  isThinking = false,
  dialogue,
}: PlayerSeatProps) {
  const reveal = (isSelf && player.hasLooked) || (gameFinished && player.status !== 'folded');

  return (
    <article
      className={`player-seat seat-${index} ${isSelf ? 'is-self' : ''} ${isCurrent ? 'is-current' : ''} is-${player.status}`}
      aria-label={`${player.name}，${STATUS_LABEL[player.status]}，${player.chips} 筹码`}
    >
      {(isThinking || dialogue) && (
        <p className={`ai-speech ${isThinking ? 'is-thinking' : ''}`} aria-live="polite">
          {isThinking ? '正在思考…' : dialogue}
        </p>
      )}
      <div className="seat-avatar" aria-hidden="true">{player.name.slice(0, 1)}</div>
      <div className="seat-copy">
        <div className="seat-name-row">
          <strong>{player.name}</strong>
          {isCurrent && <span className="turn-chip">行动中</span>}
        </div>
        <span className="chip-count"><i aria-hidden="true" />{player.chips}</span>
        {player.status !== 'active' && <span className="seat-status">{STATUS_LABEL[player.status]}</span>}
      </div>
      <div className="seat-cards" aria-label={`${player.name}的手牌`}>
        {player.cards.map((card, cardIndex) => (
          <PlayingCard
            key={cardIndex}
            card={card}
            faceUp={reveal}
            isOwn={isSelf}
            delay={cardIndex * 90 + index * 60}
          />
        ))}
      </div>
    </article>
  );
}
