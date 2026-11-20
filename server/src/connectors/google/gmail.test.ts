import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../mail/mime.js";
import { parseGmailMessage } from "./gmail.js";

describe("parseGmailMessage", () => {
  it("lit les en-têtes et préfère la partie texte", () => {
    const mail = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Bonjour",
      internalDate: "1795000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "Scolarité <scolarite@ecole.fr>" },
          { name: "Reply-To", value: "noreply-exams@ecole.fr" },
          { name: "Subject", value: "Examen de gestion" },
          { name: "Message-ID", value: "<x1@ecole.fr>" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: encodeBase64Url("L'examen a lieu le 3 décembre.") } },
              { mimeType: "text/html", body: { data: encodeBase64Url("<p>HTML</p>") } },
            ],
          },
          { mimeType: "text/plain", filename: "convocation.txt", body: { data: encodeBase64Url("pièce jointe") } },
        ],
      },
    });
    expect(mail).toMatchObject({
      externalId: "m1",
      threadId: "t1",
      messageIdHeader: "<x1@ecole.fr>",
      fromName: "Scolarité",
      fromAddress: "scolarite@ecole.fr",
      replyAddress: "noreply-exams@ecole.fr",
      subject: "Examen de gestion",
      body: "L'examen a lieu le 3 décembre.",
      unread: true,
    });
    expect(mail.receivedAt.getTime()).toBe(1795000000000);
  });

  it("se rabat sur le HTML sans partie texte", () => {
    const mail = parseGmailMessage({
      id: "m2",
      threadId: "t2",
      internalDate: "0",
      payload: {
        mimeType: "text/html",
        headers: [{ name: "From", value: "a@b.fr" }],
        body: { data: encodeBase64Url("<div>Commande <b>prête</b></div>") },
      },
    });
    expect(mail.body).toBe("Commande prête");
    expect(mail.subject).toBe("(sans objet)");
    expect(mail.unread).toBe(false);
  });
});
