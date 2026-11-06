import { PROTOCOL_VERSION } from './constants.ts';
import { parseClientMessage, parseServerMessage } from './protocol.ts';
import {
  asEntityId, asSeq, asTick,
  type EntityId, type Seq, type Tick, type World, type Snapshot, type ShipSnapshot,
  type BulletSnapshot, type AsteroidSnapshot, type PlayerInput, type BinaryFlag, type TurnDirection,
  type InputMessage,
} from './types.ts';

export const MSG_INPUT: number = 1;
export const MSG_SNAPSHOT: number = 2;

const LE: boolean = true;
const ANGLE_SCALE: number = 10000;
export const SNAPSHOT_ACK_OFFSET: number = 6;
const HEADER: number = 15;
const SHIP_BYTES: number = 25;
const BULLET_BYTES: number = 20;
const ASTEROID_BYTES: number = 13;

export type NetworkMessage = InputMessage | Snapshot;

export interface Codec {
  readonly name: string;
  encodeInput(input: PlayerInput): string | Uint8Array;
  encodeSnapshot(world: World, ack?: number | Seq): string | Uint8Array;
}

export const jsonCodec: Codec = {
  name: 'json',
  encodeInput(input: PlayerInput): string {
    return JSON.stringify({ type: 'input', seq: input.seq, thrust: input.thrust, turn: input.turn, fire: input.fire });
  },
  encodeSnapshot(world: World, ack: number | Seq = 0): string {
    const ships: ShipSnapshot[] = world.ships.map((s) => ({
      kind: 'ship',
      id: s.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, hp: s.hp, cooldown: s.cooldown, respawn: s.respawn,
    }));
    const bullets: BulletSnapshot[] = world.bullets.map((b) => ({
      kind: 'bullet', id: b.id, owner: b.owner, seq: b.seq, x: b.x, y: b.y,
    }));
    const asteroids: AsteroidSnapshot[] = world.asteroids.map((a) => ({
      kind: 'asteroid', id: a.id, x: a.x, y: a.y, radius: a.radius,
    }));
    return JSON.stringify({
      type: 'snapshot', tick: world.tick, ack,
      ships, bullets, asteroids,
    });
  },
};

function viewOf(data: ArrayBuffer | Uint8Array | ArrayBufferView): DataView {
  if (data instanceof ArrayBuffer) return new DataView(data);
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

export interface BinaryCodec extends Codec {
  readonly name: 'binary';
  encodeInput(input: PlayerInput): Uint8Array;
  encodeSnapshot(world: World, ack?: number | Seq): Uint8Array;
}

export const binaryCodec: BinaryCodec = {
  name: 'binary',

  encodeInput(input: PlayerInput): Uint8Array {
    const buf = new ArrayBuffer(8);
    const v = new DataView(buf);
    v.setUint8(0, PROTOCOL_VERSION);
    v.setUint8(1, MSG_INPUT);
    v.setUint32(2, input.seq, LE);
    v.setUint8(6, (input.thrust ? 1 : 0) | (input.fire ? 2 : 0));
    v.setInt8(7, input.turn);
    return new Uint8Array(buf);
  },

  encodeSnapshot(world: World, ack: number | Seq = 0): Uint8Array {
    const { ships, bullets, asteroids } = world;
    const size = HEADER + ships.length * SHIP_BYTES + bullets.length * BULLET_BYTES + asteroids.length * ASTEROID_BYTES;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    v.setUint8(0, PROTOCOL_VERSION);
    v.setUint8(1, MSG_SNAPSHOT);
    v.setUint32(2, world.tick, LE);
    v.setUint32(SNAPSHOT_ACK_OFFSET, ack, LE);
    v.setUint8(10, ships.length);
    v.setUint16(11, bullets.length, LE);
    v.setUint16(13, asteroids.length, LE);
    let o = HEADER;
    for (const s of ships) {
      v.setUint32(o, s.id, LE);
      v.setFloat32(o + 4, s.x, LE);
      v.setFloat32(o + 8, s.y, LE);
      v.setFloat32(o + 12, s.vx, LE);
      v.setFloat32(o + 16, s.vy, LE);
      v.setInt16(o + 20, Math.round(s.angle * ANGLE_SCALE), LE);
      v.setUint8(o + 22, s.hp);
      v.setUint8(o + 23, s.cooldown);
      v.setUint8(o + 24, s.respawn);
      o += SHIP_BYTES;
    }
    for (const b of bullets) {
      v.setUint32(o, b.id, LE);
      v.setUint32(o + 4, b.owner, LE);
      v.setUint32(o + 8, b.seq, LE);
      v.setFloat32(o + 12, b.x, LE);
      v.setFloat32(o + 16, b.y, LE);
      o += BULLET_BYTES;
    }
    for (const a of asteroids) {
      v.setUint32(o, a.id, LE);
      v.setFloat32(o + 4, a.x, LE);
      v.setFloat32(o + 8, a.y, LE);
      v.setUint8(o + 12, a.radius);
      o += ASTEROID_BYTES;
    }
    return new Uint8Array(buf);
  },
};

export function patchSnapshotAck(bytes: Uint8Array | ArrayBuffer, ack: number | Seq): Uint8Array {
  const copy = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(0));
  new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(SNAPSHOT_ACK_OFFSET, ack, LE);
  return copy;
}

