import { expect, it } from 'vitest';

import { actionToMemory, appendPublicMemory } from '../src/ai/context';
import { chooseAiAction, type AiStyle } from '../src/ai/strategy';
import type { PublicMemoryEntry } from '../src/ai/contracts';
import { applyAction, createGame, legalActions } from '../src/shared/game';
import type { GameAction, GamePlayerInput, GameState } from '../src/shared/types';

const HUMAN_ID = 'you';
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

function seededRandom(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4_294_967_296;
  };
}

function blindRaiseAction(state: GameState): GameAction {
  const actions = legalActions(state, HUMAN_ID);
  if (actions.raiseAmounts.length > 0) {
    return {
      type: 'raise',
      playerId: HUMAN_ID,
      amount: actions.raiseAmounts[0],
      turnId: state.turnId,
    };
  }
  if (actions.compareTargets.length > 0) {
    return {
      type: 'compare',
      playerId: HUMAN_ID,
      targetId: actions.compareTargets[0],
      turnId: state.turnId,
    };
  }
  if (actions.callCost !== null) {
    return { type: 'call', playerId: HUMAN_ID, turnId: state.turnId };
  }
  return { type: 'fold', playerId: HUMAN_ID, turnId: state.turnId };
}

interface GameResult {
  humanWon: boolean;
  humanChips: number;
}

function playBlindRaiseGame(seed: number): GameResult {
  const random = seededRandom(seed);
  let state = createGame({ players: PLAYERS, startingChips: 1000, ante: 10, random });
  let memory: PublicMemoryEntry[] = [];
  let actionLimit = 100;

  while (state.status === 'playing' && actionLimit > 0) {
    actionLimit -= 1;
    const playerId = state.currentPlayerId;
    if (!playerId) throw new Error('Playing game has no current player');
    let action: GameAction;
    if (playerId === HUMAN_ID) {
      action = blindRaiseAction(state);
    } else {
      const style = AI_STYLES[playerId];
      if (!style) throw new Error(`Missing AI style for ${playerId}`);
      action = chooseAiAction(state, playerId, style, random, memory);
    }
    state = applyAction(state, action);
    memory = appendPublicMemory(memory, actionToMemory(action));
    if (playerId !== HUMAN_ID) {
      memory = appendPublicMemory(memory, {
        kind: 'dialogue',
        actorId: playerId,
        text: '继续。',
      });
    }
  }

  expect(actionLimit).toBeGreaterThan(0);
  return {
    humanWon: state.winnerIds.includes(HUMAN_ID),
    humanChips: state.players.find((player) => player.id === HUMAN_ID)?.chips ?? 0,
  };
}

it('keeps mechanical blind raising below the expert-mode win ceiling', () => {
  const games = 10_000;
  let wins = 0;
  let endingChips = 0;
  for (let seed = 1; seed <= games; seed += 1) {
    const result = playBlindRaiseGame(seed);
    if (result.humanWon) wins += 1;
    endingChips += result.humanChips;
  }

  const winRate = wins / games;
  const averageEndingChips = endingChips / games;
  expect(
    winRate,
    `blind-raise win rate: ${winRate}; average ending chips: ${averageEndingChips}`,
  ).toBeLessThanOrEqual(0.26);
  expect(
    averageEndingChips,
    `blind-raise win rate: ${winRate}; average ending chips: ${averageEndingChips}`,
  ).toBeLessThan(1000);
});
