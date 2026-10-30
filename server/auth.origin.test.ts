import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { safeOrigin } from "./auth";

function request(headers: Record<string, string | undefined>) {
  return { req: { get: (name: string) => headers[name.toLowerCase()] } };
}

describe("registration/reset public-origin validation", () => {
  it("accepts a normal local same-origin HTTP request", () => {
    expect(safeOrigin(request({
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "x-forwarded-proto": "http",
    }))).toBe("http://localhost:3000");
  });

  it("accepts the HTTPS Manus Preview origin when its internal request Host is loopback", () => {
    const origin = "https://8328-ixa68hwiqdw2yvxsfhrhw-b3095bee.us5.manus.computer";
    expect(safeOrigin(request({
      origin,
      host: "127.0.0.1:3000",
      "x-forwarded-host": "127.0.0.1:3000",
      "x-forwarded-proto": "https",
    }))).toBe(origin);
  });

  it("rejects unrelated HTTPS origins behind the loopback development listener", () => {
    expect(() => safeOrigin(request({
      origin: "https://attacker.example",
      host: "127.0.0.1:3000",
      "x-forwarded-host": "127.0.0.1:3000",
      "x-forwarded-proto": "https",
    }))).toThrowError(TRPCError);
  });

  it("rejects insecure or credential-bearing origins", () => {
    for (const origin of ["http://8328-example.us5.manus.computer", "https://user:pass@localhost:3000"]) {
      expect(() => safeOrigin(request({ origin, host: "127.0.0.1:3000", "x-forwarded-proto": "https" }))).toThrowError(TRPCError);
    }
  });
});
