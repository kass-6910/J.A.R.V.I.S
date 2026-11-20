/**
 * Obtient le refresh token Microsoft pour l'Outlook de l'école (connexion par code, sans navigateur sur le serveur).
 * Prérequis : une application inscrite dans Microsoft Entra, « flux client public » autorisé, avec MS_CLIENT_ID dans le .env.
 * Lancer : npm run outlook:auth -w server
 */
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { MS_SCOPES } from "./scopes.js";

for (const path of [".env", "../.env"]) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const clientId = process.env.MS_CLIENT_ID;
const tenant = process.env.MS_TENANT || "organizations";
if (!clientId) {
  console.error("MS_CLIENT_ID doit être renseigné dans le .env.");
  process.exit(1);
}

const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
const start = await fetch(`${base}/devicecode`, {
  method: "POST",
  body: new URLSearchParams({ client_id: clientId, scope: MS_SCOPES.join(" ") }),
});
const device = (await start.json()) as {
  device_code: string;
  message: string;
  interval: number;
  expires_in: number;
  error_description?: string;
};
if (!start.ok) {
  console.error("Microsoft a refusé la demande :", device.error_description ?? device);
  process.exit(1);
}
console.log(`\n${device.message}\n`);

const deadline = Date.now() + device.expires_in * 1000;
while (Date.now() < deadline) {
  await sleep(device.interval * 1000);
  const res = await fetch(`${base}/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
    }),
  });
  const body = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (body.refresh_token) {
    console.log(`Ajoute cette ligne au .env :\n\nMS_REFRESH_TOKEN=${body.refresh_token}\n`);
    process.exit(0);
  }
  if (body.error !== "authorization_pending" && body.error !== "slow_down") {
    console.error("Connexion refusée :", body.error_description ?? body.error);
    if (body.error === "access_denied" || body.error_description?.includes("admin")) {
      console.error("L'école bloque peut-être les applications externes : son accord est alors nécessaire.");
    }
    process.exit(1);
  }
}
console.error("Délai dépassé, relance la commande.");
process.exit(1);
