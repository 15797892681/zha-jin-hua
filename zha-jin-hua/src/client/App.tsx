import { useState } from 'react';

import { HomeScreen } from './components/HomeScreen';
import { RulesDialog } from './components/RulesDialog';
import type { AiDecisionService } from './game/aiDecisionService';
import { SoloMode } from './game/SoloMode';
import { useSound } from './game/useSound';
import { OnlineMode } from './online/OnlineMode';
import { createBrowserSocket, type SocketFactory } from './online/useOnlineGame';

type Screen = 'home' | 'solo' | 'online';

interface AppProps {
  socketFactory?: SocketFactory;
  soloDecisionService?: AiDecisionService;
}

export function App({ socketFactory = createBrowserSocket, soloDecisionService }: AppProps) {
  const [screen, setScreen] = useState<Screen>('home');
  const [rulesOpen, setRulesOpen] = useState(false);
  const sound = useSound();

  if (screen === 'solo') {
    return (
      <SoloMode
        decisionService={soloDecisionService}
        sound={sound}
        onExit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'online') {
    return <OnlineMode socketFactory={socketFactory} sound={sound} onExit={() => setScreen('home')} />;
  }

  return (
    <>
      <HomeScreen
        onSolo={() => setScreen('solo')}
        onOnline={() => setScreen('online')}
        onRules={() => setRulesOpen(true)}
        soundEnabled={sound.enabled}
        onToggleSound={sound.toggle}
      />
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
    </>
  );
}
