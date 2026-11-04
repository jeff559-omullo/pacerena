import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerEvidenceRoutes } from "../evidence";
import { registerMatchRecordingRoutes } from "../match-recordings";
import { registerPartnerCreditRoute } from "../kes-wallet";
import { processMatchTimeouts } from "../arena";
import { runPendingMigrations } from "../migrate";

async function startServer() {
  let databaseReady = process.env.NODE_ENV !== "production";
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    if (process.env.NODE_ENV === "production" && !databaseReady && req.path.startsWith("/api/") && req.path !== "/api/health" && req.path !== "/api/platform/config.js") {
      res.set("Retry-After", "2").status(503).json({ status: "starting", message: "Database migrations are in progress." });
      return;
    }
    next();
  });
  const server = createServer(app);
  registerPartnerCreditRoute(app);
  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ limit: "12mb", extended: true }));
  app.get("/api/health", (_req, res) => res.status(databaseReady ? 200 : 503).json({ status: databaseReady ? "ok" : "starting" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerEvidenceRoutes(app);
  registerMatchRecordingRoutes(app);
  app.use("/api/trpc", (req, res, next) => {
    if (req.method === "POST" && req.get("x-pace-arena-request") !== "1") {
      res.status(403).json({ error: "Request origin could not be verified." });
      return;
    }
    next();
  });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
    const startTimeoutWorker = () => {
      databaseReady = true;
      console.log("[Database] Application schema is ready.");
      // Trusted timestamps are evaluated on the server. Timeout processing never awards a win.
      void processMatchTimeouts();
      const timeoutTimer = setInterval(() => void processMatchTimeouts(), 30_000);
      timeoutTimer.unref();
    };

    if (process.env.NODE_ENV === "production") {
      void runPendingMigrations().then(startTimeoutWorker).catch(error => {
        console.error("[Database] Startup migrations failed; API remains unavailable.", error instanceof Error ? error.message : "unknown error");
        server.close(() => process.exit(1));
      });
    } else {
      startTimeoutWorker();
    }
  });
}

startServer().catch(error => { console.error("Server startup failed:", error instanceof Error ? error.message : "unknown error"); process.exit(1); });
