import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/planner/schedule";
import { prioritizedOrder } from "@/lib/planner/graph";
import { computePriorities, explainPriority } from "@/lib/planner/priority";
import { computeHealth } from "@/lib/planner/health";
import { weekday } from "@/lib/dates";
import type { PlannerInput, PlannerTopic } from "@/lib/planner/types";

const topic = (id: string, minutes: number, priority: number, prerequisites: string[] = []): PlannerTopic => ({
  id, name: id, remainingMinutes: minutes, totalMinutes: minutes, priority, prerequisites,
});

const everyDay = (m: number) => ({ 0: m, 1: m, 2: m, 3: m, 4: m, 5: m, 6: m });

const base = (over: Partial<PlannerInput> = {}): PlannerInput => ({
  startDate: "2026-10-05",
  examDate: "2026-11-30",
  weeklyMinutes: everyDay(180),
  unavailableDates: [],
  bufferPercent: 10,
  topics: [topic("arrays", 120, 40), topic("binary-search", 120, 90, ["arrays"]), topic("bst", 180, 70, ["binary-search"])],
  ...over,
});

describe("dependency ordering", () => {
  it("puts prerequisites first and lifts their urgency", () => {
    const { order } = prioritizedOrder([
      { id: "a", priority: 10, prerequisites: [] },
      { id: "b", priority: 50, prerequisites: [] },
      { id: "c", priority: 95, prerequisites: ["a"] },
    ]);
    // "a" is low priority on its own but is needed by the most urgent topic.
    expect(order).toEqual(["a", "c", "b"]);
  });

  it("breaks cycles instead of hanging", () => {
    const r = prioritizedOrder([
      { id: "x", priority: 50, prerequisites: ["y"] },
      { id: "y", priority: 60, prerequisites: ["x"] },
    ]);
    expect(r.order).toHaveLength(2);
    expect(r.brokenCycles.length).toBeGreaterThan(0);
  });
});

