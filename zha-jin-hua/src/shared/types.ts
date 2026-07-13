export const SUITS = ['S', 'H', 'D', 'C'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'straight'
  | 'flush'
  | 'straight-flush'
  | 'triple';

export interface HandValue {
  category: HandCategory;
  categoryScore: number;
  tieBreakers: number[];
}

export interface GamePlayerInput {
  id: string;
  name: string;
  chips?: number;
}

export interface GameConfig {
  players: GamePlayerInput[];
  startingChips: number;
  ante: number;
  random?: () => number;
  deck?: Card[];
}

export type PlayerStatus = 'active' | 'folded' | 'out';
export type GameStatus = 'playing' | 'finished';

export interface GamePlayer {
  id: string;
  name: string;
  chips: number;
  cards: Card[];
  hasLooked: boolean;
  status: PlayerStatus;
  roundContribution: number;
}

export type GameAction =
  | { type: 'look'; playerId: string; turnId: number }
  | { type: 'call'; playerId: string; turnId: number }
  | { type: 'raise'; playerId: string; amount: number; turnId: number }
  | { type: 'fold'; playerId: string; turnId: number }
  | { type: 'compare'; playerId: string; targetId: string; turnId: number };

export interface LastAction {
  type: GameAction['type'];
  playerId: string;
  amount?: number;
  targetId?: string;
  loserId?: string;
}

export interface LegalActions {
  canLook: boolean;
  callCost: number | null;
  raiseAmounts: number[];
  compareCost: number | null;
  compareTargets: string[];
  canFold: boolean;
}

export interface GameState {
  status: GameStatus;
  players: GamePlayer[];
  deck: Card[];
  pot: number;
  ante: number;
  baseBet: number;
  currentPlayerId: string | null;
  turnId: number;
  turnDeadline: number | null;
  actionCount: number;
  winnerIds: string[];
  lastAction: LastAction | null;
}

export interface PlayerViewPlayer extends Omit<GamePlayer, 'cards'> {
  cards: Array<Card | null>;
}

export interface PlayerGameView extends Omit<GameState, 'players' | 'deck'> {
  players: PlayerViewPlayer[];
  legalActions: LegalActions;
}

export type RoomStatus = 'waiting' | 'playing' | 'result';

export interface RoomPlayerSnapshot {
  id: string;
  nickname: string;
  chips: number;
  connected: boolean;
  isHost: boolean;
  disconnectDeadline: number | null;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  status: RoomStatus;
  players: RoomPlayerSnapshot[];
}
