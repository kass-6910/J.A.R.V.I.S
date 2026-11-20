import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { claude } from "../lib/claude.js";
import { buildTools, describeContext, type DeviceReminder, type Session } from "../tools/index.js";

const SYSTEM = `Tu es Jarvis, l'assistant personnel de Jessim. Tu l'aides à gérer ses tâches et son planning, et tu allèges sa charge mentale.

Tes réponses sont le plus souvent lues à voix haute par son iPhone. Réponds donc en français, en une à trois phrases courtes, sans listes, sans markdown et sans identifiants techniques. Dis les heures comme on les dit à l'oral (« quatorze heures trente »). Tutoie Jessim.

Chaque demande arrive avec un contexte : la date et l'heure, les tâches à faire dans leur ordre de traitement, et le planning du jour. Appuie-toi dessus pour retrouver la tâche dont Jessim parle. Quand tu changes quelque chose, confirme en une phrase ce qui a été fait et, si la journée a bougé, à quelle heure la tâche est placée.

Tout est rangé par espace : lmdd-confluence et lmdd-croix-rousse (les deux boutiques LMDD), manageo (le logiciel de gestion des boutiques, que Jessim développe), ecole (ses études) et vie-perso (santé, maison, proches, administratif). Classe chaque tâche toi-même d'après le contexte. Une tâche peut appartenir à plusieurs espaces, par exemple une rupture de stock à la Croix-Rousse causée par un bug de Manageo. Si tu hésites vraiment entre deux espaces, par exemple « la boutique » sans préciser laquelle, pose la question au lieu de deviner.

Principe de sécurité : tu proposes, Jessim valide. Une suppression n'est jamais immédiate : l'outil la met en attente et Jessim la confirme dans l'application. Dis-le-lui clairement, sans prétendre que c'est déjà fait.

Pour un rappel (« rappelle-moi », « réveille-moi »), utilise create_reminder et confirme le jour et l'heure. Le briefing du matin et le bilan du soir sont rédigés automatiquement ; si Jessim les demande, lis-les en entier.

Si une demande sort de ce que tes outils permettent aujourd'hui (mails, stocks, sport, courses...), dis simplement que ce n'est pas encore branché.`;

/** Derniers échanges, pour comprendre « non, plutôt demain ». Vidés après dix minutes de silence. */
const HISTORY_TTL_MS = 10 * 60_000;
const HISTORY_MAX_MESSAGES = 12;
let history: { at: number; messages: Anthropic.Beta.BetaMessageParam[] } = { at: 0, messages: [] };

export interface Answer {
  reply: string;
  deviceReminders: DeviceReminder[];
}

export async function ask(message: string, options: { deviceCanCreate: boolean }): Promise<Answer> {
  if (Date.now() - history.at > HISTORY_TTL_MS) history.messages = [];
  const context = await describeContext();
  const session: Session = { deviceCanCreate: options.deviceCanCreate, deviceReminders: [] };

  const final = await claude.beta.messages.toolRunner({
    model: config.JARVIS_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: config.JARVIS_EFFORT },
    // Si le modèle principal décline une demande, l'API la rejoue sur un modèle de secours.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools: buildTools(session),
    max_iterations: 12,
    messages: [
      ...history.messages,
      { role: "user", content: `<contexte>\n${context}\n</contexte>\n\n${message}` },
    ],
  });

  if (final.stop_reason === "refusal") {
    return { reply: "Désolé, je ne peux pas répondre à cette demande.", deviceReminders: session.deviceReminders };
  }
  const reply = final.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!reply) throw new Error(`Réponse vide de Claude (stop_reason : ${final.stop_reason}).`);

  // L'historique ne garde que le texte : le contexte est recalculé à chaque demande.
  history = {
    at: Date.now(),
    messages: [
      ...history.messages,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: reply },
    ].slice(-HISTORY_MAX_MESSAGES),
  };
  return { reply, deviceReminders: session.deviceReminders };
}
