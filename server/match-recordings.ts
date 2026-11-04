import express from "express";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, eq, inArray, lte } from "drizzle-orm";
import { disputes, matchParticipants, matchRecordings, matches } from "../drizzle/schema";
import { getDb } from "./db";
import { createContext } from "./_core/context";
import { ENV } from "./_core/env";
import { safeOrigin } from "./auth";

export const MAX_MATCH_RECORDING_BYTES = 32 * 1024 * 1024;
export const RECORDING_RETENTION_MS = 5 * 60 * 1000;
const RECORDING_MAGIC = Buffer.from("PAV1");
const uploadBuckets = new Map<string, { count: number; resetAt: number }>();

export function validVideoSignature(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "video/webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  return false;
}

export function matchRecordingUploadAllowed(status: string, evidenceDeadline: Date | null, now = new Date()): boolean {
  if (status === "IN_PROGRESS" || status === "UNDER_REVIEW") return true;
  return ["AWAITING_EVIDENCE", "COMPLETED", "DRAWN"].includes(status) && !!evidenceDeadline && evidenceDeadline.getTime() >= now.getTime();
}

export function recordingExpiry(status: string, evidenceDeadline: Date | null, now = new Date()): Date | null {
  if (status === "IN_PROGRESS" || status === "UNDER_REVIEW") return null;
  return evidenceDeadline ?? new Date(now.getTime() + RECORDING_RETENTION_MS);
}

function recordingKey(): Buffer {
  if (!ENV.forgeApiKey || !ENV.appId) throw new Error("Match recording encryption is unavailable");
  return Buffer.from(hkdfSync("sha256", Buffer.from(ENV.forgeApiKey), Buffer.from(ENV.appId), Buffer.from("pace-arena-match-recording-v1"), 32));
}

function encryptRecording(bytes: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", recordingKey(), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([RECORDING_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decryptRecording(bytes: Buffer): Buffer {
  if (bytes.length <= 32 || !bytes.subarray(0, 4).equals(RECORDING_MAGIC)) throw new Error("Stored match recording format is invalid");
  const decipher = createDecipheriv("aes-256-gcm", recordingKey(), bytes.subarray(4, 16));
  decipher.setAuthTag(bytes.subarray(16, 32));
  return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
}

function rateLimitUpload(userId: number, ip: string | undefined) {
  const now = Date.now();
  if (uploadBuckets.size > 5000) for (const [key, bucket] of uploadBuckets) if (bucket.resetAt <= now) uploadBuckets.delete(key);
  for (const key of [`video-user:${userId}`, `video-ip:${ip ?? "unknown"}`]) {
    const current = uploadBuckets.get(key);
    if (!current || current.resetAt <= now) uploadBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    else if (++current.count > 5) throw new Error("Too many recording uploads. Wait a minute and try again.");
  }
}

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

async function authenticatedUser(req: Request, res: Response) {
  const context = await createContext({ req, res, info: {} } as never);
  return context.user;
}

/**
 * Delete expired encrypted rows. Lock the match before the recording so dispute-opening and
 * cleanup serialize on the same row. Expired clips for a review are held, not deleted.
 */
export async function cleanupExpiredMatchRecordings(database: any, now = new Date()): Promise<number> {
  const expired = await database.select({ id: matchRecordings.id, matchId: matchRecordings.matchId })
    .from(matchRecordings).where(lte(matchRecordings.expiresAt, now)).limit(100);
  let deleted = 0;
  for (const candidate of expired) {
    await database.transaction(async (tx: any) => {
      const matchRows = await tx.select().from(matches).where(eq(matches.id, candidate.matchId)).for("update").limit(1);
      const match = matchRows[0];
      const recordingRows = await tx.select().from(matchRecordings).where(eq(matchRecordings.id, candidate.id)).for("update").limit(1);
      const recording = recordingRows[0];
      if (!recording || !recording.expiresAt || recording.expiresAt.getTime() > now.getTime()) return;
      if (!match) {
        await tx.delete(matchRecordings).where(eq(matchRecordings.id, candidate.id));
        deleted += 1;
        return;
      }
      const activeDisputes = await tx.select({ id: disputes.id }).from(disputes)
        .where(and(eq(disputes.matchId, candidate.matchId), inArray(disputes.status, ["OPEN", "INVESTIGATING"]))).limit(1);
      if (match.status === "UNDER_REVIEW" || activeDisputes.length) {
        await tx.update(matchRecordings).set({ expiresAt: null }).where(eq(matchRecordings.id, candidate.id));
        return;
      }
      await tx.delete(matchRecordings).where(eq(matchRecordings.id, candidate.id));
      deleted += 1;
    });
  }
  return deleted;
}

