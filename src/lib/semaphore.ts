/** Thrown by `Semaphore.run` when the waiting line is already full. Callers turn it into a quick "busy, try again" answer. */
export class QueueFullError extends Error {
  constructor() {
    super("Too many requests are already waiting");
    this.name = "QueueFullError";
  }
}

/**
 * Lets at most `max` jobs run at once and at most `maxQueue` more wait their turn; anything beyond that is
 * refused immediately. Refusing fast beats queueing without limit: a flood then costs a few "busy" replies
 * instead of minutes of latency and memory for everyone behind it. Per process, not shared across instances.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

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

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new QueueFullError();
      // The finishing job hands its slot straight to us, so `active` never dips and nobody can jump the line.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
