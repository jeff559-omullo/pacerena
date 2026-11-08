import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authRouter } from "./auth";
import { arenaRouter } from "./arena";
import { kesWalletRouter } from "./kes-wallet";
import { referralRouter } from "./referral";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  arena: arenaRouter,
  kesWallet: kesWalletRouter,
  referral: referralRouter,
});

export type AppRouter = typeof appRouter;
