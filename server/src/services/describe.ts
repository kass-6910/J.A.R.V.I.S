import { formatDateTime, formatTime } from "../lib/time.js";
import type { Mail } from "./mails.js";
import type { DayPlan } from "./planning.js";
import type { Reminder } from "./reminders.js";
import type { Task } from "./tasks.js";

/** Descriptions en texte, données à Claude dans le contexte et les résultats d'outils. */

const PRIORITY_LABEL = { urgent: "urgente", high: "haute", normal: "normale", low: "basse" } as const;

export function describeTask(task: Task): string {
  const parts = [`${task.durationMin} min`, `priorité ${PRIORITY_LABEL[task.priority]}`];
  if (task.deadline) parts.push(`échéance ${formatDateTime(task.deadline)}`);
  if (task.notBefore) parts.push(`pas avant le ${task.notBefore}`);
  if (task.spaces.length > 0) parts.push(`espaces : ${task.spaces.join(", ")}`);
  return `- [${task.id}] ${task.title} (${parts.join(" ; ")})`;
}

const BLOCK_LABEL = { task: "tâche", prayer: "prière, créneau protégé", sport: "sport", meal: "repas" } as const;

export function describePlan(plan: DayPlan): string {
  const lines = [
    ...plan.events.map((e) => ({
      at: e.start.getTime(),
      text: e.allDay ? `toute la journée : ${e.title} (agenda)` : `${formatTime(e.start)}-${formatTime(e.end)} ${e.title} (agenda)`,
    })),
    ...plan.blocks.map((b) => ({
      at: b.startsAt.getTime(),
      text: `${formatTime(b.startsAt)}-${formatTime(b.endsAt)} ${b.title} (${BLOCK_LABEL[b.kind]})`,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((l) => `- ${l.text}`);

  const out = [`Planning du ${plan.day} :`, ...(lines.length > 0 ? lines : ["- rien de prévu"])];
  if (plan.unplaced.length > 0) {
    out.push("Ne rentrent pas dans la journée :", ...plan.unplaced.map((t) => `- ${t.title} (${t.durationMin} min)`));
  }
  if (plan.calendar === "not_configured") out.push("(Google Agenda n'est pas encore connecté.)");
  if (plan.calendar === "error") out.push("(Google Agenda est injoignable : les rendez-vous manquent.)");
  return out.join("\n");
}

const LEVEL_LABEL = { notification: "notification", iphone: "rappel iPhone", alarm: "alarme" } as const;

export function describeReminder(reminder: Reminder): string {
  return `- [${reminder.id}] ${formatDateTime(reminder.remindAt)} : ${reminder.title} (${LEVEL_LABEL[reminder.level]})`;
}

const IMPORTANCE_LABEL = { high: "important", normal: "normal", low: "peu important" } as const;

export function describeMail(mail: Mail): string {
  const parts = [
    mail.provider === "outlook" ? "boîte de l'école" : "Gmail",
    mail.importance ? IMPORTANCE_LABEL[mail.importance] : "pas encore trié",
  ];
  if (mail.needsReply) parts.push("réponse attendue");
  if (mail.spaces.length > 0) parts.push(`espaces : ${mail.spaces.join(", ")}`);
  if (mail.schoolEvent) {
    parts.push(`école : ${mail.schoolEvent.title}${mail.schoolEvent.date ? ` le ${mail.schoolEvent.date}` : ""}`);
  }
  if (mail.handledAt) parts.push("traité");
  return `- [${mail.id}] ${formatDateTime(mail.receivedAt)}, de ${mail.fromName} : ${mail.summary ?? mail.subject} (${parts.join(" ; ")})`;
}
