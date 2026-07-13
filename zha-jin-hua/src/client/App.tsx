import { useState } from 'react';

import { GameTable } from './components/GameTable';
import { HomeScreen } from './components/HomeScreen';
import { RulesDialog } from './components/RulesDialog';
import { useSoloGame } from './game/useSoloGame';

type Screen = 'home' | 'solo' | 'online-preview';

export function App() {
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

  if (screen === 'online-preview') {
    return (
      <main className="preview-screen">
        <p className="eyebrow">实时牌桌</p>
        <h1>联网房间</h1>
        <p>房间服务正在接入。单机牌桌已经可以完整游玩。</p>
        <button className="button button-primary" type="button" onClick={() => setScreen('home')}>
          返回首页
        </button>
      </main>
    );
  }

  return (
    <>
      <HomeScreen
        onSolo={() => setScreen('solo')}
        onOnline={() => setScreen('online-preview')}
        onRules={() => setRulesOpen(true)}
      />
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
    </>
  );
}
