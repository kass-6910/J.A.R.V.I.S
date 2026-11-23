/**
 * Rappel du jour tiré d'une collection publiée de hadiths (éditions françaises du projet
 * open source « hadith-api », servies par jsDelivr). Le texte est repris tel quel, avec
 * son recueil et son numéro : rien n'est rédigé par l'IA.
 */

const BASE = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions";

/** Nom du recueil et plus grand numéro, pour tirer un hadith au hasard. */
export const COLLECTIONS: Record<string, { name: string; count: number }> = {
  "fra-bukhari": { name: "Sahih al-Bukhari", count: 7563 },
  "fra-muslim": { name: "Sahih Muslim", count: 7470 },
  "fra-nawawi": { name: "Les quarante hadiths de l'imam an-Nawawi", count: 42 },
  "fra-abudawud": { name: "Sunan Abu Dawud", count: 5274 },
  "fra-malik": { name: "Muwatta de l'imam Malik", count: 1594 },
};

export interface Hadith {
  edition: string;
  collection: string;
  number: string;
  text: string;
  grade: string | null;
}

interface ApiHadith {
  hadithnumber: number | string;
  text?: string;
  grades?: { name?: string; grade?: string }[];
}

/** Réponse « un hadith » vers le format de Jarvis ; null si le texte manque. Pure : testée à part. */
export function parseHadith(edition: string, body: unknown): Hadith | null {
  const hadith = (body as { hadiths?: ApiHadith[] }).hadiths?.[0];
  const text = hadith?.text?.replace(/\s+/g, " ").trim();
  if (!hadith || !text) return null;
  const grade = hadith.grades?.find((g) => g.grade)?.grade ?? null;
  return {
    edition,
    collection: COLLECTIONS[edition]?.name ?? edition,
    number: String(hadith.hadithnumber),
    text,
    grade,
  };
}

/** Graine stable par jour : le même jour donne le même hadith, même après un redémarrage. */
export function pickNumber(day: string, attempt: number, count: number): number {
  let h = 2166136261;
  for (const c of `${day}#${attempt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (Math.abs(h) % count) + 1;
}

/** Un hadith court (lisible à voix haute) pour le jour donné ; null si la source ne répond pas. */
export async function fetchDailyHadith(day: string, editions: string[], maxLength = 600): Promise<Hadith | null> {
  const usable = editions.filter((e) => COLLECTIONS[e]);
  for (let attempt = 0; attempt < 8 && usable.length > 0; attempt++) {
    const edition = usable[pickNumber(day, attempt, usable.length) - 1]!;
    const number = pickNumber(day, attempt, COLLECTIONS[edition]!.count);
    const res = await fetch(`${BASE}/${edition}/${number}.min.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    const hadith = parseHadith(edition, await res.json());
    if (hadith && hadith.text.length <= maxLength) return hadith;
  }
  return null;
}
