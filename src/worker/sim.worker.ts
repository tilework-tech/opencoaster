import { SimRunner } from './sim-runner';
import type { FromWorker, ToWorker } from './protocol';

interface WorkerScope {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const runner = new SimRunner(
  { post: (msg, transfer) => scope.postMessage(msg, transfer ?? []) },
  () => performance.now(),
);

scope.onmessage = (e) => runner.handle(e.data);
// A timer (not rAF, which workers lack) drives the loop; the scheduler turns elapsed wall time
// into whole ticks, so timer jitter never changes simulation results.
setInterval(() => runner.pump(), 4);
