import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool, prepareDatabase } from "./db/client.js";
import { startScheduler } from "./jobs/scheduler.js";
import { ensureDefaultPlaces } from "./services/places.js";

await prepareDatabase();
await ensureDefaultPlaces();
const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
const stopScheduler = startScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await stopScheduler();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
