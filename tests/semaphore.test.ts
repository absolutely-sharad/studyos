import { describe, expect, it } from "vitest";
import { QueueFullError, Semaphore } from "@/lib/semaphore";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A job that stays running until `release()` is called. */
function gatedJob() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  return { release, job: () => released };
}

describe("Semaphore", () => {
  it("never runs more than `max` jobs at once", async () => {
    const sem = new Semaphore(3);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        sem.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await tick();
          running--;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(sem.running).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it("starts waiting jobs in the order they arrived", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const first = gatedJob();
    const all = [sem.run(first.job)];
    for (const n of [1, 2, 3])
      all.push(
        sem.run(async () => {
          order.push(n);
        }),
      );
    await tick();
    expect(order).toEqual([]);
    first.release();
    await Promise.all(all);
    expect(order).toEqual([1, 2, 3]);
  });

  it("refuses immediately once the waiting line is full, and says so with QueueFullError", async () => {
    const sem = new Semaphore(1, 1);
    const a = gatedJob();
    const b = gatedJob();
    const running = sem.run(a.job);
    const waiting = sem.run(b.job);
    await tick();
    expect(sem.running).toBe(1);
    expect(sem.queued).toBe(1);
    await expect(sem.run(async () => "never")).rejects.toBeInstanceOf(QueueFullError);
    a.release();
    b.release();
    await Promise.all([running, waiting]);
  });

  it("with maxQueue 0 it only ever refuses, never queues", async () => {
    const sem = new Semaphore(1, 0);
    const a = gatedJob();
    const running = sem.run(a.job);
    await expect(sem.run(async () => 1)).rejects.toBeInstanceOf(QueueFullError);
    a.release();
    await running;
  });

  it("frees the slot when a job throws, so one failure can't wedge the line", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(sem.run(async () => "fine")).resolves.toBe("fine");
    expect(sem.running).toBe(0);
  });

  it("hands the slot to the next waiter without a gap, so a newcomer can't jump the line", async () => {
    const sem = new Semaphore(1);
    const first = gatedJob();
    const order: string[] = [];
    const a = sem.run(first.job);
    const waiter = sem.run(async () => {
      order.push("waiter");
    });
    first.release();
    await a;
    // Arrives right after the first job finished: the waiter already owns the slot.
    const newcomer = sem.run(async () => {
      order.push("newcomer");
    });
    await Promise.all([waiter, newcomer]);
    expect(order).toEqual(["waiter", "newcomer"]);
  });

  it("returns the job's value and rejects nonsense limits", async () => {
    await expect(new Semaphore(2).run(async () => 42)).resolves.toBe(42);
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(Number.NaN)).toThrow(RangeError);
  });
});
