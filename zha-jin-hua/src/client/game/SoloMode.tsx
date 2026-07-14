import { GameTable } from '../components/GameTable';
import type { AiDecisionService } from './aiDecisionService';
import type { SoundController } from './useSound';
import { useSoloGame } from './useSoloGame';

interface SoloModeProps {
  decisionService?: AiDecisionService;
  sound: SoundController;
  onExit(): void;
}

export function SoloMode({ decisionService, sound, onExit }: SoloModeProps) {
  const solo = useSoloGame(decisionService);

  return (
    <GameTable
      view={solo.view}
      viewerId={solo.humanId}
      onAction={solo.dispatch}
      onNextRound={solo.nextRound}
      onReset={solo.resetMatch}
      onExit={onExit}
      soundEnabled={sound.enabled}
      onToggleSound={sound.toggle}
      onSound={sound.play}
    />
  );
}
