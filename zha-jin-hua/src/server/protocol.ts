import { z } from 'zod';

export const nicknameSchema = z.string().trim().min(1).max(12);
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);

export const createRoomSchema = z.object({ nickname: nicknameSchema }).strict();
export const joinRoomSchema = z.object({ nickname: nicknameSchema, roomCode: roomCodeSchema }).strict();
export const resumeSchema = z.object({ sessionToken: z.string().min(16).max(256) }).strict();
export const emptySchema = z.object({}).strict();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('look'), turnId: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('call'), turnId: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('raise'), amount: z.number().int().positive(), turnId: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('fold'), turnId: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('compare'), targetId: z.string().min(1), turnId: z.number().int().nonnegative() }).strict(),
]);

export type ClientAction = z.infer<typeof actionSchema>;
