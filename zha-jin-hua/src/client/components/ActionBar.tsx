import { useRef, useState } from 'react';

import type { GameAction, LegalActions, PlayerViewPlayer } from '../../shared/types';
import { RaiseSheet } from './RaiseSheet';

interface ActionBarProps {
  player: PlayerViewPlayer;
  turnId: number;
  isTurn: boolean;
  actions: LegalActions;
  opponents: PlayerViewPlayer[];
  onAction(action: GameAction): void;
}

export function ActionBar({ player, turnId, isTurn, actions, opponents, onAction }: ActionBarProps) {
  const dockRef = useRef<HTMLElement>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const action = (next: GameAction) => {
    setRaiseOpen(false);
    setCompareOpen(false);
    onAction(next);
  };

  return (
    <section ref={dockRef} className="action-dock" aria-label="操作区">
      <div className="action-status">
        <span>{isTurn ? '轮到你了' : '等待对手行动'}</span>
        <small>{player.hasLooked ? '已看牌 · 下注按双倍计算' : '闷牌中 · 下注按基础计算'}</small>
      </div>
      <div className="action-buttons">
        {actions.canLook && (
          <button className="action-secondary" type="button" onClick={() => action({ type: 'look', playerId: player.id, turnId })}>
            看牌
          </button>
        )}
        <button
          className="action-primary"
          type="button"
          disabled={!isTurn || actions.callCost === null}
          onClick={() => action({ type: 'call', playerId: player.id, turnId })}
        >
          跟注 {actions.callCost ?? '—'}
        </button>
        <button type="button" disabled={!isTurn || actions.raiseAmounts.length === 0} onClick={() => setRaiseOpen(true)}>
          加注
        </button>
        <button type="button" disabled={!isTurn || actions.compareTargets.length === 0} onClick={() => setCompareOpen((open) => !open)}>
          比牌
        </button>
        <button className="action-danger" type="button" disabled={!isTurn || !actions.canFold} onClick={() => action({ type: 'fold', playerId: player.id, turnId })}>
          弃牌
        </button>
      </div>
      {compareOpen && (
        <div className="compare-popover" role="dialog" aria-label="选择比牌对象">
          <span>选择对手 · 支付 {actions.compareCost}</span>
          {opponents.filter((opponent) => actions.compareTargets.includes(opponent.id)).map((opponent) => (
            <button key={opponent.id} type="button" onClick={() => action({ type: 'compare', playerId: player.id, targetId: opponent.id, turnId })}>
              {opponent.name}
            </button>
          ))}
        </div>
      )}
      {raiseOpen && (
        <RaiseSheet
          anchor={dockRef.current}
          amounts={actions.raiseAmounts}
          multiplier={player.hasLooked ? 2 : 1}
          onChoose={(amount) => action({ type: 'raise', playerId: player.id, amount, turnId })}
          onClose={() => setRaiseOpen(false)}
        />
      )}
    </section>
  );
}
