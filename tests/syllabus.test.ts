import { describe, expect, it } from "vitest";
import { parseSyllabusText } from "@/lib/syllabus/heuristic";
import { topicKey } from "@/lib/syllabus/normalize";
import { countMentions, questionKeys } from "@/lib/pyq/frequency";
import { chunkPages } from "@/lib/documents/chunk";

describe("topic keys", () => {
  it("treats spelling variants as the same concept", () => {
    expect(topicKey("Binary Search")).toBe(topicKey("Binary search algorithm"));
    expect(topicKey("Binary Searching")).toBe(topicKey("binary search"));
    expect(topicKey("Process Scheduling")).not.toBe(topicKey("Disk Scheduling"));
  });
});

describe("syllabus parser", () => {
  it("reads a university-style syllabus", () => {
    const draft = parseSyllabusText(
      `OPERATING SYSTEMS
UNIT I: Introduction: Operating system services, system calls, process concept.
UNIT II Process Management
- Process scheduling, CPU scheduling algorithms, threads
- Process synchronization; semaphores; deadlocks
Text Books
1. Galvin, Operating System Concepts`,
      "My Exam",
    );
    expect(draft.subjects).toHaveLength(1);
    expect(draft.subjects[0].name).toBe("Operating Systems");
    const names = draft.subjects[0].topics.map((t) => t.name);
    expect(names).toContain("Process scheduling");
    expect(names).toContain("Semaphores");
    expect(names.join(" ")).not.toMatch(/Galvin/);
    expect(draft.subjects[0].topics.find((t) => t.name === "Semaphores")?.chapter).toBe("Process Management");
  });

  it("reads a GATE-style section list and merges duplicates", () => {
    const draft = parseSyllabusText(
      `Section 1: Algorithms
Searching: Binary search, linear search.
Graph algorithms: BFS, DFS, shortest paths, Binary searching
Section 2: Databases
ER model, Relational model, Normalization`,
      "GATE",
    );
    expect(draft.subjects.map((s) => s.name)).toEqual(["Algorithms", "Databases"]);
    const algo = draft.subjects[0].topics;
    expect(algo.filter((t) => topicKey(t.name) === topicKey("binary search"))).toHaveLength(1);
    expect(algo.find((t) => t.name === "Binary search")?.aliases).toContain("Binary searching");
  });
});

describe("PYQ frequency", () => {
  it("counts questions mentioning a topic or its alias", () => {
    const keys = questionKeys([
      `Q1. Explain round robin scheduling with an example.
Q2. What is a deadlock? State the necessary conditions.
Q3. Compare FCFS and Round-Robin scheduling.
Q4. Explain binary searching on a sorted array.`,
    ]);
    expect(countMentions(keys, ["Round Robin"])).toBe(2);
    expect(countMentions(keys, ["Deadlocks"])).toBe(1);
    expect(countMentions(keys, ["Binary Search"])).toBe(1);
  });
});

describe("chunking", () => {
  it("keeps page numbers and never crosses pages", () => {
    const chunks = chunkPages([{ page: 1, text: "a".repeat(1000) + "\n\n" + "b".repeat(1000) }, { page: 2, text: "c" }]);
    expect(chunks.map((c) => c.page)).toEqual([1, 1, 2]);
  });
});

describe("syllabus parser titles", () => {
  it("does not turn the document title into a topic", () => {
    const draft = parseSyllabusText("GATE Computer Science — Syllabus\nUnit 1: Basics: Arrays, Stacks, Queues", "GATE");
    const names = draft.subjects.flatMap((s) => s.topics.map((t) => t.name));
    expect(names).toEqual(["Arrays", "Stacks", "Queues"]);
  });
});

import { guessCategory } from "@/lib/documents/categorize";

