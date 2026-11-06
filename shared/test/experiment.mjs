// node shared/test/experiment.mjs - corrections under different network conditions.
// Used for the "break determinism on purpose" experiment: run it, add Math.random() to integrate, run again.
import { runSession } from './harness.mjs';

const cases = [
  { name: 'RTT 0', lat: 0 },
  { name: 'RTT 100', lat: 100 },
  { name: 'RTT 200', lat: 200 },
  { name: 'RTT 100 +-30, 2% drop', lat: 100, jitter: 30, drop: 0.02 },
];
const rows = cases.map(({ name, ...opts }) => {
  const r = runSession({ seconds: 30, ...opts });
  return { case: name, meanPx: +r.meanCorrection.toFixed(3), p95Px: +r.p95Correction.toFixed(3), maxPx: +r.maxCorrection.toFixed(2), starvedTicks: r.starved };
});
console.table(rows);

