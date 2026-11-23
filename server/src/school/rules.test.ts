import { describe, expect, it } from "vitest";
import { examReminderDue, isExamTitle, revisionDays, sameExam } from "./rules.js";

describe("isExamTitle", () => {
  it("reconnaît un examen dans l'agenda", () => {
    expect(isExamTitle("Partiel de gestion financière")).toBe(true);
    expect(isExamTitle("DS de compta")).toBe(true);
    expect(isExamTitle("Soutenance du projet")).toBe(true);
    expect(isExamTitle("Cours de gestion")).toBe(false);
    expect(isExamTitle("Dossier à rendre")).toBe(false);
  });
});

describe("revisionDays", () => {
  it("espace les révisions avant l'examen", () => {
    expect(revisionDays("2026-12-03", "2026-11-20", 4)).toEqual(["2026-11-27", "2026-11-29", "2026-12-01", "2026-12-02"]);
  });

  it("resserre quand l'examen approche, sans jamais revenir dans le passé", () => {
    expect(revisionDays("2026-11-24", "2026-11-21", 4)).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(revisionDays("2026-11-20", "2026-11-20", 3)).toEqual([]);
  });
});

describe("examReminderDue", () => {
  it("prévient 3 jours avant, la veille et le jour même", () => {
    expect(examReminderDue("2026-12-03", "2026-11-30")).toBe("j-3");
    expect(examReminderDue("2026-12-03", "2026-12-02")).toBe("j-1");
    expect(examReminderDue("2026-12-03", "2026-12-03")).toBe("jour");
    expect(examReminderDue("2026-12-03", "2026-12-01")).toBeNull();
  });
});

describe("sameExam", () => {
  it("rapproche le même examen venu du mail et de l'agenda", () => {
    const mail = { title: "Examen de gestion financière", day: "2026-12-03" };
    expect(sameExam(mail, { title: "Partiel gestion financiere", day: "2026-12-03" })).toBe(true);
    expect(sameExam(mail, { title: "Partiel de droit", day: "2026-12-03" })).toBe(false);
    expect(sameExam(mail, { title: "Partiel gestion financière", day: "2026-12-04" })).toBe(false);
  });
});
