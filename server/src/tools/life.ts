import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SUPPLEMENT_MOMENTS } from "../life/rules.js";
import { formatDateTime } from "../lib/time.js";
import { logExecuted, requestValidation } from "../services/actions.js";
import {
  addAdminDeadline,
  addCareItem,
  addContact,
  addSupplement,
  contactNews,
  listAdminDeadlines,
  listCareItems,
  listContacts,
  listRoutines,
  markAdminDone,
  markCareDone,
  markContacted,
  markSupplementTaken,
  restockSupplement,
  setRoutine,
  todaySupplements,
} from "../services/life.js";
import { addShoppingItem, listShopping } from "../services/shopping.js";
import { describeMeal, getMeals, regenerateMeals, todayTarget } from "../services/meals.js";
import { replanToday } from "../services/planning.js";
import { now } from "../lib/time.js";
import { addExpense, addSubscription, listSubscriptions, monthBudget } from "../services/budget.js";
import { EXPENSE_CATEGORIES, formatEuros } from "../budget/rules.js";
import { SPACE_SLUGS } from "../db/client.js";
import { todayOutfit } from "../services/wardrobe.js";
import { addExam, getCourse, listCourses, upcomingExams } from "../services/school.js";
import { answerLocation, describeCurrentPlace, recordLocation, updatePlace } from "../services/places.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date AAAA-MM-JJ");
const id = z.string().uuid().describe("Identifiant entre crochets, donné par life_overview ou le contexte.");

/** Résumé court pour le contexte de chaque demande. */
export async function describeLifeContext(): Promise<string[]> {
  const [shopping, pills, admin, news] = await Promise.all([
    listShopping(),
    todaySupplements(),
    listAdminDeadlines(),
    contactNews(7),
  ]);
  const here = await describeCurrentPlace();
  const lines = [...(here ? [here] : []), `Courses : ${shopping.toBuy.length} article(s) à acheter.`];
  if (pills.length > 0) {
    lines.push(
      `Compléments du jour : ${pills.map((p) => `${p.supplement.name} [${p.supplement.id}] ${p.takenAt ? "pris" : `à ${formatDateTime(new Date(p.at)).split(" à ")[1]}`}`).join(", ")}.`,
    );
  }
  const soon = admin.slice(0, 5);
  if (soon.length > 0) lines.push(`Échéances administratives : ${soon.map((d) => `${d.title} [${d.id}] le ${d.dueOn}`).join(", ")}.`);
  if (news.birthdays.length > 0) {
    lines.push(`Anniversaires proches : ${news.birthdays.map((b) => `${b.contact.name} le ${b.on}`).join(", ")}.`);
  }
  return lines;
}

