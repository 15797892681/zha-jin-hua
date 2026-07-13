import { createDeck, shuffleDeck } from './cards';
import { compareHands } from './evaluate';
import type {
  GameAction,
  GameConfig,
  GamePlayer,
  GameState,
  LastAction,
  LegalActions,
} from './types';

const RAISE_LEVELS = [10, 20, 50, 100, 200] as const;

const NO_ACTIONS: LegalActions = {
  canLook: false,
  callCost: null,
  raiseAmounts: [],
  compareCost: null,
  compareTargets: [],
  canFold: false,
};

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      cards: player.cards.map((card) => ({ ...card })),
    })),
    deck: state.deck.map((card) => ({ ...card })),
    winnerIds: [...state.winnerIds],
    lastAction: state.lastAction ? { ...state.lastAction } : null,
  };
}

function activePlayers(state: GameState): GamePlayer[] {
  return state.players.filter((player) => player.status === 'active');
}

function nextActivePlayerId(state: GameState, afterPlayerId: string): string {
  const start = state.players.findIndex((player) => player.id === afterPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(start + offset) % state.players.length];
    if (player.status === 'active') {
      return player.id;
    }
  }

  throw new Error('NO_ACTIVE_PLAYER');
}

function finishIfDecided(state: GameState): GameState {
  const remaining = activePlayers(state);
  if (remaining.length !== 1) {
    return state;
  }

  const winner = remaining[0];
  winner.chips += state.pot;
  state.status = 'finished';
  state.currentPlayerId = null;
  state.winnerIds = [winner.id];
  return state;
}

function pay(state: GameState, player: GamePlayer, amount: number): void {
  if (player.chips < amount) {
    throw new Error('INSUFFICIENT_CHIPS');
  }

  player.chips -= amount;
  player.roundContribution += amount;
  state.pot += amount;
}

function recordAndAdvance(state: GameState, lastAction: LastAction): GameState {
  state.lastAction = lastAction;
  state.actionCount += 1;
  state.turnId += 1;

  const settled = finishIfDecided(state);
  if (settled.status === 'playing') {
    settled.currentPlayerId = nextActivePlayerId(settled, lastAction.playerId);
  }
  return settled;
}

export function createGame(config: GameConfig): GameState {
  if (config.players.length < 2 || config.players.length > 6) {
    throw new Error('PLAYER_COUNT');
  }
  if (config.ante <= 0 || config.startingChips <= 0) {
    throw new Error('INVALID_STAKES');
  }
  if (new Set(config.players.map((player) => player.id)).size !== config.players.length) {
    throw new Error('DUPLICATE_PLAYER');
  }

  const sourceDeck = config.deck
    ? config.deck.map((card) => ({ ...card }))
    : shuffleDeck(createDeck(), config.random);
  const requiredCards = config.players.length * 3;
  if (sourceDeck.length < requiredCards) {
    throw new Error('DECK_TOO_SMALL');
  }

  const players = config.players.map((input, index): GamePlayer => {
    const chips = input.chips ?? config.startingChips;
    if (chips < config.ante) {
      throw new Error('INSUFFICIENT_ANTE');
    }
    return {
      id: input.id,
      name: input.name,
      chips: chips - config.ante,
      cards: sourceDeck.slice(index * 3, index * 3 + 3),
      hasLooked: false,
      status: 'active',
      roundContribution: config.ante,
    };
  });

  return {
    status: 'playing',
    players,
    deck: sourceDeck.slice(requiredCards),
    pot: config.ante * players.length,
    ante: config.ante,
    baseBet: config.ante,
    currentPlayerId: players[0].id,
    turnId: 1,
    actionCount: 0,
    winnerIds: [],
    lastAction: null,
  };
}

export function legalActions(state: GameState, playerId: string): LegalActions {
  if (state.status !== 'playing' || state.currentPlayerId !== playerId) {
    return { ...NO_ACTIONS, raiseAmounts: [], compareTargets: [] };
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.status !== 'active') {
    return { ...NO_ACTIONS, raiseAmounts: [], compareTargets: [] };
  }

  const multiplier = player.hasLooked ? 2 : 1;
  const rawCallCost = state.baseBet * multiplier;
  const callCost = player.chips >= rawCallCost ? rawCallCost : null;
  const raiseAmounts = RAISE_LEVELS.filter((amount) => (
    amount > state.baseBet && player.chips >= amount * multiplier
  ));
  const rawCompareCost = rawCallCost * 2;
  const compareCost = player.chips >= rawCompareCost ? rawCompareCost : null;
  const compareTargets = compareCost === null
    ? []
    : state.players
      .filter((candidate) => candidate.id !== playerId && candidate.status === 'active')
      .map((candidate) => candidate.id);

  return {
    canLook: !player.hasLooked,
    callCost,
    raiseAmounts,
    compareCost,
    compareTargets,
    canFold: true,
  };
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.status !== 'playing') {
    throw new Error('GAME_FINISHED');
  }
  if (action.turnId !== state.turnId) {
    throw new Error('STALE_TURN');
  }
  if (state.currentPlayerId !== action.playerId) {
    throw new Error('NOT_YOUR_TURN');
  }

  const next = cloneState(state);
  const player = next.players.find((candidate) => candidate.id === action.playerId);
  if (!player || player.status !== 'active') {
    throw new Error('PLAYER_INACTIVE');
  }
  const actions = legalActions(next, action.playerId);

  switch (action.type) {
    case 'look': {
      if (!actions.canLook) {
        throw new Error('ALREADY_LOOKED');
      }
      player.hasLooked = true;
      next.lastAction = { type: 'look', playerId: player.id };
      next.actionCount += 1;
      next.turnId += 1;
      return next;
    }
    case 'call': {
      if (actions.callCost === null) {
        throw new Error('INSUFFICIENT_CHIPS');
      }
      pay(next, player, actions.callCost);
      return recordAndAdvance(next, { type: 'call', playerId: player.id, amount: actions.callCost });
    }
    case 'raise': {
      if (!actions.raiseAmounts.includes(action.amount)) {
        throw new Error('ILLEGAL_RAISE');
      }
      const cost = action.amount * (player.hasLooked ? 2 : 1);
      pay(next, player, cost);
      next.baseBet = action.amount;
      return recordAndAdvance(next, { type: 'raise', playerId: player.id, amount: cost });
    }
    case 'fold': {
      player.status = 'folded';
      return recordAndAdvance(next, { type: 'fold', playerId: player.id });
    }
    case 'compare': {
      if (!actions.compareTargets.includes(action.targetId) || actions.compareCost === null) {
        throw new Error('ILLEGAL_COMPARE');
      }
      const target = next.players.find((candidate) => candidate.id === action.targetId);
      if (!target) {
        throw new Error('ILLEGAL_COMPARE');
      }
      pay(next, player, actions.compareCost);
      const initiatorWins = compareHands(player.cards, target.cards) > 0;
      const loser = initiatorWins ? target : player;
      loser.status = 'out';
      return recordAndAdvance(next, {
        type: 'compare',
        playerId: player.id,
        targetId: target.id,
        amount: actions.compareCost,
        loserId: loser.id,
      });
    }
  }
}
