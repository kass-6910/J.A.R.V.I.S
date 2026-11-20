import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DateTime } from "luxon";
import { isNotifyConfigured } from "../connectors/notifications/ntfy.js";
import { z } from "zod";
import { SPACE_SLUGS } from "../db/client.js";
import { PRIORITIES } from "../db/schema.js";
import { REMINDER_LEVELS } from "../db/schema.js";
import { formatDateTime, now, parseDateTime, parseDay, zone } from "../lib/time.js";
import { logExecuted, requestValidation } from "../services/actions.js";
import { findBriefing, generateBriefing, latestBriefing } from "../services/briefing.js";
import { describePlan, describeReminder, describeTask } from "../services/describe.js";
import { getDayPlan, replanToday } from "../services/planning.js";
import { createReminder, getReminder, listUpcomingReminders } from "../services/reminders.js";
import {
  completeTask,
  createTask,
  getTask,
  listOpenTasks,
  prioritizeTask,
  updateTask,
} from "../services/tasks.js";

/** État courant donné à Claude avec chaque demande. */
export async function describeContext(): Promise<string> {
  const [open, plan, reminders] = await Promise.all([listOpenTasks(), getDayPlan(now()), listUpcomingReminders()]);
  return [
      `Nous sommes ${now().setLocale("fr").toFormat("cccc d LLLL yyyy, HH:mm")}.`,
      "Tâches à faire, dans l'ordre de traitement :",
      ...(open.length > 0 ? open.map(describeTask) : ["- aucune"]),
      describePlan(plan),
      "Rappels à venir :",
      ...(reminders.length > 0 ? reminders.map(describeReminder) : ["- aucun"]),
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

  /** Rappel que le Raccourci doit créer sur l'iPhone (app Rappels ou Horloge). */
  export interface DeviceReminder {
    titre: string;
    /** Date et heure ISO 8601 avec décalage horaire. */
    date: string;
    /** Heure seule (HH:mm), pour l'action « Créer une alarme ». */
    heure: string;
    type: "rappel" | "alarme";
  }

  export interface Session {
    /** Le client sait créer un rappel iPhone ou une alarme (Raccourci « Jarvis » à jour). */
    deviceCanCreate: boolean;
    /** Rappels à renvoyer au Raccourci dans la réponse. */
    deviceReminders: DeviceReminder[];
  }

  /** Outils donnés à Claude pour une demande. */
  export function buildTools(session: Session) {
    return [
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
    betaZodTool({
      name: "create_reminder",
      description: `Programme un rappel (« rappelle-moi ça demain à 9 h »). Choix du niveau :
  - iphone : par défaut pour un rappel demandé par Jessim ; créé dans l'app Rappels de l'iPhone, il marche même si le serveur est éteint ;
  - alarm : quand Jessim dit « réveille-moi » ou « c'est urgent » ; crée une alarme qui sonne ;
  - notification : pour un petit rappel sans importance, envoyé par le serveur.
  Si l'appareil ne peut pas créer de rappel iPhone, le serveur envoie une notification à la place ; le résultat de l'outil le précise.`,
      inputSchema: z.object({
        title: z.string().min(1).describe("Ce dont il faut se souvenir, formulé pour être lu tel quel."),
        at: z.string().describe("Date et heure ISO 8601, heure de Paris, par exemple 2026-11-21T09:00."),
        level: z.enum(REMINDER_LEVELS),
      }),
      run: async (input) => {
        const reminder = await createReminder({
          title: input.title,
          remindAt: parseDateTime(input.at),
          level: input.level,
          deviceCanCreate: session.deviceCanCreate,
        });
        const when = formatDateTime(reminder.remindAt);
        await logExecuted("create_reminder", input, `Rappel : ${input.title}, ${when}`);
        if (reminder.status === "on_device") {
          const at = DateTime.fromJSDate(reminder.remindAt, { zone });
          session.deviceReminders.push({
            titre: reminder.title,
            date: at.toISO({ suppressMilliseconds: true })!,
            heure: at.toFormat("HH:mm"),
            type: reminder.level === "alarm" ? "alarme" : "rappel",
          });
          return `${reminder.level === "alarm" ? "Alarme" : "Rappel iPhone"} créé(e) par l'iPhone pour ${when}.`;
        }
        const fallback = input.level !== "notification" ? " (cet appareil ne peut pas créer de rappel iPhone : notification à la place)" : "";
        return isNotifyConfigured()
          ? `Notification programmée pour ${when}${fallback}.`
          : `Rappel enregistré pour ${when}, mais les notifications ne sont pas encore configurées sur le serveur : préviens Jessim qu'il ne le recevra pas.`;
      },
    }),
    betaZodTool({
      name: "cancel_reminder",
      description:
        "Demande l'annulation d'un rappel. Comme une suppression, elle est mise en attente et Jessim la valide dans l'application. Un rappel déjà créé sur l'iPhone doit aussi être supprimé de l'app Rappels par Jessim.",
      inputSchema: z.object({
        reminder_id: z.string().uuid().describe("Identifiant du rappel, entre crochets dans le contexte."),
      }),
      run: async (input) => {
        const reminder = await getReminder(input.reminder_id);
        await requestValidation("cancel_reminder", input, `Annuler le rappel « ${reminder.title} » (${formatDateTime(reminder.remindAt)})`);
        const device = reminder.status === "on_device" ? " Il est aussi dans l'app Rappels de l'iPhone : à supprimer là-bas." : "";
        return `Annulation de « ${reminder.title} » en attente : Jessim doit la valider dans l'application.${device}`;
      },
    }),
    betaZodTool({
      name: "get_briefing",
      description:
        "Donne le dernier briefing du jour (briefing du matin ou bilan du soir). S'il n'existe pas encore, le rédige. Quand Jessim demande son briefing ou son bilan, renvoie le texte tel quel, en entier : c'est la seule exception à la règle des réponses courtes.",
      inputSchema: z.object({
        kind: z.enum(["morning", "evening"]).optional().describe("Forcer le briefing du matin ou le bilan du soir. Sinon, le plus récent."),
      }),
      run: async (input) => {
        const today = now().startOf("day");
        if (input.kind) return ((await findBriefing(input.kind, today)) ?? (await generateBriefing(input.kind, today))).text;
        const latest = await latestBriefing(today);
        return (latest ?? (await generateBriefing("morning", today))).text;
      },
    }),
  ];
}
