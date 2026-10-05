import type { Analysis } from "./analyze";
import type { DocumentKind } from "./extract";

/** Messages between the web process and a document worker thread. */
export interface WorkerRequest {
  id: number;
  /** The file's bytes. Transferred, not copied: the sender no longer owns it after posting. */
  data: ArrayBuffer;
  kind: DocumentKind;
  filename: string;
}

/** Sent once when a worker has loaded, so a worker that can't start is noticed before it is given a file. */
export interface WorkerReady {
  ready: true;
  /** The memory ceiling the worker actually runs under, so the pool can tell if the configured one was ignored. */
  heapLimitMb: number;
}

export type WorkerResponse =
  | { id: number; ok: true; result: Analysis }
  /** `safe` errors are our own plain-language messages and may be shown to the student; others are only logged. */
  | { id: number; ok: false; safe: boolean; message: string };
