// Says hello, then dies as soon as it is given a file.
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ ready: true, heapLimitMb: 64 });
parentPort.on("message", () => process.exit(3));
