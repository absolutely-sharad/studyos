// Runs on a worker thread (started by pool.ts), never in the web process. Relative imports only: this file and
// everything it pulls in is bundled on its own.
import { getHeapStatistics } from "node:v8";
import { parentPort } from "node:worker_threads";
import { analyzeDocument } from "./analyze";
import { DocumentError } from "./extract";
import type { WorkerReady, WorkerRequest, WorkerResponse } from "./worker-protocol";

const port = parentPort;
if (!port) throw new Error("extract-worker must be started as a worker thread");

port.on("message", async (request: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    const result = await analyzeDocument(new Uint8Array(request.data), request.kind, request.filename);
    response = { id: request.id, ok: true, result };
  } catch (err) {
    response = { id: request.id, ok: false, safe: err instanceof DocumentError, message: err instanceof Error ? err.message : String(err) };
  }
  port.postMessage(response);
});

port.postMessage({ ready: true, heapLimitMb: Math.round(getHeapStatistics().heap_size_limit / 1048576) } satisfies WorkerReady);
