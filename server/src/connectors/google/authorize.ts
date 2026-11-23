/**
 * Obtient le refresh token Google : agenda en lecture, Gmail en lecture et envoi des réponses validées.
 * Prérequis : un client OAuth de type « Application de bureau » dans Google Cloud,
 * avec GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans le .env.
 *
 * Deux façons de l'utiliser :
 * - sur une machine avec un navigateur : npm run google:auth -w server (sans argument),
 *   le script attend le retour de Google sur 127.0.0.1 ;
 * - sur le serveur, sans navigateur :
 *   1. `node dist/connectors/google/authorize.js url` affiche l'adresse à ouvrir sur n'importe quel appareil ;
 *   2. après l'accord, le navigateur arrive sur une page d'erreur 127.0.0.1 : copier son adresse,
 *      puis `node dist/connectors/google/authorize.js "<adresse copiée>"` écrit le refresh token seul
 *      sur la sortie standard (les messages vont sur la sortie d'erreur).
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { GOOGLE_SCOPES } from "./scopes.js";

for (const path of [".env", "../.env"]) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être renseignés dans le .env.");
  process.exit(1);
}

const port = 53682;
const redirectUri = `http://127.0.0.1:${port}`;

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: GOOGLE_SCOPES.join(" "),
  access_type: "offline",
  prompt: "consent",
}).toString();

/** Échange le code contre un refresh token ; null en cas d'échec (détail sur la sortie d'erreur). */
async function exchangeCode(code: string): Promise<string | null> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!tokenRes.ok || !body.refresh_token) {
    console.error("Google n'a pas renvoyé de refresh token :", body.error ?? "", body.error_description ?? "");
    return null;
  }
  return body.refresh_token;
}

const arg = process.argv[2];

if (arg === "url") {
  console.error("Ouvre cette adresse dans ton navigateur (téléphone ou ordinateur) :\n");
  console.log(authUrl.toString());
} else if (arg) {
  const code = URL.canParse(arg) ? new URL(arg).searchParams.get("code") : arg;
  if (!code) {
    console.error("Pas de « code » dans cette adresse : copie l'adresse complète de la page 127.0.0.1.");
    process.exit(1);
  }
  const token = await exchangeCode(code);
  if (!token) process.exit(1);
  console.log(token);
  console.error("Refresh token obtenu.");
} else {
  const server = createServer(async (req, res) => {
    const code = new URL(req.url ?? "/", redirectUri).searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("Paramètre « code » manquant.");
      return;
    }
    const token = await exchangeCode(code);
    if (!token) {
      res.writeHead(500).end("Échec, voir le terminal.");
    } else {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("C'est bon, retourne au terminal.");
      console.log(`\nAjoute cette ligne au .env :\n\nGOOGLE_REFRESH_TOKEN=${token}\n`);
    }
    server.close();
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Ouvre cette adresse dans ton navigateur :\n\n${authUrl}\n`);
  });
}
