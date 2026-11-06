export type TrafficDir = 'in' | 'out';

export class NetStats {
  events: Record<TrafficDir, [timestamp: number, bytes: number][]> = { in: [], out: [] };
  rtt: number = 0;
  rttAvg: number = 0;
  lastSnapshotAt: number = 0;
  history: { correction: number[]; rtt: number[] } = { correction: [], rtt: [] };

  traffic(dir: TrafficDir, bytes: number, now: number = performance.now()): void {
    this.events[dir].push([now, bytes]);
  }

  bytesPerSec(dir: TrafficDir, now: number = performance.now()): number {
    const list = this.events[dir];
    while (list.length && now - (list[0]?.[0] ?? 0) > 1000) list.shift();
    let sum = 0;
    for (const item of list) sum += item[1];
    return sum;
  }

  onPong(sentAt: number, now: number = performance.now()): void {
    this.rtt = now - sentAt;
    this.rttAvg = this.rttAvg ? this.rttAvg + (this.rtt - this.rttAvg) * 0.2 : this.rtt;
  }

  snapshotAge(now: number = performance.now()): number {
    return this.lastSnapshotAt ? now - this.lastSnapshotAt : 0;
  }

  pushHistory(key: 'correction' | 'rtt', value: number, max: number = 120): void {
    const h = this.history[key];
    h.push(value);
    if (h.length > max) h.shift();
  }
}
