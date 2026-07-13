import { GameTable } from '../components/GameTable';
import { OnlineLobby } from '../components/OnlineLobby';
import { WaitingRoom } from '../components/WaitingRoom';
import type { SoundController } from '../game/useSound';
import { useOnlineGame, type SocketFactory } from './useOnlineGame';

interface OnlineModeProps {
  socketFactory: SocketFactory;
  onExit(): void;
  sound: SoundController;
}

export function OnlineMode({ socketFactory, onExit, sound }: OnlineModeProps) {
  const online = useOnlineGame(socketFactory);
  const leave = () => {
    online.leaveRoom();
    onExit();
  };

  if (online.phase === 'lobby' || !online.room || !online.playerId) {
    return (
      <OnlineLobby
        error={online.error}
        connection={online.connection}
        onCreate={online.createRoom}
        onJoin={online.joinRoom}
        onExit={leave}
      />
    );
  }

  if (online.phase === 'waiting' || !online.game) {
    return (
      <WaitingRoom
        room={online.room}
        playerId={online.playerId}
        connection={online.connection}
        error={online.error}
        onStart={online.startGame}
        onExit={leave}
      />
    );
  }

  return (
    <GameTable
      view={online.game}
      viewerId={online.playerId}
      onAction={online.dispatch}
      onNextRound={online.startGame}
      onReset={online.startGame}
      onExit={leave}
      connectionState={online.connection}
      modeLabel={`联网房间 ${online.room.code}`}
      soundEnabled={sound.enabled}
      onToggleSound={sound.toggle}
      onSound={sound.play}
    />
  );
}
