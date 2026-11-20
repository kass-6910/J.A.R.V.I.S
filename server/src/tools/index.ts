import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SPACE_SLUGS } from "../db/client.js";
import { PRIORITIES } from "../db/schema.js";
import { formatDateTime, formatTime, now, parseDateTime, parseDay } from "../lib/time.js";
import { logExecuted, requestValidation } from "../services/actions.js";
import { getDayPlan, replanToday, type DayPlan } from "../services/planning.js";
import {
  completeTask,
  createTask,
  getTask,
  listOpenTasks,
  prioritizeTask,
  updateTask,
  type Task,
} from "../services/tasks.js";

const PRIORITY_LABEL = { urgent: "urgente", high: "haute", normal: "normale", low: "basse" } as const;

export function describeTask(task: Task): string {
  const parts = [`${task.durationMin} min`, `priorité ${PRIORITY_LABEL[task.priority]}`];
  if (task.deadline) parts.push(`échéance ${formatDateTime(task.deadline)}`);
  if (task.spaces.length > 0) parts.push(`espaces : ${task.spaces.join(", ")}`);
  return `- [${task.id}] ${task.title} (${parts.join(" ; ")})`;
}

export function describePlan(plan: DayPlan): string {
  const lines = [
    ...plan.events.map((e) => ({
      at: e.start.getTime(),
      text: e.allDay ? `toute la journée : ${e.title} (agenda)` : `${formatTime(e.start)}-${formatTime(e.end)} ${e.title} (agenda)`,
    })),
    ...plan.blocks.map((b) => ({
      at: b.startsAt.getTime(),
      text: `${formatTime(b.startsAt)}-${formatTime(b.endsAt)} ${b.title} (tâche)`,
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((l) => `- ${l.text}`);

  const out = [`Planning du ${plan.day} :`, ...(lines.length > 0 ? lines : ["- rien de prévu"])];
  if (plan.unplaced.length > 0) {
    out.push("Ne rentrent pas aujourd'hui :", ...plan.unplaced.map((t) => `- ${t.title} (${t.durationMin} min)`));
  }
  if (plan.calendar === "not_configured") out.push("(Google Agenda n'est pas encore connecté.)");
  if (plan.calendar === "error") out.push("(Google Agenda est injoignable : les rendez-vous manquent.)");
  return out.join("\n");
}

/** État courant donné à Claude avec chaque demande. */
export async function describeContext(): Promise<string> {
  const [open, plan] = await Promise.all([listOpenTasks(), getDayPlan(now())]);
  return [
    `Nous sommes ${now().setLocale("fr").toFormat("cccc d LLLL yyyy, HH:mm")}.`,
    "Tâches à faire, dans l'ordre de traitement :",
    ...(open.length > 0 ? open.map(describeTask) : ["- aucune"]),
    describePlan(plan),
  ].join("\n");
}

const taskId = z.string().uuid().describe("Identifiant de la tâche, tel qu'il apparaît entre crochets dans le contexte.");
const duration = z.number().int().min(5).max(480).describe("Durée estimée en minutes.");
const priority = z.enum(PRIORITIES);
const deadline = z.string().describe("Échéance au format ISO 8601, heure de Paris, par exemple 2026-11-21T18:00.");
const spaces = z
  .array(z.enum(SPACE_SLUGS))
  .describe("Espace(s) de la tâche. Plusieurs si elle en concerne plusieurs à la fois.");

async function afterChange(tool: string, input: unknown, summary: string): Promise<string> {
  await logExecuted(tool, input, summary);
  return `${summary}\n${describePlan(await replanToday())}`;
}

export const tools = [
  betaZodTool({
    name: "create_task",
    description:
      "Crée une tâche et recale la journée. À utiliser dès que Jessim demande de noter ou de prévoir quelque chose à faire.",
    inputSchema: z.object({
      title: z.string().min(1).describe("Titre court, à l'infinitif."),
      duration_min: duration.optional().describe("Durée estimée en minutes. À estimer si Jessim ne la donne pas."),
      priority: priority.optional(),
      deadline: deadline.optional(),
      spaces,
    }),
    run: async (input) => {
      const task = await createTask({
        title: input.title,
        durationMin: input.duration_min,
        priority: input.priority,
        deadline: input.deadline ? parseDateTime(input.deadline) : undefined,
        spaces: input.spaces,
      });
      return afterChange("create_task", input, `Tâche créée : ${describeTask(task)}`);
    },
  }),
  betaZodTool({
    name: "update_task",
    description: "Modifie une tâche existante (titre, durée, priorité, échéance, espaces) et recale la journée.",
    inputSchema: z.object({
      task_id: taskId,
      title: z.string().min(1).optional(),
      duration_min: duration.optional(),
      priority: priority.optional(),
      deadline: deadline.nullable().optional().describe("Nouvelle échéance ISO 8601, ou null pour la retirer."),
      spaces: spaces.optional(),
    }),
    run: async (input) => {
      const task = await updateTask(input.task_id, {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.duration_min !== undefined && { durationMin: input.duration_min }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.deadline !== undefined && { deadline: input.deadline ? parseDateTime(input.deadline) : null }),
        ...(input.spaces !== undefined && { spaces: input.spaces }),
      });
      return afterChange("update_task", input, `Tâche modifiée : ${describeTask(task)}`);
    },
  }),
  betaZodTool({
    name: "complete_task",
    description: "Marque une tâche comme faite et recale le reste de la journée.",
    inputSchema: z.object({
      task_id: taskId,
      actual_min: z.number().int().min(1).optional().describe("Temps réellement passé, si Jessim le dit."),
    }),
    run: async (input) => {
      const task = await completeTask(input.task_id, input.actual_min);
      return afterChange("complete_task", input, `Tâche faite : ${task.title}`);
    },
  }),
  betaZodTool({
    name: "prioritize_task",
    description:
      "Fait passer une tâche avant une autre (« ça, c'est prioritaire sur le rendu de l'école ») et recale la journée.",
    inputSchema: z.object({
      task_id: taskId.describe("Tâche qui doit passer en premier."),
      before_task_id: taskId.describe("Tâche qui passe après."),
    }),
    run: async (input) => {
      await prioritizeTask(input.task_id, input.before_task_id);
      const [first, second] = await Promise.all([getTask(input.task_id), getTask(input.before_task_id)]);
      return afterChange("prioritize_task", input, `« ${first.title} » passe avant « ${second.title} ».`);
    },
  }),
  betaZodTool({
    name: "delete_task",
    description:
      "Demande la suppression d'une tâche. La suppression n'a PAS lieu tout de suite : elle est mise en attente et Jessim la valide dans l'application.",
    inputSchema: z.object({ task_id: taskId }),
    run: async (input) => {
      const task = await getTask(input.task_id);
      await requestValidation("delete_task", input, `Supprimer la tâche « ${task.title} »`);
      return `Suppression de « ${task.title} » en attente : Jessim doit la valider dans l'application.`;
    },
  }),
  betaZodTool({
    name: "get_planning",
    description:
      "Donne les rendez-vous et les créneaux d'un autre jour qu'aujourd'hui. Le planning d'aujourd'hui est déjà dans le contexte.",
    inputSchema: z.object({ date: z.string().describe("Jour au format AAAA-MM-JJ.") }),
    run: async (input) => describePlan(await getDayPlan(parseDay(input.date))),
  }),
];
