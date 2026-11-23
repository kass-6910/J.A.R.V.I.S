import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ask } from "../brain/index.js";
import { db, SPACE_SLUGS } from "../db/client.js";
import { PRIORITIES } from "../db/schema.js";
import { now, parseDateTime, parseDay, zone } from "../lib/time.js";
import { sendNotification } from "../connectors/notifications/ntfy.js";
import { listPendingActions, resolveAction } from "../services/actions.js";
import { generateBriefing, latestBriefing, listBriefings } from "../services/briefing.js";
import { checkMailboxes, getMail, listMails, mailStatus, setMailHandled } from "../services/mails.js";
import { getDailyHadith, getPrayerTimes } from "../services/prayer.js";
import { checkManageo, isManageoConfigured, shopStatuses } from "../services/manageo.js";
import {
  contactNews,
  listAdminDeadlines,
  listCareItems,
  listContacts,
  listRoutines,
  markAdminDone,
  markCareDone,
  markContacted,
  markSupplementTaken,
  removeAdminDeadline,
  removeCareItem,
  removeContact,
  removeSupplement,
  todaySupplements,
} from "../services/life.js";
import { addShoppingItem, listShopping, removeShoppingItem, setShoppingChecked } from "../services/shopping.js";
import { getMeals, regenerateMeals, todayTarget } from "../services/meals.js";
import {
  addExpense,
  addReceipt,
  addSubscription,
  getExpense,
  listExpenses,
  listSubscriptions,
  monthBudget,
  removeExpense,
  removeSubscription,
} from "../services/budget.js";
import { EXPENSE_CATEGORIES, parseEuros } from "../budget/rules.js";
import { addGarment, getGarment, listGarments, PHOTO_DIR, removeGarment, todayOutfit } from "../services/wardrobe.js";
import { answerLocation, currentPlace, listPlaces, pendingArrivals, recordLocation, updatePlace } from "../services/places.js";
import { isCalendarConfigured } from "../connectors/google/calendar.js";
import { isNotifyConfigured } from "../connectors/notifications/ntfy.js";
import { isMapsConfigured } from "../connectors/maps/routes.js";
import { addCourse, addExam, listCourses, removeCourse, upcomingExams } from "../services/school.js";
import { config } from "../config.js";
import { createReadStream } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getHealthDay, ingestHealth, logWorkout, sportWeek } from "../services/health.js";
import { parseHealthAutoExport, parseShortcutHealth } from "../health/ingest.js";
import { cancelReminder, listUpcomingReminders } from "../services/reminders.js";
import { spaceBoard, spaceLinks, spacesOverview } from "../services/spaces.js";
import { getDayPlan, replanToday } from "../services/planning.js";
import {
  classifyTaskInBackground,
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

  // Même demande que /jarvis, mais la réponse arrive au fil de l'eau (Server-Sent Events) :
  // la web app affiche et lit la première phrase pendant que Claude écrit la suite.
  app.post("/jarvis/stream", async (req, reply) => {
    const body = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx ne doit pas retenir la réponse.
      "X-Accel-Buffering": "no",
    });
    const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      const answer = await ask(body.message, { deviceCanCreate: false, onText: (text) => send({ type: "text", text }) });
      send({ type: "done", reponse: answer.reply });
    } catch (err) {
      req.log.error(err);
      send({ type: "error", reponse: "Je n'arrive pas à réfléchir pour l'instant, réessaie dans un instant." });
    }
    res.end();
  });

  app.get("/spaces", () => db.query.spaces.findMany({ orderBy: (s, { asc }) => asc(s.position) }));

  app.get("/spaces/overview", async () => ({ spaces: await spacesOverview(), links: await spaceLinks() }));

  app.get("/spaces/:slug", async (req) => {
    const { slug } = z.object({ slug: z.enum(SPACE_SLUGS) }).parse(req.params);
    return spaceBoard(slug);
  });

  app.get("/mails", async (req) => {
    const q = z
      .object({
        space: z.enum(SPACE_SLUGS).optional(),
        important: z.enum(["true", "false"]).optional(),
        handled: z.enum(["true", "false"]).optional(),
        days: z.coerce.number().int().min(1).max(30).optional(),
      })
      .parse(req.query);
    return {
      status: mailStatus(),
      mails: await listMails({
        space: q.space,
        importantOnly: q.important === "true",
        includeHandled: q.handled === "true",
        days: q.days,
      }),
    };
  });

  app.get("/mails/:id", async (req) => getMail(idParams.parse(req.params).id));

  app.post("/mails/:id/handled", async (req) => {
    const { id } = idParams.parse(req.params);
    const { handled } = z.object({ handled: z.boolean().default(true) }).parse(req.body ?? {});
    return setMailHandled(id, handled);
  });

  /** Relève les boîtes maintenant, sans attendre le passage du planificateur. */
  app.post("/mails/sync", () => checkMailboxes());

  app.get("/tasks", async () => ({ open: await listOpenTasks(), done: await listDoneTasks() }));

  app.post("/tasks", async (req, reply) => {
    const task = await createTask(toTaskInput(taskBody.parse(req.body)));
    classifyTaskInBackground(task);
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

  /**
   * Données Santé de l'iPhone : export de l'app Health Auto Export (JSON) ou Raccourci « Santé » du soir.
   * Les exports peuvent être gros : limite relevée à 10 Mo pour cette route.
   */
  app.post("/health/ingest", { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    const parsed =
      body && typeof body.data === "object"
        ? parseHealthAutoExport(body, zone)
        : body && typeof body.jour === "string"
          ? parseShortcutHealth(body, zone)
          : null;
    if (!parsed) throw Object.assign(new Error("Format inconnu : attendu un export Health Auto Export ou le Raccourci « Santé »."), { statusCode: 400 });
    const result = await ingestHealth(parsed);
    await replanToday();
    return result;
  });

  app.get("/health/summary", async () => {
    const today = now().startOf("day");
    const [lastNight, yesterday, week] = await Promise.all([
      getHealthDay(today),
      getHealthDay(today.minus({ days: 1 })),
      sportWeek(today),
    ]);
    return { lastNight, yesterday, week };
  });

  app.post("/health/workouts", async (req, reply) => {
    const body = z
      .object({ type: z.string().trim().min(1).max(100).optional(), minutes: z.number().int().min(5).max(300).optional() })
      .parse(req.body ?? {});
    const workout = await logWorkout(body);
    await replanToday();
    return reply.code(201).send(workout);
  });

  /** État des boutiques LMDD d'après le dernier relevé de Manageo. */
  app.get("/shops", async () => ({ configured: isManageoConfigured(), shops: await shopStatuses() }));

  /** Relève Manageo maintenant, sans attendre le planificateur. */
  app.post("/manageo/sync", async () => {
    await checkManageo();
    return { configured: isManageoConfigured(), shops: await shopStatuses() };
  });

  // --- Budget ---
  app.get("/budget", async (req) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const budget = await monthBudget(month);
    const [list, subs] = await Promise.all([listExpenses(budget.month), listSubscriptions()]);
    return { ...budget, expenses: list, subscriptions: subs };
  });

  app.post("/expenses", async (req, reply) => {
    const body = z
      .object({
        amount: z.union([z.number(), z.string()]),
        label: z.string().trim().min(1).max(100),
        category: z.enum(EXPENSE_CATEGORIES).default("autre"),
        spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        space: z.enum(SPACE_SLUGS).optional(),
      })
      .parse(req.body);
    const expense = await addExpense({ ...body, amountCents: parseEuros(body.amount), source: "app" });
    return reply.code(201).send(expense);
  });

  /** Facture en photo (base64) : lue par Claude, classée et enregistrée. */
  app.post("/expenses/photo", { bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const body = z
      .object({
        image: z.string().min(100),
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
      })
      .parse(req.body);
    const result = await addReceipt(body.image.replace(/^data:[^,]+,/, ""), body.mediaType);
    return "error" in result ? reply.code(422).send(result) : reply.code(201).send(result.expense);
  });

  app.get("/expenses/:id/receipt", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const expense = await getExpense(id);
    if (!expense?.receiptFile) return reply.code(404).send({ error: "Pas de photo pour cette dépense." });
    const ext = expense.receiptFile.split(".").pop();
    reply.type(ext === "jpg" ? "image/jpeg" : `image/${ext}`);
    return reply.send(createReadStream(join(resolve(config.DATA_DIR, "receipts"), basename(expense.receiptFile))));
  });

  app.delete("/expenses/:id", async (req, reply) => {
    await removeExpense(idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post("/subscriptions", async (req, reply) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(100), amount: z.union([z.number(), z.string()]), dayOfMonth: z.number().int().min(1).max(31) })
      .parse(req.body);
    return reply.code(201).send(await addSubscription({ name: body.name, amountCents: parseEuros(body.amount), dayOfMonth: body.dayOfMonth }));
  });

  app.delete("/subscriptions/:id", async (req, reply) => {
    await removeSubscription(idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  /** Écran Réglages : état des connexions et préférences (réglées dans le .env du serveur). */
  app.get("/settings", async () => {
    const lastHealth = await db.query.healthDays.findFirst({ orderBy: (h, { desc }) => desc(h.updatedAt) });
    const mail = mailStatus();
    return {
      connections: [
        { key: "google", label: "Google Agenda et Gmail", status: isCalendarConfigured() ? (mail.gmail === "configured" ? "connected" : "partial") : "missing" },
        { key: "outlook", label: "Outlook de l'école", status: mail.outlook === "configured" ? "connected" : "missing" },
        { key: "manageo", label: "Manageo", status: isManageoConfigured() ? "connected" : "missing" },
        { key: "health", label: "Apple Watch et Santé", status: lastHealth ? "connected" : "missing", detail: lastHealth ? `données du ${lastHealth.day}` : null },
        { key: "notifications", label: "Notifications (ntfy)", status: isNotifyConfigured() ? "connected" : "missing" },
        { key: "maps", label: "Trajets (Google Maps)", status: isMapsConfigured() && config.HOME_ADDRESS ? "connected" : isMapsConfigured() ? "partial" : "missing" },
      ],
      preferences: {
        prayerMethod: config.PRAYER_ENABLED ? config.PRAYER_METHOD : null,
        budgetMonthlyEur: config.BUDGET_MONTHLY_EUR,
        mealKcal: config.MEAL_KCAL_TARGET,
        sportPerWeek: config.SPORT_SESSIONS_PER_WEEK,
        travelMode: config.TRAVEL_MODE,
        briefingTime: config.BRIEFING_TIME,
        eveningTime: config.EVENING_TIME,
      },
    };
  });

  // --- École ---
  app.get("/school", async () => ({ exams: await upcomingExams(), courses: await listCourses() }));

  app.post("/exams", async (req, reply) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(150), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/).optional() })
      .parse(req.body);
    const exam = await addExam({ ...body, source: "voix" });
    await replanToday();
    return reply.code(exam ? 201 : 200).send(exam ?? { message: "Cet examen est déjà connu." });
  });

  /** Cours en PDF (base64) : résumé, fiche de révision et quiz. */
  app.post("/courses", { bodyLimit: 30 * 1024 * 1024 }, async (req, reply) => {
    const body = z.object({ pdf: z.string().min(100), fileName: z.string().trim().min(1).max(200) }).parse(req.body);
    const result = await addCourse(body.pdf.replace(/^data:[^,]+,/, ""), body.fileName);
    return "error" in result ? reply.code(422).send(result) : reply.code(201).send(result);
  });

  app.delete("/courses/:id", async (req, reply) => {
    await removeCourse(idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  // --- Lieux et trajets ---
  /** Appelé par l'automatisation « Arrivée » ou « Départ » de l'iPhone. */
  app.post("/events/location", async (req) => {
    const body = z.object({ lieu: z.string().trim().min(1), evenement: z.enum(["arrivee", "depart"]) }).parse(req.body);
    const { place, event } = await recordLocation(body.lieu, body.evenement);
    return { lieu: place.name, evenement: event.event, statut: event.status };
  });

  app.get("/places", async () => ({ places: await listPlaces(), here: await currentPlace(), pending: await pendingArrivals() }));

  app.patch("/places/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const body = z.object({ name: z.string().trim().min(1).optional(), address: z.string().trim().max(300).nullable().optional() }).parse(req.body);
    return updatePlace(slug, body);
  });

  app.post("/location/:id/answer", async (req) => {
    const { id } = idParams.parse(req.params);
    const { answer } = z.object({ answer: z.enum(["present", "passing"]) }).parse(req.body);
    return { message: await answerLocation(id, answer) };
  });

  // --- Garde-robe ---
  app.get("/wardrobe", async () => ({ items: await listGarments(), outfit: await todayOutfit() }));

  app.post("/wardrobe", { bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const body = z
      .object({ image: z.string().min(100), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]) })
      .parse(req.body);
    const result = await addGarment(body.image.replace(/^data:[^,]+,/, ""), body.mediaType);
    return "error" in result ? reply.code(422).send(result) : reply.code(201).send(result);
  });

  app.get("/wardrobe/:id/photo", async (req, reply) => {
    const item = await getGarment(idParams.parse(req.params).id);
    const ext = item.photoFile.split(".").pop();
    reply.type(ext === "jpg" ? "image/jpeg" : `image/${ext}`);
    reply.header("Cache-Control", "private, max-age=86400");
    return reply.send(createReadStream(join(PHOTO_DIR(), basename(item.photoFile))));
  });

  app.delete("/wardrobe/:id", async (req, reply) => {
    await removeGarment(idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post("/wardrobe/outfit", async () => todayOutfit({ refresh: true }));

  // --- Repas ---
  app.get("/meals", async (req) => {
    const q = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const from = q.from ?? now().toISODate()!;
    const [meals, target] = await Promise.all([getMeals(from, q.to ?? now().plus({ days: 6 }).toISODate()!), todayTarget()]);
    return { meals, target };
  });

  app.post("/meals/regenerate", async (req) => {
    const body = z
      .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), request: z.string().max(500).optional() })
      .parse(req.body);
    const meals = await regenerateMeals(body.from, body.to, body.request);
    await replanToday();
    return meals;
  });

  // --- Courses ---
  app.get("/shopping", () => listShopping());

  app.post("/shopping", async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(100), qty: z.string().trim().max(40).optional() }).parse(req.body);
    return reply.code(201).send(await addShoppingItem({ ...body, source: "app" }));
  });

  app.post("/shopping/:id/check", async (req) => {
    const { id } = idParams.parse(req.params);
    const { checked } = z.object({ checked: z.boolean().default(true) }).parse(req.body ?? {});
    return setShoppingChecked(id, checked);
  });

  app.delete("/shopping/:id", async (req, reply) => {
    await removeShoppingItem(idParams.parse(req.params).id);
    return reply.code(204).send();
  });

  // --- Vie perso : soins, compléments, administratif, proches, routines ---
  app.get("/life", async () => {
    const [care, supplementsToday, admin, news, contacts, routines] = await Promise.all([
      listCareItems(),
      todaySupplements(),
      listAdminDeadlines(),
      contactNews(30),
      listContacts(),
      listRoutines(),
    ]);
    return { care, supplementsToday, admin, birthdays: news.birthdays, toCall: news.toCall, contacts, routines };
  });

  app.post("/supplements/:id/taken", async (req) => markSupplementTaken(idParams.parse(req.params).id));
  app.post("/care/:id/done", async (req) => markCareDone(idParams.parse(req.params).id));
  app.post("/admin/:id/done", async (req) => markAdminDone(idParams.parse(req.params).id));
  app.post("/contacts/:id/called", async (req) => markContacted(idParams.parse(req.params).id));

  // Supprimer depuis l'application est un geste de Jessim lui-même : pas de mise en attente.
  for (const [path, remove] of [
    ["/care/:id", removeCareItem],
    ["/supplements/:id", removeSupplement],
    ["/admin/:id", removeAdminDeadline],
    ["/contacts/:id", removeContact],
  ] as const) {
    app.delete(path, async (req, reply) => {
      await remove(idParams.parse(req.params).id);
      return reply.code(204).send();
    });
  }

  /** Horaires de prière du jour et rappel du jour. */
  app.get("/prayer", async (req) => {
    const { date } = z.object({ date: z.string().optional() }).parse(req.query);
    const day = date ? parseDay(date) : now().startOf("day");
    const [times, hadith] = await Promise.all([getPrayerTimes(day), getDailyHadith(day)]);
    return { enabled: times !== null, times, hadith };
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
