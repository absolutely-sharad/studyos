// Says hello, then allocates buffers (which V8's heap limit does not count) in a loop that blocks the worker's own
// event loop, 16 MB every 20 ms, up to 640 MB, and finally answers. Bounded, so a missing watchdog can't take the
// machine down: it simply completes, and the test notices that nothing stopped it.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ready: true, heapLimitMb: 64 });
parentPort.on("message", (request) => {
  const hog = [];
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 40; i++) {
    hog.push(Buffer.alloc(16 * 1024 * 1024, 7));
    Atomics.wait(pause, 0, 0, 20);
  }
  parentPort.postMessage({ id: request.id, ok: true, result: { outcome: "needs-ocr", pageCount: 0, confidence: 0 } });
});
