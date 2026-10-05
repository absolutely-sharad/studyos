import { afterEach, describe, expect, it, vi } from "vitest";
import { enterUpload, uploadsInProgress } from "@/lib/documents/upload-gate";

afterEach(() => vi.unstubAllEnvs());

describe("the per-account upload limit", () => {
  it("lets one account have half of the slots at once (2 of the default 4) and no more", () => {
    const first = enterUpload("student-a");
    const second = enterUpload("student-a");
    expect(first).toBeTypeOf("function");
    expect(second).toBeTypeOf("function");
    expect(enterUpload("student-a")).toBeNull();
    expect(uploadsInProgress("student-a")).toBe(2);
    first!();
    second!();
  });

  it("gives the slot back when an upload finishes, and counting is per account", () => {
    const a1 = enterUpload("student-b")!;
    const a2 = enterUpload("student-b")!;
    expect(enterUpload("student-b")).toBeNull();
    const other = enterUpload("student-c"); // another student is not affected
    expect(other).toBeTypeOf("function");
    a1();
    const again = enterUpload("student-b");
    expect(again).toBeTypeOf("function");
    for (const done of [a2, again!, other!]) done();
    expect(uploadsInProgress("student-b")).toBe(0);
    expect(uploadsInProgress("student-c")).toBe(0);
  });

  it("releasing twice can't free someone else's slot", () => {
    const a1 = enterUpload("student-d")!;
    const a2 = enterUpload("student-d")!;
    a1();
    a1(); // a buggy double release
    expect(uploadsInProgress("student-d")).toBe(1);
    expect(enterUpload("student-d")).toBeTypeOf("function"); // one slot really was free
    expect(enterUpload("student-d")).toBeNull(); // and the double release did not create another
    a2();
  });

  it("follows UPLOAD_CONCURRENCY (half, rounded up, at least 1)", () => {
    vi.stubEnv("UPLOAD_CONCURRENCY", "1");
    const only = enterUpload("student-e");
    expect(only).toBeTypeOf("function");
    expect(enterUpload("student-e")).toBeNull();
    only!();
    vi.stubEnv("UPLOAD_CONCURRENCY", "7");
    const held = [enterUpload("student-f"), enterUpload("student-f"), enterUpload("student-f"), enterUpload("student-f")];
    expect(held.every((h) => typeof h === "function")).toBe(true); // ceil(7 / 2) = 4
    expect(enterUpload("student-f")).toBeNull();
    held.forEach((h) => h!());
  });
});
