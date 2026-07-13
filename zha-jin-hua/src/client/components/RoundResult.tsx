import { evaluateHand } from '../../shared/evaluate';
import type { PlayerGameView } from '../../shared/types';

const CATEGORY_NAME = {
  'high-card': '单张',
  pair: '对子',
  straight: '顺子',
  flush: '同花',
  'straight-flush': '同花顺',
  triple: '豹子',
} as const;

interface RoundResultProps {
  view: PlayerGameView;
  onNextRound(): void;
  onReset(): void;
}

export function RoundResult({ view, onNextRound, onReset }: RoundResultProps) {
  const winners = view.players.filter((player) => view.winnerIds.includes(player.id));
  const human = view.players.find((player) => player.name === '你');

  return (
    <div className="result-backdrop">
      <section className="result-dialog" role="dialog" aria-modal="true" aria-label="本局结算">
        <p className="eyebrow">本局落定</p>
        <h2>{winners.map((winner) => winner.name).join('、')} 胜出</h2>
        <p className="result-pot">赢得底池 <strong>{view.pot}</strong></p>
        <div className="showdown-list">
          {view.players.filter((player) => player.status !== 'folded').map((player) => {
            const visibleCards = player.cards.filter((card) => card !== null);
            return (
              <div key={player.id}>
                <span>{player.name}</span>
                <strong>{visibleCards.length === 3 ? CATEGORY_NAME[evaluateHand(visibleCards).category] : '暗牌'}</strong>
              </div>
            );
          })}
        </div>
        <button className="button button-primary result-next" type="button" onClick={onNextRound}>
          {human && human.chips < view.ante ? '重置筹码再来' : '下一局'}
        </button>
        <button className="text-button" type="button" onClick={onReset}>重新开局</button>
      </section>
    </div>
  );
}
