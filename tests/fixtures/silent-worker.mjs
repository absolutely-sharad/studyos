// Says hello, then never answers: stands in for a worker stuck on a file.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ready: true, heapLimitMb: 64 });
parentPort.on("message", () => {});
