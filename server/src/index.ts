import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool, prepareDatabase } from "./db/client.js";

await prepareDatabase();
const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
