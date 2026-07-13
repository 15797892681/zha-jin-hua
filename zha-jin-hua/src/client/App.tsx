import { useState } from 'react';

import { GameTable } from './components/GameTable';
import { HomeScreen } from './components/HomeScreen';
import { RulesDialog } from './components/RulesDialog';
import { useSoloGame } from './game/useSoloGame';
import { OnlineMode } from './online/OnlineMode';
import { createBrowserSocket, type SocketFactory } from './online/useOnlineGame';

type Screen = 'home' | 'solo' | 'online';

interface AppProps {
  socketFactory?: SocketFactory;
}

export function App({ socketFactory = createBrowserSocket }: AppProps) {
  const [screen, setScreen] = useState<Screen>('home');
  const [rulesOpen, setRulesOpen] = useState(false);
  const solo = useSoloGame();

  if (screen === 'solo') {
    return (
      <GameTable
        view={solo.view}
        viewerId={solo.humanId}
        onAction={solo.dispatch}
        onNextRound={solo.nextRound}
        onReset={solo.resetMatch}
        onExit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'online') {
    return <OnlineMode socketFactory={socketFactory} onExit={() => setScreen('home')} />;
  }

  return (
    <>
      <HomeScreen
        onSolo={() => setScreen('solo')}
        onOnline={() => setScreen('online')}
        onRules={() => setRulesOpen(true)}
      />
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
    </>
  );
}
