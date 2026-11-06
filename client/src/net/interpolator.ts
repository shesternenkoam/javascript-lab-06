import {
  TICK_MS, WORLD_W, WORLD_H, normalizeAngle,
  type Snapshot, type ShipSnapshot, type BulletSnapshot, type AsteroidSnapshot,
} from 'shared';

const MAX_SNAPSHOTS = 60;

function lerpWrapped(a: number, b: number, f: number, size: number): number {
  const d = b - a;
  if (Math.abs(d) > size / 2) return b;
  return a + d * f;
}

function lerpEntity<T extends { x: number; y: number; angle?: number }>(a: T, b: T, f: number): T {
  const angle =
    b.angle !== undefined && a.angle !== undefined
      ? a.angle + normalizeAngle(b.angle - a.angle) * f
      : b.angle;
  return {
    ...b,
    x: lerpWrapped(a.x, b.x, f, WORLD_W),
    y: lerpWrapped(a.y, b.y, f, WORLD_H),
    ...(angle !== undefined ? { angle } : {}),
  };
}

function lerpList<T extends { id: number; x: number; y: number; angle?: number }>(
  listA: readonly T[],
  listB: readonly T[],
  f: number,
): T[] {
  const byId = new Map(listA.map((e) => [e.id, e]));
  return listB.map((e) => {
    const prev = byId.get(e.id);
    return prev ? lerpEntity(prev, e, f) : e;
  });
}

export interface InterpolatedSample {
  tick: number;
  ships: ShipSnapshot[];
  bullets: BulletSnapshot[];
  asteroids: AsteroidSnapshot[];
}

export class Interpolator {
  snaps: Snapshot[] = [];
  offset: number | null = null;
  starved: number = 0;

  push(snap: Snapshot, arrivalMs: number): boolean {
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) return false;
    const sample = arrivalMs - snap.tick * TICK_MS;
    if (this.offset === null) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample < this.offset ? 0.5 : 0.02);
    this.snaps.push(snap);
    if (this.snaps.length > MAX_SNAPSHOTS) this.snaps.shift();
    return true;
  }

  get newest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  sample(nowMs: number, delayMs: number): InterpolatedSample | Snapshot | null {
    const n = this.snaps.length;
    if (n === 0 || this.offset === null) return null;
    const t = (nowMs - this.offset - delayMs) / TICK_MS;
    const first = this.snaps[0];
    const last = this.snaps[n - 1];
    if (!first || !last) return null;
    if (t <= first.tick) return first;
    if (t >= last.tick) {
      this.starved++;
      return last;
    }
    let i = n - 1;
    while (i > 0) {
      const snap = this.snaps[i - 1];
      if (snap && snap.tick > t) i--;
      else break;
    }
    const a = this.snaps[i - 1];
    const b = this.snaps[i];
    if (!a || !b) return last;
    const f = (t - a.tick) / (b.tick - a.tick);
    return {
      tick: t,
      ships: lerpList(a.ships, b.ships, f),
      bullets: lerpList(a.bullets, b.bullets, f),
      asteroids: lerpList(a.asteroids, b.asteroids, f),
    };
  }
}
