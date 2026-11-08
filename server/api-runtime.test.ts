import { describe, expect, it, vi } from "vitest";
import { safeJsonFetch } from "../client/src/lib/safeFetch";

describe("safeJsonFetch", () => {
  it("turns an empty 404 into a valid JSON error payload", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 404, statusText: "Not Found", headers: { "content-type": "text/html" } }));

    try {
      const response = await safeJsonFetch("/api/trpc");
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({
        error: { message: expect.stringMatching(/backend API is unavailable|empty or invalid response/i) },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
