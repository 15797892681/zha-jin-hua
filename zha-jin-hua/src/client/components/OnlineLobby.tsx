import { useState } from 'react';

interface OnlineLobbyProps {
  error: string | null;
  connection: 'online' | 'reconnecting' | 'offline';
  onCreate(nickname: string): Promise<void>;
  onJoin(nickname: string, roomCode: string): Promise<void>;
  onExit(): void;
}

export function OnlineLobby({ error, connection, onCreate, onJoin, onExit }: OnlineLobbyProps) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const validNickname = Array.from(nickname.trim()).length >= 1 && Array.from(nickname.trim()).length <= 12;
  const validCode = /^[A-Z2-9]{6}$/.test(roomCode.trim().toUpperCase());

  const submit = async (operation: () => Promise<void>) => {
    setBusy(true);
    await operation();
    setBusy(false);
  };

  return (
    <main className="online-screen">
      <header className="online-header">
        <button className="round-icon-button" type="button" onClick={onExit} aria-label="返回首页">←</button>
        <span className={`connection-pill is-${connection}`}>{connection === 'online' ? '已连接' : '连接中'}</span>
      </header>
      <section className="lobby-panel" aria-labelledby="online-title">
        <p className="eyebrow">与好友同桌</p>
        <h1 id="online-title">联网房间</h1>
        <p className="lobby-intro">无需注册。输入昵称创建牌桌，或凭六位房间码加入。</p>
        <label className="field-label">
          <span>昵称</span>
          <input value={nickname} maxLength={12} autoComplete="nickname" placeholder="1～12 个字符" onChange={(event) => setNickname(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="lobby-primary" type="button" disabled={!validNickname || busy || connection !== 'online'} onClick={() => submit(() => onCreate(nickname.trim()))}>
          创建房间
        </button>
        <div className="lobby-divider"><span>或加入已有房间</span></div>
        <label className="field-label room-code-field">
          <span>房间码</span>
          <input value={roomCode} maxLength={6} autoCapitalize="characters" placeholder="例如 A7K9Q2" onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
        </label>
        <button className="lobby-secondary" type="button" disabled={!validNickname || !validCode || busy || connection !== 'online'} onClick={() => submit(() => onJoin(nickname.trim(), roomCode.trim()))}>
          加入房间
        </button>
      </section>
    </main>
  );
}
