import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { apiRoutes } from "./api/routes.js";
import { config } from "./config.js";
import { isCalendarConfigured } from "./connectors/google/calendar.js";
import { isNotifyConfigured } from "./connectors/notifications/ntfy.js";
import { pool } from "./db/client.js";
import { mailStatus } from "./services/mails.js";
import { verify } from "./lib/signing.js";
import { markIntakeTaken } from "./services/life.js";
import { isManageoConfigured } from "./services/manageo.js";
import { NotFoundError } from "./services/tasks.js";

function tokenMatches(header: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${config.JARVIS_TOKEN}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Demande invalide.", details: err.issues });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: "Erreur interne du serveur." });
  });

  app.get("/api/health", async () => {
    await pool.query("select 1");
    return {
      status: "ok",
      calendar: isCalendarConfigured() ? "configured" : "not_configured",
      notifications: isNotifyConfigured() ? "configured" : "not_configured",
      mail: mailStatus(),
      manageo: isManageoConfigured() ? "configured" : "not_configured",
    };
  });

  // Boutons des notifications (« Pris ») : pas de jeton, mais un lien signé valable pour cette seule action.
  app.post("/api/public/intakes/:id/taken", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { sig } = z.object({ sig: z.string() }).parse(req.query);
    if (!verify(`/api/public/intakes/${id}/taken`, sig)) return reply.code(403).send({ error: "Lien invalide." });
    await markIntakeTaken(id);
    return { ok: true };
  });

  await app.register(
    async (api) => {
      api.addHook("onRequest", async (req, reply) => {
        if (!tokenMatches(req.headers.authorization)) {
          return reply.code(401).send({ error: "Jeton manquant ou invalide." });
        }
      });
      await api.register(apiRoutes);
    },
    { prefix: "/api" },
  );

  // En production, le serveur sert aussi la web app construite (npm run build).
  const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Route inconnue." });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
