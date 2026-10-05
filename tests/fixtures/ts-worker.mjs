// Starts a TypeScript worker file inside a worker thread so the tests can run the real
// src/lib/documents/extract-worker.ts without a build: tsx compiles it on the fly. The file to run comes in workerData.
import { tsImport } from "tsx/esm/api";
import { workerData } from "node:worker_threads";

await tsImport(workerData.entry, import.meta.url);