describe("file categories from names", () => {
  it.each([
    ["GATE_CSE_Syllabus_2027.pdf", "SYLLABUS"],
    ["OS_pyq.pdf", "PYQ"],
    ["DBMS previous year questions.pdf", "PYQ"],
    ["gate-2023-paper.pdf", "PYQ"],
    ["2019.pdf", "PYQ"],
    ["EndSem May 2024.pdf", "PYQ"],
    ["DSA Question Bank.pdf", "QUESTION_BANK"],
    ["OS short notes.pdf", "REVISION_NOTES"],
    ["Formula sheet.pdf", "REVISION_NOTES"],
    ["Cormen 3rd edition.pdf", "TEXTBOOK"],
    ["DBMS Unit 3.pdf", "NOTES"],
    ["Lecture7-Paging.pdf", "NOTES"],
    ["random scan.pdf", "NOTES"],
  ])("%s → %s", (name, expected) => {
    expect(guessCategory(name)).toBe(expected);
  });
});

import { classifyDocument } from "@/lib/documents/classify";

const PYQ = `B.Tech (CSE) End Semester Examination, May 2024
Operating Systems (CS-302)
Time: 3 Hours                         Maximum Marks: 70
Roll No. ............
Note: Attempt any five questions. All questions carry equal marks.
Section A
Q1. Explain process scheduling with a Gantt chart. (7 marks)
Q2. What is a deadlock? State the four necessary conditions. (7 marks)
Section B
Q3. Compare paging and segmentation. (7 marks)
Q4. Explain the readers-writers problem using semaphores. (7 marks)`;

const SYLLABUS = `Course Code: CS-302   Operating Systems   L-T-P: 3-1-0   Credits: 4
Course Outcomes
CO1: Understand process management.
Unit 1: Introduction, system calls, processes and threads
Unit 2: CPU scheduling, synchronization, deadlocks
Unit 3: Memory management, paging, virtual memory
Unit 4: File systems and disk scheduling
Text Books: Silberschatz, Operating System Concepts`;

const TEXTBOOK = `Operating System Concepts, Tenth Edition
Copyright © 2018 John Wiley & Sons. All rights reserved.
ISBN 978-1-119-32091-3
Preface
Chapter 1 Introduction ... Chapter 2 Operating-System Structures ... Chapter 3 Processes
Exercises 1.1 ... Exercises 2.1`;

const NOTES = `Lecture 7: Paging
Prepared by the course instructor
Definition: paging divides memory into fixed-size frames. For example, a 4 KB page size...
Example: logical address 0x1234. Definition: a page table maps pages to frames.
Example: TLB hits avoid the page table walk. For example, with 90% hit ratio...`;

const QB = `Unit-wise Question Bank: Data Structures
${Array.from({ length: 30 }, (_, i) => `${i + 1}. Explain the time complexity of operation ${i + 1}.`).join("\n")}`;

const REVISION = `Quick revision: important formulas
${Array.from({ length: 30 }, (_, i) => `• Formula ${i + 1}: T(n) = aT(n/b) + f(n)`).join("\n")}`;

describe("document type from content", () => {
  it.each([
    ["IMG_2041.pdf", PYQ, 2, "PYQ"],
    ["Document (3).pdf", SYLLABUS, 2, "SYLLABUS"],
    ["scan.pdf", TEXTBOOK, 420, "TEXTBOOK"],
    ["file.pdf", NOTES, 12, "NOTES"],
    ["download.pdf", QB, 6, "QUESTION_BANK"],
    ["new.pdf", REVISION, 3, "REVISION_NOTES"],
  ])("%s → %s", (filename, text, pageCount, expected) => {
    const r = classifyDocument({ text, pageCount, filename });
    expect(r.category).toBe(expected);
    expect(r.confident).toBe(true);
  });

  it("explains its decision", () => {
    const r = classifyDocument({ text: PYQ, pageCount: 2, filename: "IMG_2041.pdf" });
    expect(r.reasons).toContain("shows maximum marks");
  });

  it("is not confident about near-empty text", () => {
    expect(classifyDocument({ text: "hello", pageCount: 1, filename: "a.pdf" }).confident).toBe(false);
  });
});
