import * as Speech from "expo-speech";

let voiceId: string | undefined;

/**
 * Meilleure voix française installée sur l'iPhone : « Premium », puis « améliorée ».
 * Elles se téléchargent dans Réglages > Accessibilité > Contenu énoncé > Voix > Français.
 */
export async function pickVoice(): Promise<void> {
  const voices = (await Speech.getAvailableVoicesAsync()).filter((v) => v.language.startsWith("fr"));
  const score = (v: Speech.Voice) =>
    (v.language === "fr-FR" ? 4 : 0) +
    (/premium/i.test(v.identifier) ? 40 : 0) +
    (v.quality === Speech.VoiceQuality.Enhanced ? 20 : 0) +
    (/audrey|thomas|amélie|amelie|aurélie|marie/i.test(v.name) ? 8 : 0);
  voiceId = voices.sort((a, b) => score(b) - score(a))[0]?.identifier;
}

function say(sentence: string) {
  if (!sentence.trim()) return;
  // Speech.speak met les phrases en file : elles s'enchaînent sans se couper.
  Speech.speak(sentence.trim(), { language: "fr-FR", voice: voiceId, rate: 1.05 });
}

export function stopSpeaking(): void {
  void Speech.stop();
}

/** Lecture au fil de l'eau : chaque phrase est lue dès qu'elle est complète. */
export function createSpeaker(): { push: (delta: string) => void; end: () => void } {
  stopSpeaking();
  let pending = "";
  return {
    push(delta) {
      pending += delta;
      const match = /^([\s\S]*[.!?…])\s+/.exec(pending);
      if (match) {
        say(match[1]!);
        pending = pending.slice(match[0].length);
      }
    },
    end() {
      say(pending);
      pending = "";
    },
  };
}