describe("planner", () => {
  it("is deterministic", () => {
    expect(buildPlan(base())).toEqual(buildPlan(base()));
  });

  it("never exceeds daily capacity after buffer", () => {
    const plan = buildPlan(base({ topics: Array.from({ length: 30 }, (_, i) => topic(`t${i}`, 200, i * 3)) }));
    const perDay = new Map<string, number>();
    for (const t of plan.tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
    for (const total of perDay.values()) expect(total).toBeLessThanOrEqual(Math.floor(180 * 0.9));
  });

  it("never schedules on or after the exam, or on unavailable days", () => {
    const plan = buildPlan(base({ unavailableDates: ["2026-10-06", "2026-10-07"] }));
    for (const t of plan.tasks) {
      expect(t.date < "2026-11-30").toBe(true);
      expect(["2026-10-06", "2026-10-07"]).not.toContain(t.date);
    }
  });

  it("respects weekdays with no availability", () => {
    const plan = buildPlan(base({ weeklyMinutes: { ...everyDay(180), 0: 0 } }));
    for (const t of plan.tasks) expect(weekday(t.date)).not.toBe(0);
  });

  it("finishes prerequisites before dependents start", () => {
    const plan = buildPlan(base());
    const firstOf = (id: string) => plan.tasks.findIndex((t) => t.topicId === id && t.type === "LEARN");
    const lastStudyOf = (id: string) =>
      plan.tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.topicId === id && t.type !== "REVISION").at(-1)!.i;
    expect(lastStudyOf("arrays")).toBeLessThan(firstOf("binary-search"));
    expect(lastStudyOf("binary-search")).toBeLessThan(firstOf("bst"));
  });

  it("adds practice, spaced revision and a protected final window", () => {
    const plan = buildPlan(base());
    expect(plan.tasks.some((t) => t.type === "PRACTICE")).toBe(true);
    expect(plan.tasks.filter((t) => t.type === "REVISION" && t.topicId === "arrays").length).toBeGreaterThanOrEqual(2);
    expect(plan.finalRevisionStart).not.toBeNull();
    const inFinal = plan.tasks.filter((t) => t.date >= plan.finalRevisionStart!);
    expect(inFinal.every((t) => t.type === "REVISION" || t.type === "MOCK")).toBe(true);
    expect(inFinal.some((t) => t.type === "MOCK")).toBe(true);
  });

  it("reports work that doesn't fit instead of overloading days", () => {
    const plan = buildPlan(base({
      examDate: "2026-10-12",
      topics: [topic("big", 3000, 90), topic("small", 60, 20)],
    }));
    expect(plan.unscheduledMinutes).toBeGreaterThan(0);
    expect(plan.warnings.join(" ")).toMatch(/doesn't fit/);
  });

  it("leaves reserved minutes free for pinned tasks", () => {
    const plan = buildPlan(base({ reservedMinutes: { "2026-10-05": 120 } }));
    const day = plan.tasks.filter((t) => t.date === "2026-10-05").reduce((s, t) => s + t.minutes, 0);
    expect(day).toBeLessThanOrEqual(Math.floor(180 * 0.9) - 120);
  });

  it("handles no time left gracefully", () => {
    const plan = buildPlan(base({ startDate: "2026-12-01" }));
    expect(plan.tasks).toHaveLength(0);
    expect(plan.warnings[0]).toMatch(/no study days/);
  });
});

describe("priority", () => {
  it("ranks frequent, foundational, weak topics higher and explains why", () => {
    const p = computePriorities([
      { id: "dp", name: "DP", importance: 4, difficulty: 5, mastery: 10, pyqFrequency: 12, prerequisites: ["rec"] },
      { id: "rec", name: "Recursion", importance: 3, difficulty: 2, mastery: 50, pyqFrequency: 2, prerequisites: [] },
      { id: "misc", name: "Misc", importance: 1, difficulty: 1, mastery: 90, pyqFrequency: 0, prerequisites: [] },
    ]);
    expect(p.get("dp")!.score).toBeGreaterThan(p.get("misc")!.score);
    expect(p.get("dp")!.level).toBe("High");
    const text = explainPriority(p.get("dp")!.level, p.get("dp")!.reasons);
    expect(text).toMatch(/^High priority because it appears in 12 previous-year questions/);
  });
});

describe("plan health", () => {
  it("flags falling behind and projects completion", () => {
    const h = computeHealth({
      today: "2026-10-10",
      examDate: "2026-10-20",
      finalRevisionStart: "2026-10-18",
      weeklyMinutes: everyDay(60),
      unavailableDates: [],
      bufferPercent: 0,
      unscheduledMinutes: 0,
      tasks: [
        { date: "2026-10-06", type: "LEARN", minutes: 60, status: "COMPLETED" },
        { date: "2026-10-07", type: "LEARN", minutes: 60, status: "TODO" },
        { date: "2026-10-08", type: "LEARN", minutes: 60, status: "SKIPPED" },
        { date: "2026-10-09", type: "LEARN", minutes: 60, status: "TODO" },
        { date: "2026-10-10", type: "LEARN", minutes: 600, status: "TODO" },
      ],
    });
    expect(h.behindMinutes).toBe(120);
    expect(h.tone).not.toBe("good");
    expect(h.prediction).not.toBeNull();
    expect(h.prediction!.marginDays).toBeLessThan(0);
  });
});

describe("weak topics", () => {
  it("get an early extra revision", () => {
    const plan = buildPlan(base({
      topics: [topic("done-but-weak", 0, 50), topic("next", 120, 60)],
      boostRevisionTopicIds: ["done-but-weak"],
    }));
    const first = plan.tasks.filter((t) => t.date === "2026-10-05");
    expect(first[0]).toMatchObject({ type: "REVISION", topicId: "done-but-weak" });
  });
});

describe("consolidation phase", () => {
  // 3 short topics, 8 weeks: the syllabus is learned early, leaving spare weeks before final revision.
  const plan = buildPlan(base());
  const studyEnd = plan.projectedCompletion!;

  it("fills spare days after learning with revision and mock tests", () => {
    const between = plan.tasks.filter((t) => t.date > studyEnd && plan.finalRevisionStart && t.date < plan.finalRevisionStart);
    const days = new Set(between.map((t) => t.date));
    expect(days.size).toBeGreaterThan(20);
    expect(between.every((t) => t.type === "REVISION" || t.type === "MOCK")).toBe(true);
    expect(between.some((t) => t.type === "MOCK")).toBe(true);
  });

  it("leaves part of each revision-only day free", () => {
    const perDay = new Map<string, { minutes: number; mock: boolean }>();
    for (const t of plan.tasks.filter((x) => x.date > studyEnd && plan.finalRevisionStart && x.date < plan.finalRevisionStart)) {
      const d = perDay.get(t.date) ?? { minutes: 0, mock: false };
      perDay.set(t.date, { minutes: d.minutes + t.minutes, mock: d.mock || t.type === "MOCK" });
    }
    for (const d of perDay.values()) if (!d.mock) expect(d.minutes).toBeLessThanOrEqual(Math.floor(180 * 0.9 * 0.75) + 5);
  });

  it("does not move the syllabus completion date", () => {
    const study = plan.tasks.filter((t) => t.type === "LEARN" || t.type === "PRACTICE");
    expect(study.at(-1)!.date).toBe(studyEnd);
  });
});
