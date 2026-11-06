import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { EntityId, PlayerInput, Seq } from 'shared';
import { createMatchLogStream, type MatchLogStream } from './log/matchlog.ts';
import { Match } from './match.ts';
import type { LinkSim } from './netsim.ts';

export interface Player {
  id: EntityId;
  name: string;
  socket: WebSocket;
  link: LinkSim;
  codec: 'json' | 'binary';
  queue: PlayerInput[];
  lastSeq: number;
  ack: number | Seq;
  bytesIn: number;
  bytesOut: number;
  sendJson(msg: unknown): void;
  sendRaw(data: string | Uint8Array): void;
}

export interface RoomEvents {
  join: [player: Player];
  leave: [player: Player];
  empty: [];
}

export class Room extends EventEmitter {
  readonly id: string;
  readonly players: Map<EntityId | number, Player>;
  readonly logger: MatchLogStream;
  readonly match: Match;

  constructor(id: string) {
    super();
    this.id = id;
    this.players = new Map();
    this.logger = createMatchLogStream(id);
    this.logger.pipeToFile();
    this.match = new Match(this);
  }
}

class RoomManager {
  private readonly rooms: Map<string, Room> = new Map();

  create(id: string): Room {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const room = new Room(id);
    this.rooms.set(id, room);

    room.logger.write({ event: 'room_created', roomId: id });

    room.on('join', (player: Player) => {
      room.logger.write({ event: 'player_joined', player: player.name });
    });

    room.once('empty', () => {
      room.match.stop();
      room.logger.write({ event: 'room_empty_destroyed' });
      room.logger.close();
      this.rooms.delete(id);
    });

    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  stats(): Record<string, unknown>[] {
    return Array.from(this.rooms.values()).map((room) => room.match.summary());
  }

  list(): Array<{ id: string; name: string; players: number }> {
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      name: room.id,
      players: room.players.size,
    }));
  }
}

export const roomManager: RoomManager = new RoomManager();
