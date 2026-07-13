import type { GameAction, PlayerGameView } from '../../shared/types';
import { ActionBar } from './ActionBar';
import { PlayerSeat } from './PlayerSeat';
import { RoundResult } from './RoundResult';

interface GameTableProps {
  view: PlayerGameView;
  viewerId: string;
  onAction(action: GameAction): void;
  onNextRound(): void;
  onReset(): void;
  onExit(): void;
  connectionState?: 'online' | 'reconnecting' | 'offline';
}

export function GameTable({
  view,
  viewerId,
  onAction,
  onNextRound,
  onReset,
  onExit,
  connectionState = 'online',
}: GameTableProps) {
  const viewer = view.players.find((player) => player.id === viewerId);
  if (!viewer) {
    throw new Error('找不到当前玩家');
  }

  const isTurn = view.status === 'playing' && view.currentPlayerId === viewerId && connectionState === 'online';

  return (
    <main className="game-screen">
      <header className="table-header">
        <button className="round-icon-button" type="button" onClick={onExit} aria-label="退出牌桌">←</button>
        <div>
          <span className="table-brand">金局</span>
          <small>单机对战</small>
        </div>
        <span className={`connection-pill is-${connectionState}`}>{connectionState === 'online' ? '牌桌顺畅' : '正在重连'}</span>
      </header>
      <section className="felt-table" aria-label="炸金花牌桌">
        <div className="table-ring" aria-hidden="true" />
        <div className="pot-display">
          <span>底池</span>
          <strong>{view.pot}</strong>
          <small>基础注 {view.baseBet}</small>
        </div>
        {view.lastAction && (
          <p className="last-action" aria-live="polite">
            {view.players.find((player) => player.id === view.lastAction?.playerId)?.name}
            {view.lastAction.type === 'look' && ' 已看牌'}
            {view.lastAction.type === 'call' && ` 跟注 ${view.lastAction.amount}`}
            {view.lastAction.type === 'raise' && ` 加注 ${view.lastAction.amount}`}
            {view.lastAction.type === 'fold' && ' 选择弃牌'}
            {view.lastAction.type === 'compare' && ' 发起比牌'}
          </p>
        )}
        {view.players.map((player, index) => (
          <PlayerSeat
            key={player.id}
            player={player}
            index={index}
            isSelf={player.id === viewerId}
            isCurrent={view.currentPlayerId === player.id}
            gameFinished={view.status === 'finished'}
          />
        ))}
      </section>
      {view.status === 'playing' && (
        <ActionBar
          player={viewer}
          turnId={view.turnId}
          isTurn={isTurn}
          actions={view.legalActions}
          opponents={view.players.filter((player) => player.id !== viewerId)}
          onAction={onAction}
        />
      )}
      {view.status === 'finished' && <RoundResult view={view} onNextRound={onNextRound} onReset={onReset} />}
    </main>
  );
}
