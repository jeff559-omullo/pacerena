import { describe, expect, it } from "vitest";
import { matchRecordingUploadAllowed, recordingExpiry, RECORDING_RETENTION_MS, validVideoSignature } from "./match-recordings";

describe("temporary match video evidence", () => {
  it("accepts only supported video signatures", () => {
    expect(validVideoSignature("video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1]))).toBe(true);
    expect(validVideoSignature("video/mp4", Buffer.from("0000ftypisom0000"))).toBe(true);
    expect(validVideoSignature("video/quicktime", Buffer.from("0000ftypqt  0000"))).toBe(true);
    expect(validVideoSignature("video/webm", Buffer.from("not-a-video"))).toBe(false);
    expect(validVideoSignature("image/png", Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(false);
  });

  it("permits capture upload during play and review, and bounds post-match uploads by the evidence deadline", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    const deadline = new Date(now.getTime() + 60_000);
    expect(matchRecordingUploadAllowed("IN_PROGRESS", null, now)).toBe(true);
    expect(matchRecordingUploadAllowed("UNDER_REVIEW", null, now)).toBe(true);
    expect(matchRecordingUploadAllowed("AWAITING_EVIDENCE", deadline, now)).toBe(true);
    expect(matchRecordingUploadAllowed("COMPLETED", deadline, now)).toBe(true);
    expect(matchRecordingUploadAllowed("COMPLETED", now, new Date(now.getTime() + 1))).toBe(false);
    expect(matchRecordingUploadAllowed("CANCELLED", deadline, now)).toBe(false);
  });

  it("expires settled clips at the evidence deadline and holds review clips until resolution", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    const deadline = new Date(now.getTime() + RECORDING_RETENTION_MS);
    expect(recordingExpiry("COMPLETED", deadline, now)).toEqual(deadline);
    expect(recordingExpiry("AWAITING_EVIDENCE", deadline, now)).toEqual(deadline);
    expect(recordingExpiry("UNDER_REVIEW", deadline, now)).toBeNull();
    expect(recordingExpiry("IN_PROGRESS", null, now)).toBeNull();
    expect(recordingExpiry("DRAWN", null, now)?.getTime()).toBe(now.getTime() + RECORDING_RETENTION_MS);
  });
});
