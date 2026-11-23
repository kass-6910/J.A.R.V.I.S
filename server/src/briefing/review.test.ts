import { describe, expect, it } from "vitest";
import { describeReview, reviewPeriod, spokenDuration, type ReviewTask } from "./review.js";

const from = new Date("2026-11-19T00:00:00+01:00");
const to = new Date("2026-11-20T00:00:00+01:00");

function task(id: string, over: Partial<ReviewTask> = {}): ReviewTask {
  return { id, title: id, status: "todo", durationMin: 30, actualMin: null, completedAt: null, ...over };
}

describe("reviewPeriod", () => {
  it("sépare les tâches faites dans la période et celles prévues mais pas faites", () => {
    const review = reviewPeriod({
      from,
      to,
      tasks: [
        task("faite-hier", { status: "done", completedAt: new Date("2026-11-19T10:00:00+01:00") }),
        task("faite-avant", { status: "done", completedAt: new Date("2026-11-18T10:00:00+01:00") }),
        task("ratee"),
        task("pas-prevue"),
      ],
      blocks: [{ taskId: "ratee" }, { taskId: "faite-hier" }, { taskId: null }],
    });
    expect(review.done.map((t) => t.id)).toEqual(["faite-hier"]);
    expect(review.missed.map((t) => t.id)).toEqual(["ratee"]);
    expect(review.timing).toBeNull();
  });

  it("cumule le temps prévu et réel quand il est connu", () => {
    const done = { status: "done" as const, completedAt: new Date("2026-11-19T12:00:00+01:00") };
    const review = reviewPeriod({
      from,
      to,
      tasks: [
        task("a", { ...done, durationMin: 60, actualMin: 90 }),
        task("b", { ...done, durationMin: 30, actualMin: 30 }),
        task("c", { ...done, durationMin: 45 }),
      ],
      blocks: [],
    });
    expect(review.timing).toEqual({ count: 2, plannedMin: 90, actualMin: 120 });
    expect(describeReview("Hier", review).at(-1)).toContain("30 min de plus que prévu");
  });
});

describe("spokenDuration", () => {
  it("écrit les durées comme on les dit", () => {
    expect(spokenDuration(45)).toBe("45 min");
    expect(spokenDuration(120)).toBe("2 h");
    expect(spokenDuration(95)).toBe("1 h 35");
  });
});
