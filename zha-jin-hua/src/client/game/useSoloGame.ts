import { useCallback, useEffect, useMemo, useState } from 'react';

import { chooseAiAction, type AiStyle } from '../../ai/strategy';
import { applyAction, createGame } from '../../shared/game';
import type { GameAction, GamePlayerInput, GameState, PlayerGameView } from '../../shared/types';
import { toPlayerView } from '../../shared/visibility';

const HUMAN_ID = 'you';
const ANTE = 10;
const STARTING_CHIPS = 1000;

const PLAYERS: GamePlayerInput[] = [
  { id: HUMAN_ID, name: '你' },
  { id: 'bot-cautious', name: '青竹' },
  { id: 'bot-bold', name: '赤焰' },
  { id: 'bot-chaotic', name: '飞星' },
];

const AI_STYLES: Record<string, AiStyle> = {
  'bot-cautious': 'cautious',
  'bot-bold': 'bold',
  'bot-chaotic': 'chaotic',
};

function freshMatch(): GameState {
  return createGame({ players: PLAYERS, startingChips: STARTING_CHIPS, ante: ANTE });
}

function nextRound(previous: GameState): GameState {
  const human = previous.players.find((player) => player.id === HUMAN_ID);
  if (!human || human.chips < ANTE) {
    return freshMatch();
  }

  const players = previous.players.map((player) => ({
    id: player.id,
    name: player.name,
    chips: player.chips >= ANTE ? player.chips : STARTING_CHIPS,
  }));
  return createGame({ players, startingChips: STARTING_CHIPS, ante: ANTE });
}

export interface SoloController {
  view: PlayerGameView;
  humanId: string;
  dispatch(action: GameAction): void;
  nextRound(): void;
  resetMatch(): void;
}

export function useSoloGame(): SoloController {
  const [state, setState] = useState<GameState>(freshMatch);

  useEffect(() => {
    const currentId = state.currentPlayerId;
    if (state.status !== 'playing' || !currentId || currentId === HUMAN_ID) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setState((latest) => {
        if (latest.status !== 'playing' || latest.currentPlayerId !== currentId) {
          return latest;
        }
        const style = AI_STYLES[currentId];
        if (!style) {
          return latest;
        }
        return applyAction(latest, chooseAiAction(latest, currentId, style));
      });
    }, 480 + Math.round(Math.random() * 320));

    return () => window.clearTimeout(timer);
  }, [state]);

  const dispatch = useCallback((action: GameAction) => {
    if (action.playerId !== HUMAN_ID) {
      return;
    }
    setState((latest) => applyAction(latest, action));
  }, []);

  const startNextRound = useCallback(() => {
    setState((latest) => nextRound(latest));
  }, []);

  const resetMatch = useCallback(() => setState(freshMatch()), []);
  const view = useMemo(() => toPlayerView(state, HUMAN_ID), [state]);

  return {
    view,
    humanId: HUMAN_ID,
    dispatch,
    nextRound: startNextRound,
    resetMatch,
  };
}