export function decodeBinary(data: ArrayBuffer | Uint8Array | ArrayBufferView): NetworkMessage {
  const v = viewOf(data);
  if (v.byteLength < 2) throw new Error('short message');
  const version = v.getUint8(0);
  if (version !== PROTOCOL_VERSION) throw new Error(`unsupported protocol version ${version}`);
  const type = v.getUint8(1);

  if (type === MSG_INPUT) {
    if (v.byteLength !== 8) throw new Error('bad input length');
    const flags = v.getUint8(6);
    const turnVal = v.getInt8(7);
    const turn: TurnDirection = turnVal === -1 ? -1 : turnVal === 1 ? 1 : 0;
    const msg: InputMessage = {
      type: 'input',
      seq: asSeq(v.getUint32(2, LE)),
      thrust: (flags & 1) ? 1 : 0,
      fire: ((flags >> 1) & 1) ? 1 : 0,
      turn,
    };
    return msg;
  }

  if (type === MSG_SNAPSHOT) {
    if (v.byteLength < HEADER) throw new Error('short snapshot');
    const nShips = v.getUint8(10);
    const nBullets = v.getUint16(11, LE);
    const nAsteroids = v.getUint16(13, LE);
    if (v.byteLength !== HEADER + nShips * SHIP_BYTES + nBullets * BULLET_BYTES + nAsteroids * ASTEROID_BYTES) {
      throw new Error('bad snapshot length');
    }
    const ships: ShipSnapshot[] = [];
    const bullets: BulletSnapshot[] = [];
    const asteroids: AsteroidSnapshot[] = [];
    let o = HEADER;
    for (let i = 0; i < nShips; i++, o += SHIP_BYTES) {
      ships.push({
        kind: 'ship',
        id: asEntityId(v.getUint32(o, LE)),
        x: v.getFloat32(o + 4, LE), y: v.getFloat32(o + 8, LE),
        vx: v.getFloat32(o + 12, LE), vy: v.getFloat32(o + 16, LE),
        angle: v.getInt16(o + 20, LE) / ANGLE_SCALE,
        hp: v.getUint8(o + 22), cooldown: v.getUint8(o + 23), respawn: v.getUint8(o + 24),
      });
    }
    for (let i = 0; i < nBullets; i++, o += BULLET_BYTES) {
      bullets.push({
        kind: 'bullet',
        id: asEntityId(v.getUint32(o, LE)),
        owner: asEntityId(v.getUint32(o + 4, LE)),
        seq: asSeq(v.getUint32(o + 8, LE)),
        x: v.getFloat32(o + 12, LE), y: v.getFloat32(o + 16, LE),
      });
    }
    for (let i = 0; i < nAsteroids; i++, o += ASTEROID_BYTES) {
      asteroids.push({
        kind: 'asteroid',
        id: asEntityId(v.getUint32(o, LE)),
        x: v.getFloat32(o + 4, LE), y: v.getFloat32(o + 8, LE),
        radius: v.getUint8(o + 12),
      });
    }
    const snap: Snapshot = {
      type: 'snapshot',
      tick: asTick(v.getUint32(2, LE)),
      ack: asSeq(v.getUint32(SNAPSHOT_ACK_OFFSET, LE)),
      ships,
      bullets,
      asteroids,
    };
    return snap;
  }
  throw new Error(`unknown message type ${type}`);
}

export function decodeMessage(data: unknown): NetworkMessage {
  if (typeof data === 'string') {
    const sRes = parseServerMessage(data);
    if (sRes.ok && sRes.value.type === 'snapshot') return sRes.value;
    const cRes = parseClientMessage(data);
    if (cRes.ok && cRes.value.type === 'input') {
      const inp = cRes.value;
      const typedInp: InputMessage = {
        type: 'input',
        seq: asSeq(inp.seq),
        thrust: inp.thrust,
        turn: inp.turn,
        fire: inp.fire,
      };
      return typedInp;
    }
    throw new Error('bad json message');
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return decodeBinary(data);
  }
  throw new Error('unsupported message data type');
}

export function getCodec(name: string): Codec {
  return name === 'json' ? jsonCodec : binaryCodec;
}

