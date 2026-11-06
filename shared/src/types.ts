export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

// Brand helper: only 1 justified type assertion for nominal branded types
function brand<B extends string>(n: number): number & { readonly __brand: B } {
  return n as number & { readonly __brand: B }; // #1: nominal brand assertion
}

export type EntityId = number & { readonly __brand: 'EntityId' };
export type Tick = number & { readonly __brand: 'Tick' };
export type Seq = number & { readonly __brand: 'Seq' };

export const asEntityId = (n: number): EntityId => brand<'EntityId'>(n);
export const asTick = (n: number): Tick => brand<'Tick'>(n);
export const asSeq = (n: number): Seq => brand<'Seq'>(n);

export type TurnDirection = -1 | 0 | 1;
export type BinaryFlag = 0 | 1;

export interface PlayerInput {
  readonly seq: Seq;
  readonly thrust: BinaryFlag;
  readonly turn: TurnDirection;
  readonly fire: BinaryFlag;
  readonly x?: number;
  readonly y?: number;
}

export type InputMap = Record<number, PlayerInput | undefined>;

export interface Ship {
  id: EntityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  cooldown: number;
  respawn: number;
}

export interface Bullet {
  id: EntityId;
  owner: EntityId;
  seq: Seq;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}

export interface Asteroid {
  id: EntityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface World {
  tick: Tick;
  rng: number;
  nextId: number;
  ships: Ship[];
  bullets: Bullet[];
  asteroids: Asteroid[];
  asteroidTimer: number;
}

// Discriminated union of snapshot entity data
export interface ShipSnapshot {
  readonly kind: 'ship';
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly hp: number;
  readonly cooldown: number;
  readonly respawn: number;
}

export interface BulletSnapshot {
  readonly kind: 'bullet';
  readonly id: EntityId;
  readonly owner: EntityId;
  readonly seq: Seq;
  readonly x: number;
  readonly y: number;
}

export interface AsteroidSnapshot {
  readonly kind: 'asteroid';
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export type EntitySnapshot = ShipSnapshot | BulletSnapshot | AsteroidSnapshot;

export interface InputMessage {
  readonly type: 'input';
  readonly seq: Seq;
  readonly thrust: BinaryFlag;
  readonly fire: BinaryFlag;
  readonly turn: TurnDirection;
}

export interface Snapshot {
  readonly type: 'snapshot';
  readonly tick: Tick;
  readonly ack: Seq | number;
  readonly ships: readonly ShipSnapshot[];
  readonly bullets: readonly BulletSnapshot[];
  readonly asteroids: readonly AsteroidSnapshot[];
}

