import type { DateKey } from "@/lib/dates";

export type PlannedTaskType = "LEARN" | "PRACTICE" | "REVISION" | "MOCK";

export interface PlannerTopic {
  id: string;
  name: string;
  /** Learning + practice minutes still needed. 0 = only eligible for revision. */
  remainingMinutes: number;
  /** Full estimate, used to size revision sessions. */
  totalMinutes: number;
  /** 0–100 */
  priority: number;
  /** Hard prerequisite topic ids. */
  prerequisites: string[];
}

export interface PlannerOptions {
  maxSessionMinutes: number;
  minSessionMinutes: number;
  /** Max minutes of one topic per day. */
  maxTopicMinutesPerDay: number;
  /** Share of a topic's time spent on practice (rest is learning). */
  practiceShare: number;
  /** Spaced-repetition offsets in days after a topic is finished. */
  revisionOffsets: number[];
  /** Max share of a learning day that revision may take. */
  maxRevisionShare: number;
  /** Share of a day used once the whole syllabus is learned, before final revision. */
  consolidationShare: number;
  /** Days between mock tests in the consolidation phase. */
  mockEveryDays: number;
}

export interface PlannerInput {
  /** First day that may receive tasks (inclusive). */
  startDate: DateKey;
  /** Exam day — nothing is scheduled on or after it. */
  examDate: DateKey;
  /** Minutes available per weekday (0 = Sunday). */
  weeklyMinutes: Record<number, number>;
  unavailableDates: DateKey[];
  /** Share of each day held back as buffer (0–50). */
  bufferPercent: number;
  topics: PlannerTopic[];
  /** Minutes already used per date by tasks the planner must keep (pinned / done). */
  reservedMinutes?: Record<DateKey, number>;
  /** Weak topics that get an extra revision session as early as possible. */
  boostRevisionTopicIds?: string[];
  options?: Partial<PlannerOptions>;
}

export interface PlannedTask {
  date: DateKey;
  order: number;
  type: PlannedTaskType;
  topicId: string | null;
  title: string;
  minutes: number;
}

export interface PlannerOutput {
  tasks: PlannedTask[];
  unscheduled: { topicId: string; name: string; minutes: number }[];
  unscheduledMinutes: number;
  /** Last day with learning/practice work, or null if none scheduled. */
  projectedCompletion: DateKey | null;
  finalRevisionStart: DateKey | null;
  studyDays: number;
  warnings: string[];
}
