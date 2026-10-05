// Says hello, then eats memory until its limit is hit.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ready: true, heapLimitMb: 64 });
parentPort.on("message", () => {
  const hog = [];
  for (;;) hog.push(new Array(1_000_000).fill(Math.random()));
});
