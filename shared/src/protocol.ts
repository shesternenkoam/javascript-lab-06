import { z } from 'zod';
import { decodeBinary } from './codec.ts';
import { asEntityId, asSeq, asTick, type Snapshot } from './types.ts';

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Client message schemas
export const JoinMessageSchema = z.object({
  type: z.literal('join'),
  room: z.string().min(1).max(64),
  name: z.string().min(1).max(24),
});

export const InputMessageSchema = z.object({
  type: z.literal('input'),
  seq: z.number().int().nonnegative(),
  thrust: z.union([z.literal(0), z.literal(1)]),
  turn: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  fire: z.union([z.literal(0), z.literal(1)]),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  t: z.number(),
});

export const ConfigMessageSchema = z.object({
  type: z.literal('config'),
  codec: z.enum(['json', 'binary']).optional(),
  drop: z.number().min(0).max(1).optional(),
  lat: z.number().min(0).max(5000).optional(),
  jitter: z.number().min(0).max(5000).optional(),
});

export const ChatMessageSchema = z.object({
  type: z.literal('chat'),
  text: z.string().max(200),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  InputMessageSchema,
  PingMessageSchema,
  ConfigMessageSchema,
  ChatMessageSchema,
]);

export type JoinMessage = z.infer<typeof JoinMessageSchema>;
export type ClientInputMessage = z.infer<typeof InputMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;
export type ConfigMessage = z.infer<typeof ConfigMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server message schemas
export const WelcomeMessageSchema = z.object({
  type: z.literal('welcome'),
  id: z.number(),
  seed: z.number(),
  tickRate: z.number(),
  world: z.object({
    w: z.number(),
    h: z.number(),
  }),
  codec: z.enum(['json', 'binary']),
  net: z.unknown().optional(),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
  t: z.number(),
});

export const PlayerInfoSchema = z.object({
  id: z.number(),
  name: z.string(),
  score: z.number().optional().default(0),
});

export const PlayersMessageSchema = z.object({
  type: z.literal('players'),
  players: z.array(PlayerInfoSchema),
});

export const ServerConfigMessageSchema = z.object({
  type: z.literal('config'),
  codec: z.enum(['json', 'binary']),
  net: z.unknown().optional(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
});

export const ShipSnapshotSchema = z.object({
  kind: z.literal('ship').default('ship'),
  id: z.number(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  angle: z.number(),
  hp: z.number(),
  cooldown: z.number(),
  respawn: z.number(),
});

export const BulletSnapshotSchema = z.object({
  kind: z.literal('bullet').default('bullet'),
  id: z.number(),
  owner: z.number(),
  seq: z.number(),
  x: z.number(),
  y: z.number(),
});

export const AsteroidSnapshotSchema = z.object({
  kind: z.literal('asteroid').default('asteroid'),
  id: z.number(),
  x: z.number(),
  y: z.number(),
  radius: z.number(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  tick: z.number(),
  ack: z.number(),
  ships: z.array(ShipSnapshotSchema),
  bullets: z.array(BulletSnapshotSchema),
  asteroids: z.array(AsteroidSnapshotSchema),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  WelcomeMessageSchema,
  PongMessageSchema,
  PlayersMessageSchema,
  ServerConfigMessageSchema,
  ErrorMessageSchema,
  SnapshotMessageSchema,
]);

export type WelcomeMessage = z.infer<typeof WelcomeMessageSchema>;
export type PongMessage = z.infer<typeof PongMessageSchema>;
export type PlayersMessage = z.infer<typeof PlayersMessageSchema>;
export type ServerConfigMessage = z.infer<typeof ServerConfigMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;

export type ServerMessage =
  | WelcomeMessage
  | PongMessage
  | PlayersMessage
  | ServerConfigMessage
  | ErrorMessage
  | Snapshot;

// parseClientMessage: Result-style parsing that never throws
export function parseClientMessage(data: unknown): Result<ClientMessage> {
  if (typeof data === 'string') {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data);
    } catch {
      return err('Malformed JSON string');
    }
    const result = ClientMessageSchema.safeParse(parsedJson);
    if (!result.success) {
      return err(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
    return ok(result.data);
  }

  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    try {
      const decoded = decodeBinary(data);
      if (decoded.type === 'input') {
        return ok(decoded);
      }
      return err(`Unexpected binary message type from client: ${decoded.type}`);
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : 'Invalid binary frame');
    }
  }

  return err('Unsupported client message format');
}

// parseServerMessage: Result-style parsing for client
export function parseServerMessage(data: unknown): Result<ServerMessage> {
  if (typeof data === 'string') {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data);
    } catch {
      return err('Malformed JSON string');
    }
    const result = ServerMessageSchema.safeParse(parsedJson);
    if (!result.success) {
      return err(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
    if (result.data.type === 'snapshot') {
      const snap = result.data;
      const typedSnap: Snapshot = {
        type: 'snapshot',
        tick: asTick(snap.tick),
        ack: asSeq(snap.ack),
        ships: snap.ships.map((s) => ({
          kind: 'ship',
          id: asEntityId(s.id),
          x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle,
          hp: s.hp, cooldown: s.cooldown, respawn: s.respawn,
        })),
        bullets: snap.bullets.map((b) => ({
          kind: 'bullet',
          id: asEntityId(b.id),
          owner: asEntityId(b.owner),
          seq: asSeq(b.seq),
          x: b.x, y: b.y,
        })),
        asteroids: snap.asteroids.map((a) => ({
          kind: 'asteroid',
          id: asEntityId(a.id),
          x: a.x, y: a.y, radius: a.radius,
        })),
      };
      return ok(typedSnap);
    }
    return ok(result.data);
  }

  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    try {
      const decoded = decodeBinary(data);
      if (decoded.type === 'snapshot') {
        return ok(decoded);
      }
      return err(`Unexpected binary message type from server: ${decoded.type}`);
    } catch (e: unknown) {
      return err(e instanceof Error ? e.message : 'Invalid binary frame');
    }
  }

  return err('Unsupported server message format');
}

// Exhaustive check helper
export function assertExhaustive(value: never, message: string = 'Unhandled case'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
