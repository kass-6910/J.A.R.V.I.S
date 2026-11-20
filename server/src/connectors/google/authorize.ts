/**
 * Obtient le refresh token Google : agenda en lecture, Gmail en lecture et envoi des réponses validées.
 * Prérequis : un client OAuth de type « Application de bureau » dans Google Cloud,
 * avec GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans le .env.
 * Lancer sur une machine avec un navigateur : npm run google:auth -w server
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

const server = createServer(async (req, res) => {
  const code = new URL(req.url ?? "/", redirectUri).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Paramètre « code » manquant.");
    return;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await tokenRes.json()) as { refresh_token?: string; error_description?: string };
  if (!tokenRes.ok || !body.refresh_token) {
    res.writeHead(500).end("Échec, voir le terminal.");
    console.error("Google n'a pas renvoyé de refresh token :", body);
  } else {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("C'est bon, retourne au terminal.");
    console.log(`\nAjoute cette ligne au .env :\n\nGOOGLE_REFRESH_TOKEN=${body.refresh_token}\n`);
  }
  server.close();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Ouvre cette adresse dans ton navigateur :\n\n${authUrl}\n`);
});
