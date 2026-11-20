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
  const lines = [`Courses : ${shopping.toBuy.length} article(s) à acheter.`];
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
      description: "Demande la suppression d'un soin, complément, échéance ou proche. Comme toute suppression, elle attend la validation de Jessim.",
      inputSchema: z.object({ type: z.enum(["soin", "complement", "administratif", "proche"]), item_id: id, label: z.string().describe("Nom de l'élément, pour la validation.") }),
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
  ];
}
