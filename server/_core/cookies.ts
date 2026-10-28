import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(req: Request): CookieOptions {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const hostname = req.hostname.toLowerCase();
  const localPlainHttp = ["localhost", "127.0.0.1", "::1"].includes(hostname) && forwardedProtocol !== "https";
  // Cloud Preview is public HTTPS even when the upstream Express hop is HTTP.
  return localPlainHttp
    ? { httpOnly: true, path: "/", sameSite: "lax", secure: false }
    : { httpOnly: true, path: "/", sameSite: "none", secure: true };
}
