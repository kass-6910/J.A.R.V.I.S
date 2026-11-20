import { describe, expect, it } from "vitest";
import { parseGraphMessage } from "./outlook.js";

describe("parseGraphMessage", () => {
  it("lit un message de l'école", () => {
    const mail = parseGraphMessage({
      id: "AAMk1",
      conversationId: "conv1",
      internetMessageId: "<y@ecole.fr>",
      subject: "Changement de salle",
      bodyPreview: "Le cours de mardi...",
      body: { contentType: "text", content: "Le cours de mardi a lieu en salle B12.\r\n\r\nDe : Jessim\r\nancien message" },
      from: { emailAddress: { name: "Mme Martin", address: "martin@ecole.fr" } },
      receivedDateTime: "2026-11-20T08:15:00Z",
      isRead: false,
    });
    expect(mail).toMatchObject({
      externalId: "AAMk1",
      threadId: "conv1",
      fromName: "Mme Martin",
      replyAddress: "martin@ecole.fr",
      body: "Le cours de mardi a lieu en salle B12.",
      unread: true,
    });
  });

  it("supporte un expéditeur sans nom et un corps HTML", () => {
    const mail = parseGraphMessage({
      id: "AAMk2",
      body: { contentType: "html", content: "<p>Note publiée</p>" },
      from: { emailAddress: { address: "notes@ecole.fr" } },
      receivedDateTime: "2026-11-20T08:15:00Z",
    });
    expect(mail.fromName).toBe("notes@ecole.fr");
    expect(mail.body).toBe("Note publiée");
    expect(mail.subject).toBe("(sans objet)");
  });
});