export function registerMatchRecordingRoutes(app: Express) {
  app.post("/api/match-recordings/:matchId", express.raw({
    type: ["video/webm", "video/mp4", "video/quicktime"],
    limit: MAX_MATCH_RECORDING_BYTES,
  }), async (req: Request, res: Response) => {
    try {
      safeOrigin({ req });
      if (req.get("x-pace-arena-request") !== "1") { sendError(res, 403, "Request origin could not be verified."); return; }
      const user = await authenticatedUser(req, res);
      if (!user) { sendError(res, 401, "Sign in to upload match evidence."); return; }
      rateLimitUpload(user.id, req.ip);
      const matchId = Number(req.params.matchId);
      const mimeType = (req.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!Number.isSafeInteger(matchId) || matchId <= 0) { sendError(res, 404, "Match not found."); return; }
      if (!["video/webm", "video/mp4", "video/quicktime"].includes(mimeType)) { sendError(res, 415, "Use a WebM, MP4 or QuickTime video recording."); return; }
      if (bytes.length < 64 || bytes.length > MAX_MATCH_RECORDING_BYTES) { sendError(res, 413, "Video must be 64 bytes to 32 MB."); return; }
      if (!validVideoSignature(mimeType, bytes)) { sendError(res, 400, "The video content does not match its file type."); return; }
      const db = await getDb();
      if (!db) { sendError(res, 503, "The match evidence service is unavailable."); return; }
      return await db.transaction(async tx => {
        const matchRows = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update").limit(1);
        const match = matchRows[0];
        if (!match) { sendError(res, 404, "Match not found."); return; }
        const participants = await tx.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId)).for("update");
        if (!participants.some((participant: { userId: number }) => participant.userId === user.id)) { sendError(res, 403, "Only match participants may submit a recording."); return; }
        if (!matchRecordingUploadAllowed(match.status, match.evidenceDeadline)) { sendError(res, 409, "The match recording window is closed."); return; }
        const existing = await tx.select({ id: matchRecordings.id }).from(matchRecordings)
          .where(and(eq(matchRecordings.matchId, matchId), eq(matchRecordings.userId, user.id))).limit(1);
        if (existing.length) { sendError(res, 409, "A recording has already been uploaded for this match."); return; }
        await tx.insert(matchRecordings).values({
          matchId,
          userId: user.id,
          mimeType: mimeType as "video/webm" | "video/mp4" | "video/quicktime",
          sizeBytes: bytes.length,
          encryptedBytes: encryptRecording(bytes),
          expiresAt: recordingExpiry(match.status, match.evidenceDeadline),
        });
        res.set("Cache-Control", "no-store").status(201).json({ success: true, sizeBytes: bytes.length });
      });
    } catch (error) {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : "Recording upload failed.";
      if (message === "Too many recording uploads. Wait a minute and try again.") { sendError(res, 429, message); return; }
      if (message.includes("origin could not be verified")) { sendError(res, 403, message); return; }
      console.error("[Pace Arena recording] Upload failed:", message);
      sendError(res, 500, "The recording could not be saved. Try again or use the manual upload option.");
    }
  });

  app.get("/api/match-recordings/:id", async (req: Request, res: Response) => {
    try {
      const recordingId = Number(req.params.id);
      if (!Number.isSafeInteger(recordingId) || recordingId <= 0) { res.status(404).end(); return; }
      const user = await authenticatedUser(req, res);
      if (!user) { res.status(401).end(); return; }
      const db = await getDb();
      if (!db) { res.status(503).end(); return; }
      const [row] = await db.select({ recording: matchRecordings, matchStatus: matches.status })
        .from(matchRecordings).innerJoin(matches, eq(matches.id, matchRecordings.matchId))
        .where(eq(matchRecordings.id, recordingId)).limit(1);
      if (!row) { res.status(404).end(); return; }
      if (row.recording.expiresAt && row.recording.expiresAt.getTime() <= Date.now()) { res.status(410).end(); return; }
      const uploader = row.recording.userId === user.id;
      const adminReview = user.role === "admin" && row.matchStatus === "UNDER_REVIEW";
      if (!uploader && !adminReview) { res.status(403).end(); return; }
      const bytes = decryptRecording(Buffer.from(row.recording.encryptedBytes));
      res.set({
        "Content-Type": row.recording.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; media-src 'self'; sandbox",
        "Content-Disposition": "inline; filename=match-recording",
      }).status(200).send(bytes);
    } catch (error) {
      console.error("[Pace Arena recording] Retrieval failed:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) res.status(404).end();
    }
  });
}
