import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

function request(hostname: string, headers: Record<string, string> = {}) {
  return { hostname, get: (key: string) => headers[key.toLowerCase()] } as unknown as Request;
}

describe("Pace Arena session cookie transport", () => {
  it("keeps plain localhost development usable without Secure-only cookies", () => {
    const options = getSessionCookieOptions(request("localhost"));
    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(false);
    expect(options.httpOnly).toBe(true);
  });

  it("allows the public HTTPS Preview cookie in the cross-site iframe", () => {
    const options = getSessionCookieOptions(request("internal-proxy", { "x-forwarded-proto": "https" }));
    expect(options.sameSite).toBe("none");
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
  });
});
