import { describe, expect, it } from "vitest";
import {
  buildReplyMime,
  cleanBody,
  decodeBase64Url,
  encodeBase64Url,
  htmlToText,
  parseAddress,
  replySubject,
} from "./mime.js";

describe("htmlToText", () => {
  it("garde le texte, les retours à la ligne et les accents", () => {
    const html = `<html><head><style>p{color:red}</style></head><body>
      <p>Bonjour&nbsp;Jessim,</p><p>L&#39;examen de <b>gestion</b> est d&eacute;plac&eacute;.<br>Merci</p></body></html>`;
    expect(htmlToText(html)).toBe("Bonjour Jessim,\nL'examen de gestion est déplacé.\nMerci");
  });
});

describe("parseAddress", () => {
  it("sépare le nom et l'adresse", () => {
    expect(parseAddress('"Dupont, Jean" <jean@ecole.fr>')).toEqual({ name: "Dupont, Jean", address: "jean@ecole.fr" });
    expect(parseAddress("contact@lmdd.fr")).toEqual({ name: "contact@lmdd.fr", address: "contact@lmdd.fr" });
  });
});

describe("cleanBody", () => {
  it("coupe l'historique cité", () => {
    const text = "Merci, c'est noté.\n\nLe jeu. 19 nov. 2026, Jessim a écrit :\n> Bonjour";
    expect(cleanBody(text)).toBe("Merci, c'est noté.");
  });

  it("limite la longueur", () => {
    expect(cleanBody("a".repeat(20), 10)).toBe("aaaaaaaaaa…");
  });
});

describe("replySubject", () => {
  it("n'empile pas les « Re: »", () => {
    expect(replySubject("Planning")).toBe("Re: Planning");
    expect(replySubject("RE: Planning")).toBe("RE: Planning");
    expect(replySubject("TR: Planning")).toBe("Re: TR: Planning");
  });
});

describe("buildReplyMime", () => {
  it("produit une réponse dans le même fil, accents encodés", () => {
    const mime = buildReplyMime({
      to: "prof@ecole.fr",
      subject: "Décalage de l'examen",
      body: "Bien reçu, merci.",
      inReplyTo: "<abc@ecole.fr>",
    });
    const [head, body] = mime.split("\r\n\r\n");
    expect(head).toContain("To: prof@ecole.fr");
    expect(head).toContain("In-Reply-To: <abc@ecole.fr>");
    expect(head).toContain(`Subject: =?UTF-8?B?${Buffer.from("Re: Décalage de l'examen").toString("base64")}?=`);
    expect(Buffer.from(body!, "base64").toString("utf8")).toBe("Bien reçu, merci.");
  });

  it("passe en base64url pour l'API Gmail", () => {
    const text = "é?>~ test";
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
    expect(encodeBase64Url(text)).not.toMatch(/[+/=]/);
  });
});
