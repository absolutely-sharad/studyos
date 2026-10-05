/** Thrown by `Semaphore.run` when the waiting line is already full. Callers turn it into a quick "busy, try again" answer. */
export class QueueFullError extends Error {
  constructor(message = "Too many requests are already waiting") {
    super(message);
    this.name = "QueueFullError";
  }
}

/** The job waited longer than `waitMs` for a free slot. A kind of QueueFullError, so callers handle both the same way. */
export class QueueTimeoutError extends QueueFullError {
  constructor() {
    super("Waited too long for a free slot");
    this.name = "QueueTimeoutError";
  }
}

interface Waiter {
  start: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Lets at most `max` jobs run at once and at most `maxQueue` more wait their turn; anything beyond that is
 * refused immediately, and a job can also give up after waiting `waitMs`. Refusing fast beats queueing without
 * limit: a flood then costs a few "busy" replies instead of minutes of latency and memory for everyone behind it.
 * Per process, not shared across instances.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    readonly max: number,
    readonly maxQueue = Infinity,
  ) {
    if (!(max >= 1)) throw new RangeError("Semaphore needs a max of at least 1");
  }

  get running() {
    return this.active;
  }

  get queued() {
    return this.waiting.length;
  }

  async run<T>(job: () => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new QueueFullError();
      // The finishing job hands its slot straight to us, so `active` never dips and nobody can jump the line.
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          start: () => {
            clearTimeout(waiter.timer);
            resolve();
          },
        };
        if (options.waitMs !== undefined)
          waiter.timer = setTimeout(() => {
            const at = this.waiting.indexOf(waiter);
            if (at >= 0) this.waiting.splice(at, 1);
            reject(new QueueTimeoutError());
          }, options.waitMs);
        this.waiting.push(waiter);
      });
    } else {
      this.active++;
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next.start();
      else this.active--;
    }
  }
}
