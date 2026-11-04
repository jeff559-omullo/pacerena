import "dotenv/config";
import { runPendingMigrations } from "./migrate";

void runPendingMigrations().then(() => {
  console.info("[Database] Pending journal migrations are complete.");
}).catch(error => {
  console.error("[Database] Migration failed; no server was started.", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
