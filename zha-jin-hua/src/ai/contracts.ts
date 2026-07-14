import { z } from 'zod';

import type { GameAction, LegalActions } from '../shared/types';

export const AI_STYLES = ['cautious', 'bold', 'chaotic'] as const;
export type AiStyle = (typeof AI_STYLES)[number];

const idSchema = z.string().min(1).max(64);
const amountSchema = z.number().int().nonnegative().finite();
const cardSchema = z.object({
  suit: z.enum(['S', 'H', 'D', 'C']),
  rank: z.enum(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']),
}).strict();

export const publicMemoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'), actorId: idSchema,
    action: z.enum(['look', 'call', 'raise', 'fold', 'compare']),
    amount: amountSchema.optional(), targetId: idSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('dialogue'), actorId: idSchema, text: z.string().min(1).max(40),
  }).strict(),
]);
export type PublicMemoryEntry = z.infer<typeof publicMemoryEntrySchema>;

const legalActionsSchema = z.object({
  canLook: z.boolean(),
  callCost: amountSchema.nullable(),
  raiseAmounts: z.array(amountSchema).max(5),
  compareCost: amountSchema.nullable(),
  compareTargets: z.array(idSchema).max(5),
  canFold: z.boolean(),
}).strict();
export type AiLegalActions = z.infer<typeof legalActionsSchema>;

export const aiDecisionRequestSchema = z.object({
  requestId: idSchema,
  turnId: z.number().int().positive(),
  playerId: idSchema,
  style: z.enum(AI_STYLES),
  self: z.object({
    cards: z.array(cardSchema).length(3).nullable(),
    chips: amountSchema,
    hasLooked: z.boolean(),
    roundContribution: amountSchema,
  }).strict(),
  table: z.object({
    pot: amountSchema,
    ante: amountSchema,
    baseBet: amountSchema,
    actionCount: amountSchema,
    players: z.array(z.object({
      id: idSchema, name: z.string().min(1).max(32), chips: amountSchema,
      status: z.enum(['active', 'folded', 'out']), hasLooked: z.boolean(),
      roundContribution: amountSchema,
    }).strict()).min(2).max(6),
  }).strict(),
  legalActions: legalActionsSchema,
  memory: z.array(publicMemoryEntrySchema).max(8),
}).strict();
export type AiDecisionRequest = z.infer<typeof aiDecisionRequestSchema>;

export const aiActionIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look') }).strict(),
  z.object({ type: z.literal('call') }).strict(),
  z.object({ type: z.literal('raise'), amount: amountSchema }).strict(),
  z.object({ type: z.literal('fold') }).strict(),
  z.object({ type: z.literal('compare'), targetId: idSchema }).strict(),
]);
export type AiActionIntent = z.infer<typeof aiActionIntentSchema>;

export const deepSeekDecisionSchema = z.object({
  action: aiActionIntentSchema,
  dialogue: z.string().min(1).max(40),
}).strict();
export type DeepSeekDecision = z.infer<typeof deepSeekDecisionSchema>;

const gameActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look'), playerId: idSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('call'), playerId: idSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('raise'), playerId: idSchema, amount: amountSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('fold'), playerId: idSchema, turnId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('compare'), playerId: idSchema, targetId: idSchema, turnId: z.number().int().positive() }).strict(),
]);

export const aiDecisionResponseSchema = z.object({
  requestId: idSchema, turnId: z.number().int().positive(), playerId: idSchema,
  action: gameActionSchema, dialogue: z.string().min(1).max(40),
}).strict();
export type AiDecisionResponse = z.infer<typeof aiDecisionResponseSchema>;

export function isLegalIntent(intent: AiActionIntent, legal: AiLegalActions | LegalActions): boolean {
  switch (intent.type) {
    case 'look': return legal.canLook;
    case 'call': return legal.callCost !== null;
    case 'raise': return legal.raiseAmounts.includes(intent.amount);
    case 'fold': return legal.canFold;
    case 'compare': return legal.compareCost !== null && legal.compareTargets.includes(intent.targetId);
  }
}

export function intentToGameAction(intent: AiActionIntent, request: AiDecisionRequest): GameAction {
  return { ...intent, playerId: request.playerId, turnId: request.turnId } as GameAction;
}
