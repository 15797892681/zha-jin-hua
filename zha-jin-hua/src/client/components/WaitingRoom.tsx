import { useState } from 'react';

import type { RoomSnapshot } from '../../shared/types';

interface WaitingRoomProps {
  room: RoomSnapshot;
  playerId: string;
  connection: 'online' | 'reconnecting' | 'offline';
  error: string | null;
  onStart(): Promise<void>;
  onExit(): void;
}

export function WaitingRoom({ room, playerId, connection, error, onStart, onExit }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === playerId;
  const canStart = isHost && room.players.filter((player) => player.connected).length >= 2 && connection === 'online';

  const copyCode = async () => {
    await navigator.clipboard?.writeText(room.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main className="waiting-screen">
      <header className="online-header">
        <button className="round-icon-button" type="button" onClick={onExit} aria-label="退出房间">←</button>
        <span className={`connection-pill is-${connection}`}>{connection === 'online' ? '房间在线' : '正在重连'}</span>
      </header>
      <section className="waiting-content">
        <p className="eyebrow">等待入座</p>
        <h1>分享房间码</h1>
        <button className="room-code-display" type="button" aria-label="复制房间码" onClick={copyCode}>
          <strong>{room.code}</strong>
          <small>{copied ? '已复制' : '点击复制'}</small>
        </button>
        <div className="waiting-seats" aria-label="房间玩家">
          {Array.from({ length: 6 }, (_, index) => {
            const player = room.players[index];
            return player ? (
              <article className={`waiting-seat ${player.connected ? '' : 'is-offline'}`} key={player.id}>
                <span className="waiting-avatar">{player.nickname.slice(0, 1)}</span>
                <strong>{player.nickname}</strong>
                <small>{player.isHost ? '房主' : player.connected ? '已入座' : '重连中'}</small>
              </article>
            ) : (
              <article className="waiting-seat is-empty" key={`empty-${index}`}>
                <span className="waiting-avatar">+</span>
                <strong>空位</strong>
                <small>等待玩家</small>
              </article>
            );
          })}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {isHost ? (
          <button className="lobby-primary waiting-start" type="button" disabled={!canStart} onClick={onStart}>开始游戏</button>
        ) : (
          <p className="waiting-note">等待房主开始游戏</p>
        )}
        <p className="waiting-note">至少 2 人，最多 6 人 · 每人 1000 虚拟筹码</p>
      </section>
    </main>
  );
}
