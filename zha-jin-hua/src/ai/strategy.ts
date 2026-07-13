import { evaluateHand } from '../shared/evaluate';
import { legalActions } from '../shared/game';
import type { GameAction, GameState, LegalActions } from '../shared/types';

export type AiStyle = 'cautious' | 'bold' | 'chaotic';

function lookAction(state: GameState, playerId: string): GameAction {
  return { type: 'look', playerId, turnId: state.turnId };
}

function foldAction(state: GameState, playerId: string): GameAction {
  return { type: 'fold', playerId, turnId: state.turnId };
}

function callAction(state: GameState, playerId: string): GameAction {
  return { type: 'call', playerId, turnId: state.turnId };
}

function raiseAction(state: GameState, playerId: string, amount: number): GameAction {
  return { type: 'raise', playerId, amount, turnId: state.turnId };
}

function compareAction(state: GameState, playerId: string, targetId: string): GameAction {
  return { type: 'compare', playerId, targetId, turnId: state.turnId };
}

function fallbackAction(state: GameState, playerId: string, actions: LegalActions): GameAction {
  if (actions.callCost !== null) {
    return callAction(state, playerId);
  }
  return foldAction(state, playerId);
}

function chooseChaotic(
  state: GameState,
  playerId: string,
  actions: LegalActions,
  randomValue: number,
): GameAction {
  const candidates: GameAction[] = [];
  if (actions.canLook) {
    candidates.push(lookAction(state, playerId));
  }
  if (actions.callCost !== null) {
    candidates.push(callAction(state, playerId));
  }
  for (const amount of actions.raiseAmounts) {
    candidates.push(raiseAction(state, playerId, amount));
  }
  for (const targetId of actions.compareTargets) {
    candidates.push(compareAction(state, playerId, targetId));
  }
  if (actions.canFold) {
    candidates.push(foldAction(state, playerId));
  }

  const index = Math.min(candidates.length - 1, Math.floor(randomValue * candidates.length));
  return candidates[index];
}

export function chooseAiAction(
  state: GameState,
  playerId: string,
  style: AiStyle,
  random: () => number = Math.random,
): GameAction {
  if (state.status !== 'playing' || state.currentPlayerId !== playerId) {
    throw new Error('AI_NOT_ACTING');
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.status !== 'active') {
    throw new Error('AI_NOT_ACTING');
  }

  const actions = legalActions(state, playerId);
  const randomValue = Math.min(0.999_999, Math.max(0, random()));

  if (
    state.actionCount >= state.players.length * 4
    && actions.compareTargets.length > 0
  ) {
    return compareAction(state, playerId, actions.compareTargets[0]);
  }

  if (style === 'chaotic') {
    return chooseChaotic(state, playerId, actions, randomValue);
  }

  if (!player.hasLooked) {
    if (style === 'cautious' || randomValue < 0.35) {
      return lookAction(state, playerId);
    }
    if (actions.callCost !== null) {
      return callAction(state, playerId);
    }
    return foldAction(state, playerId);
  }

  const strength = evaluateHand(player.cards).categoryScore;
  const callRatio = actions.callCost === null
    ? Number.POSITIVE_INFINITY
    : actions.callCost / Math.max(1, player.chips);
  const isLateRound = state.actionCount >= state.players.length * 2;

  if (style === 'bold') {
    if (strength >= 5 && actions.raiseAmounts.length > 0) {
      return raiseAction(state, playerId, actions.raiseAmounts.at(-1) as number);
    }
    if (strength >= 4 && actions.raiseAmounts.length > 0) {
      return raiseAction(state, playerId, actions.raiseAmounts[Math.floor(actions.raiseAmounts.length / 2)]);
    }
    if (strength >= 3 && isLateRound && actions.compareTargets.length > 0) {
      return compareAction(state, playerId, actions.compareTargets[0]);
    }
    if (strength >= 2 && actions.raiseAmounts.length > 0 && randomValue < 0.55) {
      return raiseAction(state, playerId, actions.raiseAmounts[0]);
    }
    if (callRatio <= 0.22) {
      return fallbackAction(state, playerId, actions);
    }
    return foldAction(state, playerId);
  }

  if (strength >= 4 && actions.raiseAmounts.length > 0 && randomValue < 0.4) {
    return raiseAction(state, playerId, actions.raiseAmounts[0]);
  }
  if (strength >= 2 && callRatio <= 0.12) {
    return fallbackAction(state, playerId, actions);
  }
  if (strength === 1 && callRatio <= 0.025 && randomValue > 0.7) {
    return fallbackAction(state, playerId, actions);
  }
  return foldAction(state, playerId);
}
