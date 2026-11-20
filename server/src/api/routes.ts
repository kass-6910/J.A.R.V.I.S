import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ask } from "../brain/index.js";
import { db, SPACE_SLUGS } from "../db/client.js";
import { PRIORITIES } from "../db/schema.js";
import { now, parseDateTime, parseDay } from "../lib/time.js";
import { sendNotification } from "../connectors/notifications/ntfy.js";
import { listPendingActions, resolveAction } from "../services/actions.js";
import { generateBriefing, latestBriefing, listBriefings } from "../services/briefing.js";
import { cancelReminder, listUpcomingReminders } from "../services/reminders.js";
import { getDayPlan, replanToday } from "../services/planning.js";
import {
  completeTask,
  createTask,
  deleteTask,
  listDoneTasks,
  listOpenTasks,
  reopenTask,
  updateTask,
} from "../services/tasks.js";

const idParams = z.object({ id: z.string().uuid() });

const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  durationMin: z.number().int().min(5).max(480).optional(),
  priority: z.enum(PRIORITIES).optional(),
  deadline: z.string().nullable().optional(),
  spaces: z.array(z.enum(SPACE_SLUGS)).optional(),
});

function toTaskInput<T extends Partial<z.infer<typeof taskBody>>>(body: T) {
  const { deadline, ...rest } = body;
  return { ...rest, ...(deadline !== undefined && { deadline: deadline ? parseDateTime(deadline) : null }) };
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  /** Point d'entrée de la voix : le Raccourci envoie { message } et lit { reponse }. */
  app.post("/jarvis", async (req, reply) => {
    const body = z
      .object({
        message: z.string().trim().min(1).max(4000),
        /** Le Raccourci à jour envoie true : il crée lui-même les rappels iPhone et les alarmes. */
        rappels_sur_iphone: z.boolean().optional(),
      })
      .parse(req.body);
    try {
      const answer = await ask(body.message, { deviceCanCreate: body.rappels_sur_iphone === true });
      return { reponse: answer.reply, rappels: answer.deviceReminders };
    } catch (err) {
      // Le Raccourci lit « reponse » à voix haute : même en cas de panne, Jessim entend ce qui se passe.
      req.log.error(err);
      return reply.code(502).send({
        error: "Le cerveau de Jarvis est indisponible.",
        reponse: "Je n'arrive pas à réfléchir pour l'instant, réessaie dans un instant.",
        rappels: [],
      });
    }
  });

  app.get("/spaces", () => db.query.spaces.findMany({ orderBy: (s, { asc }) => asc(s.position) }));

  app.get("/tasks", async () => ({ open: await listOpenTasks(), done: await listDoneTasks() }));

  app.post("/tasks", async (req, reply) => {
    const task = await createTask(toTaskInput(taskBody.parse(req.body)));
    await replanToday();
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    const task = await updateTask(id, toTaskInput(taskBody.partial().parse(req.body)));
    await replanToday();
    return task;
  });

  app.post("/tasks/:id/complete", async (req) => {
    const { id } = idParams.parse(req.params);
    const { actualMin } = z.object({ actualMin: z.number().int().min(1).optional() }).parse(req.body ?? {});
    const task = await completeTask(id, actualMin);
    await replanToday();
    return task;
  });

  app.post("/tasks/:id/reopen", async (req) => {
    const { id } = idParams.parse(req.params);
    const task = await reopenTask(id);
    await replanToday();
    return task;
  });

  // Supprimer depuis l'application est un geste de Jessim lui-même : pas de mise en attente.
  app.delete("/tasks/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await deleteTask(id);
    await replanToday();
    return reply.code(204).send();
  });

  app.get("/planning", async (req) => {
    const { date } = z.object({ date: z.string().optional() }).parse(req.query);
    return getDayPlan(date ? parseDay(date) : now());
  });

  app.post("/planning/replan", () => replanToday());

  app.get("/reminders", () => listUpcomingReminders());

  // Annuler depuis l'application est un geste de Jessim lui-même : pas de mise en attente.
  app.delete("/reminders/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await cancelReminder(id);
    return reply.code(204).send();
  });

  /** Pour le Raccourci « Briefing » : le dernier briefing du jour, rédigé s'il n'existe pas encore. */
  app.get("/briefing", async () => {
    const today = now().startOf("day");
    const briefing = (await latestBriefing(today)) ?? (await generateBriefing("morning", today));
    return { reponse: briefing.text, ...briefing };
  });

  app.get("/briefings", () => listBriefings());

  /** Rédige maintenant le briefing ou le bilan du jour (le remplace s'il existe). */
  app.post("/briefings/:kind", async (req) => {
    const { kind } = z.object({ kind: z.enum(["morning", "evening"]) }).parse(req.params);
    return generateBriefing(kind);
  });

  app.post("/notifications/test", async () => {
    await sendNotification({ title: "Jarvis", message: "Les notifications fonctionnent.", tags: ["white_check_mark"] });
    return { ok: true };
  });

  app.get("/actions/pending", () => listPendingActions());

  app.post("/actions/:id/:decision", async (req) => {
    const { id, decision } = idParams.extend({ decision: z.enum(["confirm", "reject"]) }).parse(req.params);
    const action = await resolveAction(id, decision === "confirm" ? "confirmed" : "rejected");
    await replanToday();
    return action;
  });
}
