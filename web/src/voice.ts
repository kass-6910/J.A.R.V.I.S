/**
 * Voix dans la web app : la dictée et la lecture passent par le navigateur
 * (sur iPhone et Mac, c'est la dictée et la voix d'Apple, gratuites).
 */

interface RecognitionResultEvent {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const canListen = () => recognitionCtor() !== undefined;

export interface ListenHandlers {
  /** Texte en cours de dictée, mis à jour pendant qu'on parle. */
  onPartial: (text: string) => void;
  /** Phrase terminée : appelée une fois, après une pause. Texte vide si rien n'a été entendu. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Micro refusé : autorise-le dans les réglages du navigateur.",
  "service-not-allowed": "Dictée indisponible : vérifie qu'elle est activée dans les réglages de l'iPhone.",
  "audio-capture": "Aucun micro détecté.",
  network: "Dictée indisponible sans connexion.",
};

/** Écoute une phrase. Renvoie une fonction pour arrêter l'écoute. */
export function listen(handlers: ListenHandlers): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    handlers.onError("Ce navigateur ne permet pas la dictée.");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = "fr-FR";
  rec.interimResults = true;
  rec.continuous = false;

  let text = "";
  let failed = false;
  rec.onresult = (e) => {
    text = Array.from(e.results, (r) => r[0].transcript).join("");
    handlers.onPartial(text);
  };
  rec.onerror = (e) => {
    // « no-speech » et « aborted » ne sont pas des pannes : on finit simplement sans texte.
    if (e.error === "no-speech" || e.error === "aborted") return;
    failed = true;
    handlers.onError(ERRORS[e.error] ?? `Dictée interrompue (${e.error}).`);
  };
  rec.onend = () => {
    if (!failed) handlers.onFinal(text.trim());
  };
  rec.start();
  return () => rec.stop();
}

/** Noms des voix françaises les plus naturelles sur iPhone et Mac. */
const GOOD_VOICES = ["audrey", "thomas", "amélie", "amelie", "aurélie", "aurelie", "marie", "jacques"];

/**
 * Meilleure voix française disponible : « Premium », puis « améliorée », puis une voix connue
 * pour être naturelle, plutôt que la première venue (souvent la plus robotique).
 */
function bestFrenchVoice(): SpeechSynthesisVoice | undefined {
  const score = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase();
    let s = 0;
    if (v.lang === "fr-FR") s += 4;
    if (/premium/.test(name)) s += 40;
    if (/enhanced|améliorée|amelioree|neural|natural/.test(name)) s += 20;
    if (GOOD_VOICES.some((g) => name.includes(g))) s += 8;
    if (/eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bad news|bells|bubbles|jester|organ|trinoids|whisper|zarvox/.test(name)) s -= 30;
    return s;
  };
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("fr"))
    .sort((a, b) => score(b) - score(a))[0];
}

/** Lit un texte à voix haute en français, avec la meilleure voix de l'appareil. */
export function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  const voice = bestFrenchVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  speechSynthesis.speak(utterance);
}

/**
 * Safari ne lit à voix haute qu'après un geste de l'utilisateur :
 * une phrase vide, lancée au toucher du micro, débloque la lecture de la réponse.
 */
export function unlockSpeech(): void {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}

// Sur iPhone, la liste des voix arrive après le chargement de la page : on la demande tout de suite.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
}
