import {
  DT, WORLD_W, WORLD_H, SHIP_RADIUS, SHIP_TURN_SPEED, SHIP_ACCEL, SHIP_DRAG, SHIP_MAX_HP,
  FIRE_COOLDOWN_TICKS, RESPAWN_TICKS, BULLET_SPEED, BULLET_TTL_TICKS, BULLET_RADIUS,
  BULLET_DAMAGE, ASTEROID_COUNT, ASTEROID_DAMAGE, ASTEROID_RESPAWN_TICKS,
} from './constants.ts';
import { rand } from './rng.ts';
import {
  asEntityId, asSeq, asTick,
  type EntityId, type Seq, type Tick, type World, type Ship, type Bullet, type Asteroid,
  type PlayerInput, type InputMap, type BinaryFlag, type TurnDirection,
} from './types.ts';

const TWO_PI = Math.PI * 2;

function wrapX(x: number): number { return x < 0 ? x + WORLD_W : x >= WORLD_W ? x - WORLD_W : x; }
function wrapY(y: number): number { return y < 0 ? y + WORLD_H : y >= WORLD_H ? y - WORLD_H : y; }

export function normalizeAngle(a: number): number {
  if (a > Math.PI) return a - TWO_PI;
  if (a < -Math.PI) return a + TWO_PI;
  return a;
}

export function didFire(ship: Ship, input: PlayerInput): boolean {
  return ship.respawn === 0 && ship.cooldown === 0 && input.fire === 1;
}

export function integrate(ship: Ship, input: PlayerInput, dt: number = DT): Ship {
  if (ship.respawn > 0) return ship;
  const next: Ship = { ...ship };
  next.angle = normalizeAngle(next.angle + input.turn * SHIP_TURN_SPEED * dt);
  if (input.thrust === 1) {
    next.vx += Math.cos(next.angle) * SHIP_ACCEL * dt;
    next.vy += Math.sin(next.angle) * SHIP_ACCEL * dt;
  }
  next.vx *= SHIP_DRAG;
  next.vy *= SHIP_DRAG;
  next.x = wrapX(next.x + next.vx * dt);
  next.y = wrapY(next.y + next.vy * dt);
  next.cooldown = didFire(ship, input) ? FIRE_COOLDOWN_TICKS : Math.max(0, next.cooldown - 1);
  return next;
}

export function makeBullet(id: EntityId, owner: EntityId, seq: Seq, ship: Ship): Bullet {
  const dx = Math.cos(ship.angle);
  const dy = Math.sin(ship.angle);
  return {
    id, owner, seq,
    x: wrapX(ship.x + dx * SHIP_RADIUS), y: wrapY(ship.y + dy * SHIP_RADIUS),
    vx: dx * BULLET_SPEED, vy: dy * BULLET_SPEED,
    ttl: BULLET_TTL_TICKS,
  };
}

export function stepBullet(b: Bullet, dt: number = DT): boolean {
  b.x = wrapX(b.x + b.vx * dt);
  b.y = wrapY(b.y + b.vy * dt);
  b.ttl -= 1;
  return b.ttl > 0;
}

export function createWorld(seed: number): World {
  const world: World = {
    tick: asTick(0),
    rng: seed >>> 0,
    nextId: 1,
    ships: [],
    bullets: [],
    asteroids: [],
    asteroidTimer: 0,
  };
  for (let i = 0; i < ASTEROID_COUNT; i++) spawnAsteroid(world);
  return world;
}

function spawnAsteroid(world: World): void {
  const edge = rand(world) < 0.5;
  const angle = rand(world) * TWO_PI;
  const speed = 40 + rand(world) * 60;
  const radius = 18 + Math.floor(rand(world) * 13);
  const px = rand(world);
  world.asteroids.push({
    id: asEntityId(world.nextId++),
    x: edge ? px * WORLD_W : 0,
    y: edge ? 0 : px * WORLD_H,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
  });
}

function spawnPosition(world: World, ship: Ship): void {
  ship.x = rand(world) * WORLD_W;
  ship.y = rand(world) * WORLD_H;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = normalizeAngle(rand(world) * TWO_PI);
}

export function addShip(world: World): Ship {
  const ship: Ship = {
    id: asEntityId(world.nextId++), x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    hp: SHIP_MAX_HP, cooldown: 0, respawn: 0,
  };
  spawnPosition(world, ship);
  world.ships.push(ship);
  return ship;
}

export function removeShip(world: World, id: EntityId | number): void {
  world.ships = world.ships.filter((s) => s.id !== id);
  world.bullets = world.bullets.filter((b) => b.owner !== id);
}

const dist2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) ** 2 + (ay - by) ** 2;

