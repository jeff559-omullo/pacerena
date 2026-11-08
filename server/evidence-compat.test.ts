import { describe, expect, it } from "vitest";
import { databaseHasColumn, disputeAttachmentProjection, isMissingColumnError, legacyMatchEvidenceProjection, matchEvidenceProjection, withoutEncryptedBytes } from "./evidence";

describe("evidence schema compatibility", () => {
  it("detects missing encryptedBytes column errors from MySQL", () => {
    expect(isMissingColumnError(new Error("Unknown column 'encryptedBytes' in 'field list'"), "encryptedBytes")).toBe(true);
    expect(isMissingColumnError(new Error("Unknown column \"encryptedBytes\" in field list"), "encryptedBytes")).toBe(true);
  });

  it("drops encryptedBytes from insert payloads when the old schema is missing the column", () => {
    expect(withoutEncryptedBytes({
      matchId: 60002,
      userId: 7,
      storageKey: "db://legacy/evidence",
      encryptedBytes: Buffer.from("payload"),
      mimeType: "image/png",
    })).toEqual({
      matchId: 60002,
      userId: 7,
      storageKey: "db://legacy/evidence",
      mimeType: "image/png",
    });
  });

  it("detects encryptedBytes.columns from mysql2 tuple and object result shapes", async () => {
    await expect(databaseHasColumn({ execute: async () => [[{ Field: "encryptedBytes" }], []] }, "match_evidence", "encryptedBytes")).resolves.toBe(true);
    await expect(databaseHasColumn({ execute: async () => ({ rows: [{ Field: "encryptedBytes" }], fields: [] }) }, "dispute_attachments", "encryptedBytes")).resolves.toBe(true);
    await expect(databaseHasColumn({ execute: async () => ({ rows: [], fields: [] }) }, "match_evidence", "encryptedBytes")).resolves.toBe(false);
  });

  it("omits encryptedBytes from projections when the column is not present", async () => {
    const legacyDb = { execute: async () => ({ rows: [], fields: [] }) };
    const evidenceProjection = await matchEvidenceProjection(legacyDb);
    const attachmentProjection = await disputeAttachmentProjection(legacyDb);

    expect(evidenceProjection).toEqual(await legacyMatchEvidenceProjection());
    expect(attachmentProjection).toEqual({
      id: expect.anything(),
      disputeId: expect.anything(),
      userId: expect.anything(),
      storageKey: expect.anything(),
      mimeType: expect.anything(),
      sizeBytes: expect.anything(),
      createdAt: expect.anything(),
    });
    expect(Object.keys(evidenceProjection)).not.toContain("encryptedBytes");
    expect(Object.keys(attachmentProjection)).not.toContain("encryptedBytes");
  });
});
