import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { disputeAttachments, disputes, matchEvidence, matchParticipants } from "../drizzle/schema";
import { getDb } from "./db";
import { createContext } from "./_core/context";
import { ENV } from "./_core/env";
import { storageGetSignedUrl, storagePut } from "./storage";

const EVIDENCE_PREFIX = Buffer.from("PAE1");

function evidenceKey() {
  if (!ENV.forgeApiKey || !ENV.appId) throw new Error("Evidence encryption service is unavailable");
  return Buffer.from(hkdfSync("sha256", Buffer.from(ENV.forgeApiKey), Buffer.from(ENV.appId), Buffer.from("pace-arena-evidence-v1"), 32));
}
function encrypt(bytes: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", evidenceKey(), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([EVIDENCE_PREFIX, iv, cipher.getAuthTag(), encrypted]);
}
function decrypt(bytes: Buffer) {
  if (bytes.length <= 32 || !bytes.subarray(0, 4).equals(EVIDENCE_PREFIX)) throw new Error("Stored evidence format is invalid");
  const decipher = createDecipheriv("aes-256-gcm", evidenceKey(), bytes.subarray(4, 16));
  decipher.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
}

/** The managed object store has no per-object ACL; store encrypted bytes and never expose its key/URL. */
export async function storePrivateEvidence(matchId: number, bytes: Buffer, _mimeType: string) {
  const key = `pacearena/evidence/match-${matchId}/${randomBytes(24).toString("hex")}.enc`;
  const result = await storagePut(key, encrypt(bytes), "application/octet-stream");
  return result.key;
}
async function readPrivateEvidence(key: string) {
  const url = await storageGetSignedUrl(key);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Private evidence retrieval failed (${response.status})`);
  return decrypt(Buffer.from(await response.arrayBuffer()));
}

export function registerEvidenceRoutes(app: Express) {
  app.get("/api/evidence/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).end(); return; }
      const context = await createContext({ req, res, info: {} } as never);
      const user = context.user;
      if (!user) { res.status(401).end(); return; }
      const database = await getDb();
      if (!database) { res.status(503).end(); return; }
      const [evidence] = await database.select().from(matchEvidence).where(eq(matchEvidence.id, id)).limit(1);
      if (!evidence) { res.status(404).end(); return; }
      const access = await database.select().from(matchParticipants).where(and(eq(matchParticipants.matchId, evidence.matchId), eq(matchParticipants.userId, user.id))).limit(1);
      if (!access.length && user.role !== "admin") { res.status(403).end(); return; }
      const bytes = await readPrivateEvidence(evidence.storageKey);
      res.set({
        "Content-Type": evidence.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline; filename=match-evidence",
      }).status(200).send(bytes);
    } catch (error) {
      console.error("[Pace Arena evidence] Retrieval failed:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) res.status(404).end();
    }
  });
  app.get("/api/dispute-evidence/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(404).end(); return; }
      const context = await createContext({ req, res, info: {} } as never);
      const user = context.user;
      if (!user) { res.status(401).end(); return; }
      const database = await getDb();
      if (!database) { res.status(503).end(); return; }
      const [row] = await database.select({ attachment: disputeAttachments, matchId: disputes.matchId }).from(disputeAttachments).innerJoin(disputes, eq(disputes.id, disputeAttachments.disputeId)).where(eq(disputeAttachments.id, id)).limit(1);
      if (!row) { res.status(404).end(); return; }
      const access = await database.select().from(matchParticipants).where(and(eq(matchParticipants.matchId, row.matchId), eq(matchParticipants.userId, user.id))).limit(1);
      if (!access.length && user.role !== "admin") { res.status(403).end(); return; }
      const bytes = await readPrivateEvidence(row.attachment.storageKey);
      res.set({
        "Content-Type": row.attachment.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline; filename=dispute-evidence",
      }).status(200).send(bytes);
    } catch (error) {
      console.error("[Pace Arena dispute evidence] Retrieval failed:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) res.status(404).end();
    }
  });
}
