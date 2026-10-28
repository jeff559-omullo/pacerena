import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authRouter } from "./auth";
import { arenaRouter } from "./arena";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  arena: arenaRouter,
});

export type AppRouter = typeof appRouter;
