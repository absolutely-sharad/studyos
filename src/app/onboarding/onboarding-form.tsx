"use client";

import { useMemo, useState, useTransition } from "react";
import { createExam, type ExamInput } from "@/actions/exam";
import { Button, Field, cx, inputBase, inputClass } from "@/components/ui";

const CATEGORIES: { value: ExamInput["category"]; label: string; example: string }[] = [
  { value: "COMPETITIVE", label: "Competitive exam", example: "GATE, JEE, UPSC, CAT, banking" },
  { value: "UNIVERSITY", label: "University exam", example: "Semester or end-term papers" },
  { value: "PLACEMENT", label: "Placement", example: "Aptitude rounds and coding tests" },
  { value: "INTERVIEW", label: "Interview", example: "Technical or coding interviews" },
  { value: "CERTIFICATION", label: "Certification", example: "AWS, CFA, language exams" },
  { value: "CUSTOM", label: "Something else", example: "Tell us in your own words" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
  { value: "NIGHT", label: "Late night" },
] as const;
const STYLES = ["Reading", "Video lectures", "Practice questions", "Flashcards", "Making notes", "Problem solving", "Active recall"];
const STEPS = ["Goal", "Exam", "Time", "Learning style"];

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "rounded-md border px-3 py-2 text-[15px] transition-colors",
        selected ? "border-ink bg-ink text-white" : "border-rule bg-sheet hover:border-ink-soft",
      )}
    >
      {children}
    </button>
  );
}

export function OnboardingForm({ firstName }: { firstName: string | null }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [category, setCategory] = useState<ExamInput["category"] | null>(null);
  const [customCategory, setCustomCategory] = useState("");
  const [name, setName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [targetScore, setTargetScore] = useState("");
  const [hours, setHours] = useState<number[]>([4, 2, 2, 2, 2, 2, 4]);
  const [times, setTimes] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString("en-CA");
  }, []);
  const weeklyHours = hours.reduce((s, h) => s + h, 0);

  const canContinue = [
    category !== null && (category !== "CUSTOM" || customCategory.trim().length > 1),
    name.trim().length > 1 && examDate >= tomorrow,
    weeklyHours >= 1,
    true,
  ][step];

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createExam({
        category: category!,
        customCategory: customCategory.trim() || undefined,
        name: name.trim(),
        examDate,
        targetScore: targetScore.trim() || undefined,
        weeklyMinutes: Object.fromEntries(hours.map((h, i) => [String(i), Math.round(h * 60)])),
        preferredTimes: times as ExamInput["preferredTimes"],
        learningStyles: styles,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div>
      <ol className="mb-8 flex gap-2" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <div className={cx("h-1 rounded-full", i <= step ? "bg-ink" : "bg-rule")} />
            <span className={cx("mt-1.5 block text-xs", i === step ? "font-bold text-ink" : "text-muted")}>
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h1 className="mb-2 text-3xl font-bold">{firstName ? `Hi ${firstName}, what` : "What"} are you preparing for?</h1>
          <p className="mb-6 text-muted">This shapes how your plan balances learning, practice and mock tests.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={category === c.value}
                onClick={() => setCategory(c.value)}
                className={cx(
                  "rounded-lg border p-4 text-left transition-colors",
                  category === c.value ? "border-ink bg-sky-soft" : "border-rule bg-sheet hover:border-ink-soft",
                )}
              >
                <span className="block font-bold">{c.label}</span>
                <span className="text-sm text-muted">{c.example}</span>
              </button>
            ))}
          </div>
          {category === "CUSTOM" && (
            <div className="mt-4">
              <Field label="What are you preparing for?" htmlFor="custom">
                <input id="custom" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} className={inputClass} maxLength={60} />
              </Field>
            </div>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="space-y-5">
          <div>
            <h1 className="mb-2 text-3xl font-bold">Tell us about the exam</h1>
            <p className="text-muted">Your plan works backwards from this date.</p>
          </div>
          <Field label="Exam name" htmlFor="name">
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="GATE CSE 2027" className={inputClass} maxLength={100} />
          </Field>
          <Field label="Exam date" htmlFor="date">
            <input id="date" type="date" min={tomorrow} value={examDate} onChange={(e) => setExamDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Target score or rank (optional)" htmlFor="target" hint="For example: 65+ marks, 99 percentile, or a CGPA of 9.">
            <input id="target" value={targetScore} onChange={(e) => setTargetScore(e.target.value)} className={inputClass} maxLength={60} />
          </Field>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <div>
            <h1 className="mb-2 text-3xl font-bold">How much time can you study?</h1>
            <p className="text-muted">Be realistic. Your plan never goes over these limits, and keeps 10% spare for bad days.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setHours([4, 2, 2, 2, 2, 2, 4])}>Weekdays 2h, weekends 4h</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setHours([6, 4, 4, 4, 4, 4, 6])}>Full-time prep</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setHours([3, 1, 1, 1, 1, 1, 3])}>Alongside college</Button>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="text-center">
                <span className="mb-1 block text-sm font-bold">{d}</span>
                <input
                  type="number"
                  min={0}
                  max={16}
                  step={0.5}
                  value={hours[i]}
                  aria-label={`Hours on ${d}`}
                  onChange={(e) => setHours(hours.map((h, j) => (j === i ? Math.min(16, Math.max(0, Number(e.target.value) || 0)) : h)))}
                  className={cx(inputBase, "px-1 text-center w-full py-2 text-[15px]")}
                />
                <span className="mt-1 block text-xs text-muted">hours</span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted">{weeklyHours} hours a week.</p>
          <Field label="When do you usually study?">
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => (
                <Chip key={t.value} selected={times.includes(t.value)} onClick={() => toggle(times, t.value, setTimes)}>
                  {t.label}
                </Chip>
              ))}
            </div>
          </Field>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-6">
          <div>
            <h1 className="mb-2 text-3xl font-bold">How do you learn best?</h1>
            <p className="text-muted">Pick any that apply. You'll tell us your level in each subject after we read your syllabus.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <Chip key={s} selected={styles.includes(s)} onClick={() => toggle(styles, s, setStyles)}>
                {s}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
          {error}
        </p>
      )}

      <div className="mt-10 flex justify-between gap-3">
        <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || pending} className={step === 0 ? "invisible" : ""}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep(step + 1)} disabled={!canContinue}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save and add materials"}
          </Button>
        )}
      </div>
    </div>
  );
}
