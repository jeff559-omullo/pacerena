import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerEvidenceRoutes } from "../evidence";
import { processMatchTimeouts } from "../arena";

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);
  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ limit: "12mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerEvidenceRoutes(app);
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
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));

  // Trusted timestamps are evaluated on the server. Deadline processing never awards a win;
  // it expires open invitations, safely refunds readiness failures, and escalates evidence gaps.
  void processMatchTimeouts();
  const timeoutTimer = setInterval(() => void processMatchTimeouts(), 30_000);
  timeoutTimer.unref();
}

startServer().catch(error => { console.error("Server startup failed:", error instanceof Error ? error.message : "unknown error"); process.exit(1); });
