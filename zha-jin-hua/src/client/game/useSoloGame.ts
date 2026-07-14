import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AiStyle, PublicMemoryEntry } from '../../ai/contracts';
import { actionToMemory, appendPublicMemory } from '../../ai/context';
import { applyAction, createGame } from '../../shared/game';
import type { GameAction, GamePlayerInput, GameState, PlayerGameView } from '../../shared/types';
import { toPlayerView } from '../../shared/visibility';
import {
  browserAiDecisionService,
  type AiDecisionService,
} from './aiDecisionService';

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
  aiThinkingPlayerId: string | null;
  aiDialogueByPlayerId: Record<string, string>;
  aiNotice: string | null;
  dispatch(action: GameAction): void;
  nextRound(): void;
  resetMatch(): void;
}

interface SoloMatchState {
  game: GameState;
  memory: PublicMemoryEntry[];
  acceptedDecision: {
    turnId: number;
    playerId: string;
    dialogue: string;
    source: 'deepseek' | 'rule';
  } | null;
}

export function useSoloGame(
  decisionService: AiDecisionService = browserAiDecisionService,
): SoloController {
  const [match, setMatch] = useState<SoloMatchState>(() => ({
    game: freshMatch(),
    memory: [],
    acceptedDecision: null,
  }));
  const [aiThinkingPlayerId, setAiThinkingPlayerId] = useState<string | null>(null);
  const [aiDialogueByPlayerId, setAiDialogueByPlayerId] = useState<Record<string, string>>({});
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const generationRef = useRef(0);
  const noticeShownRef = useRef(false);
  const dialogueTimersRef = useRef(new Map<string, number>());
  const state = match.game;

  const clearDialogueTimers = useCallback(() => {
    dialogueTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    dialogueTimersRef.current.clear();
  }, []);

  const showDialogue = useCallback((playerId: string, text: string) => {
    const oldTimer = dialogueTimersRef.current.get(playerId);
    if (oldTimer !== undefined) {
      window.clearTimeout(oldTimer);
    }

    setAiDialogueByPlayerId((current) => ({ ...current, [playerId]: text }));
    const timer = window.setTimeout(() => {
      setAiDialogueByPlayerId((current) => {
        const next = { ...current };
        delete next[playerId];
        return next;
      });
      dialogueTimersRef.current.delete(playerId);
    }, 3500);
    dialogueTimersRef.current.set(playerId, timer);
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    clearDialogueTimers();
  }, [clearDialogueTimers]);

  useEffect(() => {
    const accepted = match.acceptedDecision;
    if (!accepted) {
      return;
    }

    showDialogue(accepted.playerId, accepted.dialogue);
    if (accepted.source === 'rule' && !noticeShownRef.current) {
      noticeShownRef.current = true;
      setAiNotice('AI 暂时走神，已由本地策略接管');
    }
  }, [match.acceptedDecision, showDialogue]);

  useEffect(() => {
    const currentId = state.currentPlayerId;
    if (state.status !== 'playing' || !currentId || currentId === HUMAN_ID) {
      return undefined;
    }

    const style = AI_STYLES[currentId];
    if (!style) {
      return undefined;
    }

    const controller = new AbortController();
    const generation = generationRef.current;
    const timer = window.setTimeout(async () => {
      setAiThinkingPlayerId(currentId);
      try {
        const result = await decisionService.decide(
          state,
          currentId,
          style,
          match.memory,
          controller.signal,
        );
        if (controller.signal.aborted || generationRef.current !== generation) {
          return;
        }

        setMatch((latest) => {
          if (
            latest.game.status !== 'playing'
            || latest.game.currentPlayerId !== currentId
            || latest.game.turnId !== state.turnId
          ) {
            return latest;
          }

          const nextGame = applyAction(latest.game, result.action);
          let memory = appendPublicMemory(latest.memory, actionToMemory(result.action));
          memory = appendPublicMemory(memory, {
            kind: 'dialogue',
            actorId: currentId,
            text: result.dialogue,
          });
          return {
            game: nextGame,
            memory,
            acceptedDecision: {
              turnId: state.turnId,
              playerId: currentId,
              dialogue: result.dialogue,
              source: result.source,
            },
          };
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          throw error;
        }
      } finally {
        if (generationRef.current === generation) {
          setAiThinkingPlayerId(null);
        }
      }
    }, 480 + Math.round(Math.random() * 320));

    return () => {
      window.clearTimeout(timer);
      controller.abort(new DOMException('stale turn', 'AbortError'));
    };
  }, [decisionService, match.memory, state]);

  const dispatch = useCallback((action: GameAction) => {
    if (action.playerId !== HUMAN_ID) {
      return;
    }
    setMatch((latest) => ({
      game: applyAction(latest.game, action),
      memory: appendPublicMemory(latest.memory, actionToMemory(action)),
      acceptedDecision: null,
    }));
  }, []);

  const startNextRound = useCallback(() => {
    generationRef.current += 1;
    clearDialogueTimers();
    setMatch((latest) => ({
      game: nextRound(latest.game),
      memory: latest.memory,
      acceptedDecision: null,
    }));
    setAiThinkingPlayerId(null);
    setAiDialogueByPlayerId({});
  }, [clearDialogueTimers]);

  const resetMatch = useCallback(() => {
    generationRef.current += 1;
    clearDialogueTimers();
    noticeShownRef.current = false;
    setMatch({ game: freshMatch(), memory: [], acceptedDecision: null });
    setAiThinkingPlayerId(null);
    setAiDialogueByPlayerId({});
    setAiNotice(null);
  }, [clearDialogueTimers]);
  const view = useMemo(() => toPlayerView(state, HUMAN_ID), [state]);

  return {
    view,
    humanId: HUMAN_ID,
    aiThinkingPlayerId,
    aiDialogueByPlayerId,
    aiNotice,
    dispatch,
    nextRound: startNextRound,
    resetMatch,
  };
}