export function lifeTools() {
  return [
    betaZodTool({
      name: "shopping_add",
      description: "Ajoute un ou plusieurs articles à la liste de courses partagée (« Jarvis, plus de riz »). Les doublons sont ignorés.",
      inputSchema: z.object({
        items: z.array(z.object({ name: z.string().min(1), qty: z.string().optional().describe("Quantité, par exemple « 2 kg ».") })).min(1),
      }),
      run: async (input) => {
        for (const item of input.items) await addShoppingItem({ ...item, source: "voix" });
        await logExecuted("shopping_add", input, `Courses : ${input.items.map((i) => i.name).join(", ")}`);
        const { toBuy } = await listShopping();
        return `Ajouté. La liste compte ${toBuy.length} article(s).`;
      },
    }),
    betaZodTool({
      name: "shopping_list",
      description: "Donne la liste de courses en cours.",
      inputSchema: z.object({}),
      run: async () => {
        const { toBuy } = await listShopping();
        return toBuy.length === 0 ? "La liste de courses est vide." : toBuy.map((i) => `- ${i.name}${i.qty ? ` (${i.qty})` : ""}`).join("\n");
      },
    }),
    betaZodTool({
      name: "life_overview",
      description:
        "Liste avec leurs identifiants les soins récurrents, compléments, échéances administratives, proches et routines. À utiliser avant de modifier l'un d'eux.",
      inputSchema: z.object({}),
      run: async () => {
        const [care, pills, admin, people, routines] = await Promise.all([
          listCareItems(),
          todaySupplements(),
          listAdminDeadlines(),
          listContacts(),
          listRoutines(),
        ]);
        return [
          "Soins :",
          ...care.map((c) => `- [${c.id}] ${c.name} (${c.kind}, tous les ${c.everyDays} jours, prochain le ${c.nextOn})`),
          "Compléments :",
          ...pills.map((p) => `- [${p.supplement.id}] ${p.supplement.name} (${p.supplement.moment}${p.supplement.stockDoses !== null ? `, ${p.supplement.stockDoses} doses` : ""})`),
          "Administratif :",
          ...admin.map((d) => `- [${d.id}] ${d.title} pour le ${d.dueOn}`),
          "Proches :",
          ...people.map((c) => `- [${c.id}] ${c.name}${c.relation ? ` (${c.relation})` : ""}${c.birthday ? `, né(e) le ${c.birthday}` : ""}${c.callEveryDays ? `, à appeler tous les ${c.callEveryDays} jours` : ""}${c.lastContactOn ? `, dernier appel le ${c.lastContactOn}` : ""}`),
          "Routines :",
          ...routines.map((r) => `- ${r.moment} à ${r.time} : ${r.items}`),
        ].join("\n");
      },
    }),
    betaZodTool({
      name: "care_add",
      description:
        "Ajoute un soin récurrent que Jessim oublie : un rendez-vous (coiffeur, barbier) qui sera placé dans la semaine à l'échéance, ou un produit à racheter (brosse à dents, déodorant) qui ira sur la liste de courses.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Formulé comme une tâche ou un article : « Coiffeur », « Brosse à dents »."),
        kind: z.enum(["rendez_vous", "produit"]),
        every_days: z.number().int().min(1).max(730),
        duration_min: z.number().int().min(5).max(480).optional().describe("Pour un rendez-vous, durée à bloquer (45 min par défaut)."),
        last_done_on: day.optional().describe("Dernière fois, si Jessim la donne."),
      }),
      run: async (input) => {
        const item = await addCareItem({
          name: input.name,
          kind: input.kind,
          everyDays: input.every_days,
          durationMin: input.duration_min,
          lastDoneOn: input.last_done_on,
        });
        await logExecuted("care_add", input, `Soin : ${item.name}`);
        return `Soin « ${item.name} » enregistré, tous les ${item.everyDays} jours.`;
      },
    }),
    betaZodTool({
      name: "care_done",
      description: "Note qu'un soin récurrent vient d'être fait (« je suis allé chez le coiffeur ») : la prochaine échéance repart d'aujourd'hui.",
      inputSchema: z.object({ care_id: id, on: day.optional() }),
      run: async (input) => {
        const item = await markCareDone(input.care_id, input.on);
        await logExecuted("care_done", input, `Soin fait : ${item.name}`);
        return `C'est noté pour ${item.name}.`;
      },
    }),
    betaZodTool({
      name: "supplement_add",
      description: "Ajoute un complément à prendre chaque jour, avec son moment ; le rappel se cale sur les repas et la séance de sport.",
      inputSchema: z.object({
        name: z.string().min(1),
        moment: z.enum(SUPPLEMENT_MOMENTS),
        with_meal: z.boolean().optional(),
        stock_doses: z.number().int().min(0).optional().describe("Doses restantes, pour l'ajouter aux courses avant la fin de la boîte."),
        low_at: z.number().int().min(0).optional(),
      }),
      run: async (input) => {
        const s = await addSupplement({
          name: input.name,
          moment: input.moment,
          withMeal: input.with_meal,
          stockDoses: input.stock_doses ?? null,
          lowAt: input.low_at,
        });
        await logExecuted("supplement_add", input, `Complément : ${s.name}`);
        return `Complément « ${s.name} » ajouté (${s.moment.replace("_", " ")}).`;
      },
    }),
    betaZodTool({
      name: "supplement_taken",
      description: "Note qu'un complément a été pris aujourd'hui (« j'ai pris ma créatine ») : le rappel s'arrête et le stock baisse.",
      inputSchema: z.object({ supplement_id: id }),
      run: async (input) => {
        const s = await markSupplementTaken(input.supplement_id);
        await logExecuted("supplement_taken", input, `Pris : ${s.name}`);
        return `${s.name} : pris.${s.stockDoses !== null ? ` Il reste ${s.stockDoses} doses.` : ""}`;
      },
    }),
    betaZodTool({
      name: "supplement_restock",
      description: "Met à jour le stock d'un complément après un rachat (« j'ai racheté une boîte de 60 »).",
      inputSchema: z.object({ supplement_id: id, doses: z.number().int().min(0) }),
      run: async (input) => {
        await restockSupplement(input.supplement_id, input.doses);
        await logExecuted("supplement_restock", input, `Stock complément : ${input.doses}`);
        return `Stock mis à jour : ${input.doses} doses.`;
      },
    }),
    betaZodTool({
      name: "admin_add",
      description: "Ajoute une échéance administrative (CAF, bail, impôts, facture…) ; Jarvis rappelle avant la date limite.",
      inputSchema: z.object({
        title: z.string().min(1),
        due_on: day,
        remind_days: z.number().int().min(1).max(60).optional().describe("Combien de jours avant prévenir (7 par défaut)."),
        notes: z.string().optional(),
      }),
      run: async (input) => {
        const d = await addAdminDeadline({ title: input.title, dueOn: input.due_on, remindDays: input.remind_days, notes: input.notes });
        await logExecuted("admin_add", input, `Administratif : ${d.title}`);
        return `Échéance « ${d.title} » enregistrée pour le ${d.dueOn}.`;
      },
    }),
    betaZodTool({
      name: "admin_done",
      description: "Note qu'une démarche administrative est faite : les rappels s'arrêtent.",
      inputSchema: z.object({ admin_id: id }),
      run: async (input) => {
        const d = await markAdminDone(input.admin_id);
        await logExecuted("admin_done", input, `Administratif fait : ${d.title}`);
        return `« ${d.title} » : c'est fait.`;
      },
    }),
    betaZodTool({
      name: "contact_add",
      description: "Ajoute un proche : anniversaire et, si Jessim le veut, fréquence à laquelle l'appeler.",
      inputSchema: z.object({
        name: z.string().min(1),
        relation: z.string().optional().describe("Par exemple « mère », « ami »."),
        birthday: z.string().regex(/^\d{2}-\d{2}$/, "MM-JJ").optional().describe("Anniversaire au format MM-JJ."),
        birth_year: z.number().int().min(1900).max(2100).optional(),
        call_every_days: z.number().int().min(1).max(365).optional(),
      }),
      run: async (input) => {
        const c = await addContact({
          name: input.name,
          relation: input.relation,
          birthday: input.birthday,
          birthYear: input.birth_year,
          callEveryDays: input.call_every_days,
        });
        await logExecuted("contact_add", input, `Proche : ${c.name}`);
        return `${c.name} ajouté(e).`;
      },
    }),
    betaZodTool({
      name: "contact_called",
      description: "Note que Jessim a appelé ou vu un proche (« j'ai appelé maman »).",
      inputSchema: z.object({ contact_id: id }),
      run: async (input) => {
        const c = await markContacted(input.contact_id);
        await logExecuted("contact_called", input, `Appel : ${c.name}`);
        return `C'est noté pour ${c.name}.`;
      },
    }),
    betaZodTool({
      name: "routine_set",
      description: "Règle la routine du matin ou du soir : un rappel discret chaque jour à l'heure donnée.",
      inputSchema: z.object({
        moment: z.enum(["matin", "soir"]),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        items: z.string().min(1).describe("Le contenu du rappel, court : « Eau, étirements, brossage de dents »."),
      }),
      run: async (input) => {
        await setRoutine(input.moment, input.time, input.items);
        await logExecuted("routine_set", input, `Routine du ${input.moment}`);
        return `Routine du ${input.moment} réglée à ${input.time}.`;
      },
    }),
    betaZodTool({
      name: "life_remove",
      description: "Demande la suppression d'un soin, complément, échéance, proche, dépense ou abonnement. Comme toute suppression, elle attend la validation de Jessim.",
      inputSchema: z.object({
        type: z.enum(["soin", "complement", "administratif", "proche", "depense", "abonnement"]),
        item_id: id,
        label: z.string().describe("Nom de l'élément, pour la validation."),
      }),
      run: async (input) => {
        await requestValidation("life_remove", { type: input.type, item_id: input.item_id }, `Supprimer ${input.type} « ${input.label} »`);
        return `Suppression de « ${input.label} » en attente : Jessim doit la valider dans l'application.`;
      },
    }),
    betaZodTool({
      name: "get_menu",
      description: "Donne les menus prévus (petit-déjeuner, déjeuner, collation, dîner) pour une période, avec l'objectif calorique du jour.",
      inputSchema: z.object({ from: day.optional().describe("Aujourd'hui par défaut."), to: day.optional() }),
      run: async (input) => {
        const from = input.from ?? now().toISODate()!;
        const meals = await getMeals(from, input.to ?? from);
        if (meals.length === 0) return "Pas encore de menu prévu pour cette période.";
        const target = await todayTarget();
        return [
          ...meals.map((m) => `- ${m.day} · ${describeMeal(m)} : ${m.description}`),
          `Objectif d'aujourd'hui : ${target.kcal} kcal${target.sportToday ? " (jour de sport)" : ""}.`,
        ].join("\n");
      },
    }),
    betaZodTool({
      name: "regenerate_menu",
      description:
        "Refait les menus d'une période en tenant compte d'une demande de Jessim (« pas de poisson cette semaine », « plus de plats froids »). Les ingrédients sont ajoutés aux courses.",
      inputSchema: z.object({ from: day, to: day, request: z.string().optional() }),
      run: async (input) => {
        const meals = await regenerateMeals(input.from, input.to, input.request);
        await logExecuted("regenerate_menu", input, `Menus refaits du ${input.from} au ${input.to}`);
        await replanToday();
        return `Menus refaits (${meals.length} repas), ingrédients ajoutés aux courses.`;
      },
    }),
    betaZodTool({
      name: "expense_add",
      description:
        "Enregistre une dépense (« j'ai dépensé 23 € au resto »). Perso par défaut ; pour une dépense d'une boutique ou de Manageo, donne l'espace.",
      inputSchema: z.object({
        amount_eur: z.number().positive(),
        label: z.string().min(1),
        category: z.enum(EXPENSE_CATEGORIES),
        spent_on: day.optional(),
        space: z.enum(SPACE_SLUGS).optional(),
      }),
      run: async (input) => {
        const e = await addExpense({
          amountCents: Math.round(input.amount_eur * 100),
          label: input.label,
          category: input.category,
          spentOn: input.spent_on,
          space: input.space,
          source: "voix",
        });
        await logExecuted("expense_add", input, `Dépense : ${e.label} ${formatEuros(e.amountCents)}`);
        const { status } = await monthBudget();
        return `Dépense enregistrée. Ce mois : ${formatEuros(status.spent)}${status.limit > 0 ? ` sur ${formatEuros(status.limit)}` : ""}.`;
      },
    }),
    betaZodTool({
      name: "subscription_add",
      description: "Ajoute un abonnement prélevé chaque mois (« Netflix 13,49 € le 5 du mois ») : il est compté automatiquement dans le budget.",
      inputSchema: z.object({ name: z.string().min(1), amount_eur: z.number().positive(), day_of_month: z.number().int().min(1).max(31) }),
      run: async (input) => {
        const sub = await addSubscription({ name: input.name, amountCents: Math.round(input.amount_eur * 100), dayOfMonth: input.day_of_month });
        await logExecuted("subscription_add", input, `Abonnement : ${sub.name}`);
        return `Abonnement « ${sub.name} » ajouté, ${formatEuros(sub.amountCents)} le ${sub.dayOfMonth} de chaque mois.`;
      },
    }),
    betaZodTool({
      name: "budget_status",
      description: "Donne le point budget du mois : total dépensé, plafond, projection de fin de mois, postes principaux, abonnements, dépenses pro.",
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
      run: async (input) => {
        const b = await monthBudget(input.month);
        const subs = await listSubscriptions();
        return [
          `Mois ${b.month} : ${formatEuros(b.status.spent)} dépensés${b.status.limit > 0 ? ` sur ${formatEuros(b.status.limit)}` : " (pas de plafond réglé)"}, projection ${formatEuros(b.status.projected)}.`,
          ...b.byCategory.map((c) => `- ${c.label} : ${formatEuros(c.cents)}`),
          `Abonnements : ${subs.length === 0 ? "aucun" : subs.map((x) => `${x.name} [${x.id}] ${formatEuros(x.amountCents)} le ${x.dayOfMonth}`).join(", ")}.`,
          ...b.professional.map((p) => `Dépenses pro ${p.space} : ${formatEuros(p.cents)}`),
        ].join("\n");
      },
    }),
    betaZodTool({
      name: "outfit_today",
      description:
        "Donne la tenue proposée aujourd'hui selon la météo et l'agenda (ou en propose une autre avec refresh). Les vêtements s'ajoutent en photo dans l'application.",
      inputSchema: z.object({ refresh: z.boolean().optional().describe("Vrai pour proposer une autre tenue.") }),
      run: async (input) => {
        const outfit = await todayOutfit({ refresh: input.refresh });
        if (!outfit) return "La garde-robe est vide : Jessim ajoute ses vêtements en photo dans l'application.";
        return `Tenue (${outfit.reason}) : ${outfit.items.map((i) => i.label).join(", ")}.${outfit.sportBag ? ` Sac de sport : ${outfit.sportBag.label}.` : ""}`;
      },
    }),
    betaZodTool({
      name: "set_presence",
      description:
        "Jessim dit où il est (« je suis à la salle », « j'arrive à la boutique de la Croix-Rousse ») : présence confirmée, avec l'action du lieu (séance démarrée, alertes de la boutique, journée recalée).",
      inputSchema: z.object({ place: z.string().describe("Lieu enregistré : salle, lmdd-confluence, lmdd-croix-rousse, ecole, maison.") }),
      run: async (input) => {
        const { event } = await recordLocation(input.place, "arrivee");
        const message = await answerLocation(event.id, "present");
        await logExecuted("set_presence", input, message);
        return message;
      },
    }),
    betaZodTool({
      name: "place_set_address",
      description: "Enregistre l'adresse d'un lieu (maison, boutique, école, salle) : elle sert de point de départ pour les temps de trajet.",
      inputSchema: z.object({ place: z.string(), address: z.string().min(3) }),
      run: async (input) => {
        const place = await updatePlace(input.place, { address: input.address });
        await logExecuted("place_set_address", input, `Adresse : ${place.name}`);
        return `Adresse de ${place.name} enregistrée.`;
      },
    }),
    betaZodTool({
      name: "exam_add",
      description: "Enregistre un examen dicté par Jessim : rappels 3 jours avant, la veille et le jour J, et séances de révision bloquées dans le planning.",
      inputSchema: z.object({ title: z.string().min(1), day, time: z.string().regex(/^\d{2}:\d{2}$/).optional() }),
      run: async (input) => {
        const exam = await addExam({ title: input.title, day: input.day, time: input.time, source: "voix" });
        if (!exam) return "Cet examen est déjà enregistré.";
        await logExecuted("exam_add", input, `Examen : ${exam.title}`);
        await replanToday();
        return `Examen « ${exam.title} » enregistré pour le ${exam.day}, avec ${exam.revisionTaskIds.length} séance(s) de révision.`;
      },
    }),
    betaZodTool({
      name: "school_overview",
      description: "Liste les examens à venir (avec l'avancement des révisions) et les cours disponibles pour réviser.",
      inputSchema: z.object({}),
      run: async () => {
        const [upcoming, list] = await Promise.all([upcomingExams(), listCourses()]);
        return [
          "Examens :",
          ...(upcoming.length ? upcoming.map((e) => `- ${e.title} le ${e.day}${e.time ? ` à ${e.time}` : ""} (dans ${e.inDays} j, révisions ${e.revisionsDone}/${e.revisionTaskIds.length})`) : ["- aucun"]),
          "Cours :",
          ...(list.length ? list.map((c) => `- [${c.id}] ${c.title}${c.subject ? ` (${c.subject})` : ""}`) : ["- aucun cours importé"]),
        ].join("\n");
      },
    }),
    betaZodTool({
      name: "course_content",
      description:
        "Donne le résumé, la fiche de révision ou le quiz d'un cours. Pour un quiz à la voix : pose une seule question à la fois, attends la réponse de Jessim, corrige-la brièvement, puis passe à la suivante.",
      inputSchema: z.object({ course_id: id, part: z.enum(["resume", "fiche", "quiz"]) }),
      run: async (input) => {
        const course = await getCourse(input.course_id);
        if (input.part === "resume") return course.summary;
        if (input.part === "fiche") return course.sheet;
        return course.quiz.map((q, i) => `${i + 1}. ${q.question}\n   Réponse attendue : ${q.answer}`).join("\n");
      },
    }),
  ];
}
