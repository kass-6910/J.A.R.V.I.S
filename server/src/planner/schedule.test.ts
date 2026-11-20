import { describe, expect, it } from "vitest";
import { orderTasks, planDay, type PlannableTask } from "./schedule.js";

const H = 3_600_000;
const day = Date.UTC(2026, 10, 20);
const at = (hour: number) => day + hour * H;

let seq = 0;
function task(id: string, over: Partial<PlannableTask> = {}): PlannableTask {
  return {
    id,
    durationMin: 60,
    priority: "normal",
    deadline: null,
    beforeTaskId: null,
    createdAt: new Date(day + seq++),
    ...over,
  };
}

describe("orderTasks", () => {
  it("trie par priorité, puis échéance, puis ancienneté", () => {
    const tasks = [
      task("vieille"),
      task("echeance", { deadline: new Date(at(30)) }),
      task("urgente", { priority: "urgent" }),
      task("basse", { priority: "low" }),
    ];
    expect(orderTasks(tasks).map((t) => t.id)).toEqual(["urgente", "echeance", "vieille", "basse"]);
  });

  it("applique « ça passe avant » même contre la priorité", () => {
    const tasks = [task("rendu", { priority: "high" }), task("fournisseur", { beforeTaskId: "rendu" })];
    expect(orderTasks(tasks).map((t) => t.id)).toEqual(["fournisseur", "rendu"]);
  });

  it("ne boucle pas sur des consignes contradictoires", () => {
    const tasks = [task("a", { beforeTaskId: "b" }), task("b", { beforeTaskId: "a" })];
    expect(orderTasks(tasks)).toHaveLength(2);
  });
});

describe("planDay", () => {
  const window = { start: at(8), end: at(12) };

  it("place les tâches autour des rendez-vous", () => {
    const { placed, unplaced } = planDay({
      window,
      now: at(6),
      busy: [{ start: at(9), end: at(10) }],
      tasks: [task("a"), task("b", { durationMin: 30 })],
    });
    expect(unplaced).toEqual([]);
    expect(placed.map((p) => [p.task.id, p.start, p.end])).toEqual([
      ["a", at(8), at(9)],
      ["b", at(10), at(10.5)],
    ]);
  });

  it("ne place rien dans le passé et arrondit aux 5 minutes", () => {
    const { placed } = planDay({ window, now: at(9) + 61_000, busy: [], tasks: [task("a")] });
    expect(placed[0]?.start).toBe(at(9) + 5 * 60_000);
  });

  it("laisse une pause entre deux tâches", () => {
    const { placed } = planDay({ window, now: at(6), busy: [], tasks: [task("a"), task("b")] });
    expect(placed[1]?.start).toBe(at(9) + 5 * 60_000);
  });

  it("signale les tâches qui ne rentrent pas", () => {
    const { placed, unplaced } = planDay({
      window,
      now: at(6),
      busy: [{ start: at(8), end: at(11.5) }],
      tasks: [task("longue", { durationMin: 120 }), task("courte", { durationMin: 20 })],
    });
    expect(placed.map((p) => p.task.id)).toEqual(["courte"]);
    expect(unplaced.map((t) => t.id)).toEqual(["longue"]);
  });
});
