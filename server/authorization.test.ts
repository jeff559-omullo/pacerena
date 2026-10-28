import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function context(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const player: NonNullable<TrpcContext["user"]> = {
  id: 2,
  openId: "player-only-test",
  name: "Player",
  email: "player@example.invalid",
  loginMethod: "email_password",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("server-side route authorization", () => {
  it("blocks protected player routes for a guest", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.arena.dashboard()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("blocks every administrator procedure for an ordinary player before database access", async () => {
    const caller = appRouter.createCaller(context(player));
    await expect(caller.arena.admin.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