export function stepWorld(world: World, inputs: InputMap): void {
  world.tick = asTick(world.tick + 1);

  for (let i = 0; i < world.ships.length; i++) {
    const ship = world.ships[i];
    if (!ship) continue;
    if (ship.respawn > 0) {
      ship.respawn -= 1;
      if (ship.respawn === 0) {
        ship.hp = SHIP_MAX_HP;
        ship.cooldown = 0;
        spawnPosition(world, ship);
      }
      continue;
    }
    const input = inputs[ship.id];
    if (!input) continue;
    const fired = didFire(ship, input);
    const next = integrate(ship, input, DT);
    world.ships[i] = next;
    if (fired) world.bullets.push(makeBullet(asEntityId(world.nextId++), next.id, input.seq, next));
  }

  world.bullets = world.bullets.filter((b) => stepBullet(b));

  for (const a of world.asteroids) {
    a.x = wrapX(a.x + a.vx * DT);
    a.y = wrapY(a.y + a.vy * DT);
  }
  if (world.asteroids.length < ASTEROID_COUNT) {
    world.asteroidTimer += 1;
    if (world.asteroidTimer >= ASTEROID_RESPAWN_TICKS) {
      world.asteroidTimer = 0;
      spawnAsteroid(world);
    }
  }

  const deadBullets = new Set<EntityId>();
  const deadAsteroids = new Set<EntityId>();
  for (const b of world.bullets) {
    for (const a of world.asteroids) {
      if (deadAsteroids.has(a.id)) continue;
      if (dist2(b.x, b.y, a.x, a.y) < (a.radius + BULLET_RADIUS) ** 2) {
        deadBullets.add(b.id);
        deadAsteroids.add(a.id);
        break;
      }
    }
    if (deadBullets.has(b.id)) continue;
    for (const s of world.ships) {
      if (s.respawn > 0 || s.id === b.owner) continue;
      if (dist2(b.x, b.y, s.x, s.y) < (SHIP_RADIUS + BULLET_RADIUS) ** 2) {
        deadBullets.add(b.id);
        damage(s, BULLET_DAMAGE);
        break;
      }
    }
  }
  for (const s of world.ships) {
    if (s.respawn > 0) continue;
    for (const a of world.asteroids) {
      if (deadAsteroids.has(a.id)) continue;
      if (dist2(s.x, s.y, a.x, a.y) < (SHIP_RADIUS + a.radius) ** 2) {
        deadAsteroids.add(a.id);
        damage(s, ASTEROID_DAMAGE);
      }
    }
  }
  if (deadBullets.size) world.bullets = world.bullets.filter((b) => !deadBullets.has(b.id));
  if (deadAsteroids.size) world.asteroids = world.asteroids.filter((a) => !deadAsteroids.has(a.id));
}

function damage(ship: Ship, amount: number): void {
  ship.hp = Math.max(0, ship.hp - amount);
  if (ship.hp === 0) ship.respawn = RESPAWN_TICKS;
}

export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!('seq' in raw) || !('thrust' in raw) || !('turn' in raw) || !('fire' in raw)) return null;
  const { seq, thrust, turn, fire } = raw;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) return null;
  const t = Number(thrust);
  const r = Number(turn);
  const f = Number(fire);
  if (t !== 0 && t !== 1) return null;
  if (r !== -1 && r !== 0 && r !== 1) return null;
  if (f !== 0 && f !== 1) return null;
  const thrustFlag: BinaryFlag = t === 1 ? 1 : 0;
  const fireFlag: BinaryFlag = f === 1 ? 1 : 0;
  const turnDir: TurnDirection = r === -1 ? -1 : r === 1 ? 1 : 0;
  return { seq: asSeq(seq), thrust: thrustFlag, turn: turnDir, fire: fireFlag };
}

export function hashWorld(world: World): number {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    view.setFloat64(0, n, true);
    for (let i = 0; i < 8; i++) {
      const b = view.getUint8(i);
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mix(world.tick); mix(world.rng); mix(world.nextId); mix(world.asteroidTimer);
  for (const s of world.ships) {
    mix(s.id); mix(s.x); mix(s.y); mix(s.vx); mix(s.vy); mix(s.angle); mix(s.hp); mix(s.cooldown); mix(s.respawn);
  }
  for (const b of world.bullets) {
    mix(b.id); mix(b.owner); mix(b.seq); mix(b.x); mix(b.y); mix(b.vx); mix(b.vy); mix(b.ttl);
  }
  for (const a of world.asteroids) {
    mix(a.id); mix(a.x); mix(a.y); mix(a.vx); mix(a.vy); mix(a.radius);
  }
  return h >>> 0;
}

