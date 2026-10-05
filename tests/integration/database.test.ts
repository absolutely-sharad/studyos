// Needs a migrated Postgres: TEST_DATABASE_URL=postgresql://... npm test
// (CI provides one; without the variable this whole file is skipped.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Db = typeof import("@/lib/db").db;
let db: Db;
let limiter: typeof import("@/lib/rate-limit");
let planner: typeof import("@/lib/planner/service");

const created: string[] = [];

beforeAll(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  db = (await import("@/lib/db")).db;
  limiter = await import("@/lib/rate-limit");
  planner = await import("@/lib/planner/service");
});

afterAll(async () => {
  if (!url) return;
  await db.user.deleteMany({ where: { id: { in: created } } });
  await db.$executeRaw`DELETE FROM rate_limits WHERE "key" LIKE 'itest:%'`;
  await db.$disconnect();
});

const rule = (name: string, limit: number, windowSec: number) => ({ name: `itest:${name}`, limit, windowSec });
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

suite("rate limiter", () => {
  it("allows up to the limit, then blocks with a retry time", async () => {
    const r = rule("basic", 3, 60);
    const s = unique();
    const verdicts = [];
    for (let i = 0; i < 5; i++) verdicts.push(await limiter.hit(r, s));
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, true, false, false]);
    expect(verdicts[3].retryAfterSec).toBeGreaterThan(0);
    expect(verdicts[3].retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("keeps separate counters per subject and per rule", async () => {
    const a = rule("sep-a", 1, 60);
    const b = rule("sep-b", 1, 60);
    const s = unique();
    expect((await limiter.hit(a, s)).ok).toBe(true);
    expect((await limiter.hit(a, s)).ok).toBe(false);
    expect((await limiter.hit(a, unique())).ok).toBe(true); // someone else
    expect((await limiter.hit(b, s)).ok).toBe(true); // another rule
  });

  it("starts a fresh window once the old one has expired", async () => {
    const r = rule("expiry", 1, 1);
    const s = unique();
    expect((await limiter.hit(r, s)).ok).toBe(true);
    expect((await limiter.hit(r, s)).ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await limiter.hit(r, s)).ok).toBe(true);
  });

  it("counts every hit exactly once under concurrency", async () => {
    const r = rule("race", 20, 60);
    const s = unique();
    const verdicts = await Promise.all(Array.from({ length: 50 }, () => limiter.hit(r, s)));
    expect(verdicts.filter((v) => v.ok)).toHaveLength(20);
    expect(verdicts.filter((v) => !v.ok)).toHaveLength(30);
  });

  it("peek reads without counting", async () => {
    const r = rule("peek", 2, 60);
    const s = unique();
    for (let i = 0; i < 5; i++) expect((await limiter.peek(r, s)).ok).toBe(true);
    await limiter.hit(r, s);
    await limiter.hit(r, s);
    expect((await limiter.peek(r, s)).ok).toBe(false);
  });

  it("never stores the subject (an email or IP) in the table", async () => {
    const r = rule("privacy", 5, 60);
    const subject = `person-${unique()}@example.com`;
    await limiter.hit(r, subject);
    const rows = await db.$queryRaw<{ key: string }[]>`SELECT "key" FROM rate_limits WHERE "key" LIKE 'itest:privacy:%'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.key).not.toContain("example.com");
  });
});

suite("plan building", () => {
  async function seedExam() {
    const user = await db.user.create({ data: { email: `itest-${unique()}@example.com`, name: "Integration" } });
    created.push(user.id);
    const examDate = new Date(Date.now() + 60 * 86_400_000);
    const exam = await db.exam.create({
      data: {
        userId: user.id,
        name: "Integration exam",
        category: "CUSTOM",
        customCategory: "test",
        examDate: new Date(Date.UTC(examDate.getUTCFullYear(), examDate.getUTCMonth(), examDate.getUTCDate())),
        weeklyMinutes: { 0: 240, 1: 120, 2: 120, 3: 120, 4: 120, 5: 120, 6: 240 },
      },
    });
    const subject = await db.subject.create({ data: { examId: exam.id, name: "Core", order: 0 } });
    const names = ["Arrays", "Trees", "Graphs", "Sorting", "Hashing"];
    await db.topic.createMany({
      data: names.map((name, order) => ({ examId: exam.id, subjectId: subject.id, name, order, estimatedMinutes: 120 })),
    });
    return exam;
  }

  const today = () => new Date().toISOString().slice(0, 10);

  it("builds one plan with tasks, a change log and saved scores", async () => {
    const exam = await seedExam();
    const summary = await planner.applyPlan(exam.id, today(), "initial", "test");
    expect(summary.taskCount).toBeGreaterThan(0);
    expect(await db.studyPlan.count({ where: { examId: exam.id } })).toBe(1);
    expect(await db.studyTask.count({ where: { examId: exam.id } })).toBe(summary.taskCount);
    expect(await db.planChange.count({ where: { examId: exam.id } })).toBe(1);
    expect(await db.topic.count({ where: { examId: exam.id, priorityScore: { gt: 0 } } })).toBe(5);
  });

  it("two simultaneous builds (a double-click) still leave exactly one plan and no duplicate tasks", async () => {
    const exam = await seedExam();
    const [a, b] = await Promise.all([
      planner.applyPlan(exam.id, today(), "initial", "click 1"),
      planner.applyPlan(exam.id, today(), "initial", "click 2"),
    ]);
    expect(a.taskCount).toBe(b.taskCount);
    expect(await db.studyPlan.count({ where: { examId: exam.id } })).toBe(1);
    expect(await db.studyTask.count({ where: { examId: exam.id } })).toBe(a.taskCount);
    const plan = await db.studyPlan.findFirstOrThrow({ where: { examId: exam.id } });
    expect(plan.version).toBe(2); // the second build updated the first's plan instead of creating another
  });

  it("a failed build changes nothing", async () => {
    const exam = await seedExam();
    await planner.applyPlan(exam.id, today(), "initial", "first");
    const before = await db.studyTask.count({ where: { examId: exam.id } });
    // A bad date makes the transaction throw part-way through.
    await expect(planner.applyPlan(exam.id, "not-a-date", "replan", "broken")).rejects.toThrow();
    expect(await db.studyTask.count({ where: { examId: exam.id } })).toBe(before);
    expect(await db.planChange.count({ where: { examId: exam.id } })).toBe(1);
  });

  it("previewing a replan saves nothing", async () => {
    const exam = await seedExam();
    await planner.applyPlan(exam.id, today(), "initial", "first");
    const tasks = await db.studyTask.findMany({ where: { examId: exam.id }, select: { id: true }, orderBy: { id: "asc" } });
    await planner.previewReplan(exam.id, today());
    const after = await db.studyTask.findMany({ where: { examId: exam.id }, select: { id: true }, orderBy: { id: "asc" } });
    expect(after).toEqual(tasks);
    expect(await db.planChange.count({ where: { examId: exam.id } })).toBe(1);
  });

  it("deleting the user removes everything beneath it", async () => {
    const exam = await seedExam();
    await planner.applyPlan(exam.id, today(), "initial", "first");
    await db.user.delete({ where: { id: exam.userId } });
    for (const count of [
      db.exam.count({ where: { id: exam.id } }),
      db.topic.count({ where: { examId: exam.id } }),
      db.studyPlan.count({ where: { examId: exam.id } }),
      db.studyTask.count({ where: { examId: exam.id } }),
      db.planChange.count({ where: { examId: exam.id } }),
    ])
      expect(await count).toBe(0);
  });
});
