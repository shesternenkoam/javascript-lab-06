export interface LinkSettings {
  readonly lat: number;
  readonly jitter: number;
  readonly drop: number;
}

export interface LinkSimOptions {
  readonly lat?: number;
  readonly jitter?: number;
  readonly drop?: number;
}

export class LinkSim {
  lat: number = 0;
  jitter: number = 0;
  drop: number = 0;
  private readonly timers: Set<NodeJS.Timeout> = new Set();

  constructor({ lat = 0, jitter = 0, drop = 0 }: LinkSimOptions = {}) {
    this.set({ lat, jitter, drop });
  }

  set({ lat, jitter, drop }: LinkSimOptions): void {
    const num = (v: unknown, lo: number, hi: number, old: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : old;
    };
    this.lat = num(lat, 0, 1000, this.lat);
    this.jitter = num(jitter, 0, 500, this.jitter);
    this.drop = num(drop, 0, 0.5, this.drop);
  }

  get settings(): LinkSettings {
    return { lat: this.lat, jitter: this.jitter, drop: this.drop };
  }

  deliver(fn: () => void): boolean {
    if (this.drop > 0 && Math.random() < this.drop) return false;
    const delay = Math.max(0, this.lat / 2 + (Math.random() - 0.5) * this.jitter);
    if (delay === 0) {
      fn();
      return true;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
    return true;
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
