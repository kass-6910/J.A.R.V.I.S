/** Outils purs pour lire et écrire des mails : décodage, texte brut, réponse au format MIME. */

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  ecirc: "ê",
  rsquo: "’",
  laquo: "«",
  raquo: "»",
  euro: "€",
};

/** Texte lisible à partir d'un corps HTML : assez bon pour un résumé, pas pour un affichage. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** « Jean Dupont <jean@x.fr> » → nom et adresse. */
export function parseAddress(value: string): { name: string; address: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1]!.trim() || match[2]!.trim(), address: match[2]!.trim() };
  const address = value.trim();
  return { name: address, address };
}

/** Garde la partie utile d'un mail : coupe l'historique cité et limite la longueur. */
export function cleanBody(text: string, max = 8000): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (line) => /^(Le .+a écrit\s*:|On .+wrote:|-----Original Message-----|De\s*:.+)$/i.test(line.trim()) || line.startsWith(">"),
  );
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim();
  return kept.length > max ? `${kept.slice(0, max)}…` : kept;
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^r[eé]\s*:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Réponse au format RFC 5322, prête pour l'API Gmail (champ « raw »). */
export function buildReplyMime(input: {
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
}): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(replySubject(input.subject))}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = Buffer.from(input.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}
