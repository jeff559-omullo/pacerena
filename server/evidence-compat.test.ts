import { describe, expect, it } from "vitest";
import { isMissingColumnError, withoutEncryptedBytes } from "./evidence";

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
});
