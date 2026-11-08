import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AppShell from "./components/AppShell";
const Home = lazy(() => import("./pages/Home"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ChallengePages = lazy(() => import("./pages/ChallengePages"));
const MatchPages = lazy(() => import("./pages/MatchPages"));
const WalletPages = lazy(() => import("./pages/WalletPages"));
const ReferralPage = lazy(() => import("./pages/ReferralPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const DisputePages = lazy(() => import("./pages/DisputePages"));
const AdminPages = lazy(() => import("./pages/AdminPages"));
const PlayersPage = lazy(() => import("./pages/PlayersPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
import { trpc } from "./lib/trpc";

const MAX_HEALTH_ATTEMPTS = 6;

function getHealthRetryDelay(attempt: number) {
  return Math.min(600 * 2 ** attempt, 8000);
}

function StartupLoadingScreen({ status, attempt, onRetry }: { status: "checking" | "retrying" | "offline"; attempt: number; onRetry: () => void }) {
  const isOffline = status === "offline";
  return <div className="startup-screen" role="status" aria-live="polite">
    <div className="startup-shell">
      <div className="startup-brand" aria-label="Pace Arena">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-name">PACE<span>ARENA</span></span>
      </div>
      <div className="startup-ring" aria-hidden="true">
        <span className="startup-ring-core" />
      </div>
      <div className="startup-copy">
        <div className="eyebrow"><span className="eyebrow-line" /> READYING THE ARENA</div>
        <h1>Preparing Your Arena</h1>
        <p>{isOffline ? "Pace Arena is having trouble reaching the backend. Check your connection and retry when the server is ready." : status === "retrying" ? `Checking backend availability (${attempt}/${MAX_HEALTH_ATTEMPTS})…` : "Syncing the arena and verifying server health."}</p>
      </div>
      {isOffline && <button type="button" className="button button-primary" onClick={onRetry}>Retry connection</button>}
      {!isOffline && <div className="startup-status"><span className="startup-status-dot" />{status === "retrying" ? "Retrying backend check" : "Waiting for server health"}</div>}
    </div>
  </div>;
}

function useStartupGate() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"checking" | "retrying" | "offline">("checking");
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const cancelPending = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  };

  const beginCheck = (nextAttempt: number) => {
    cancelPending();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus(nextAttempt > 0 ? "retrying" : "checking");
    setAttempt(nextAttempt);

    fetch("/api/health", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.ok) {
        setReady(true);
        cancelPending();
        return;
      }
      const maxAttemptsReached = nextAttempt >= MAX_HEALTH_ATTEMPTS - 1;
      if (maxAttemptsReached) {
        setStatus("offline");
        return;
      }
      const delay = getHealthRetryDelay(nextAttempt);
      timeoutRef.current = window.setTimeout(() => beginCheck(nextAttempt + 1), delay);
    }).catch(() => {
      if (controller.signal.aborted) return;
      const maxAttemptsReached = nextAttempt >= MAX_HEALTH_ATTEMPTS - 1;
      if (maxAttemptsReached) {
        setStatus("offline");
        return;
      }
      const delay = getHealthRetryDelay(nextAttempt);
      timeoutRef.current = window.setTimeout(() => beginCheck(nextAttempt + 1), delay);
    });
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    beginCheck(0);
    return () => {
      cancelPending();
    };
  }, []);

  return {
    ready,
    status,
    attempt,
    retry: () => beginCheck(0),
  };
}

function LoadingScreen() {
  return <div className="loading-screen" role="status"><span className="spinner" />Checking your session…</div>;
}

function PlayerRoute({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const session = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 20_000 });
  useEffect(() => {
    if (!session.isLoading && !session.data) setLocation("/login");
  }, [session.data, session.isLoading, setLocation]);
  if (session.isLoading || session.isError || !session.data) return <LoadingScreen />;
  return <AppShell>{children}</AppShell>;
}

function AdminRoute() {
  const [, setLocation] = useLocation();
  const session = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 20_000 });
  useEffect(() => {
    if (!session.isLoading && !session.data) setLocation("/login");
  }, [session.data, session.isLoading, setLocation]);
  if (session.isLoading || session.isError || !session.data) return <LoadingScreen />;
  if (session.data.role !== "admin") return <AppShell><section className="card access-denied"><span className="eyebrow">Restricted area</span><h1>Admin access only</h1><p>Your account does not have administrator authorization. Existing administrators control role changes through a reason-recorded, audited server action.</p></section></AppShell>;
  return <AppShell admin>{<AdminPages />}</AppShell>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/register">{() => <AuthPage mode="register" />}</Route>
    <Route path="/login">{() => <AuthPage mode="login" />}</Route>
    <Route path="/reset-password">{() => <AuthPage mode="reset" />}</Route>
    <Route path="/forgot-password">{() => <AuthPage mode="forgot" />}</Route>
    <Route path="/dashboard">{() => <PlayerRoute><Dashboard /></PlayerRoute>}</Route>
    <Route path="/players">{() => <PlayerRoute><PlayersPage /></PlayerRoute>}</Route>
    <Route path="/challenges">{() => <PlayerRoute><ChallengePages mode="list" /></PlayerRoute>}</Route>
    <Route path="/challenges/new">{() => <PlayerRoute><ChallengePages mode="new" /></PlayerRoute>}</Route>
    <Route path="/challenges/:id">{params => <PlayerRoute><ChallengePages mode="details" id={Number(params.id)} /></PlayerRoute>}</Route>
    <Route path="/matches">{() => <PlayerRoute><MatchPages mode="list" /></PlayerRoute>}</Route>
    <Route path="/matches/:id/evidence">{params => <PlayerRoute><MatchPages mode="evidence" id={Number(params.id)} /></PlayerRoute>}</Route>
    <Route path="/matches/:id">{params => <PlayerRoute><MatchPages mode="details" id={Number(params.id)} /></PlayerRoute>}</Route>
    <Route path="/wallet">{() => <PlayerRoute><WalletPages mode="wallet" /></PlayerRoute>}</Route>
    <Route path="/transactions">{() => <PlayerRoute><WalletPages mode="transactions" /></PlayerRoute>}</Route>
    <Route path="/referrals">{() => <PlayerRoute><ReferralPage /></PlayerRoute>}</Route>
    <Route path="/notifications">{() => <PlayerRoute><NotificationsPage /></PlayerRoute>}</Route>
    <Route path="/disputes/new">{() => <PlayerRoute><DisputePages mode="new" /></PlayerRoute>}</Route>
    <Route path="/disputes/:id">{params => <PlayerRoute><DisputePages mode="details" id={Number(params.id)} /></PlayerRoute>}</Route>
    <Route path="/profile">{() => <PlayerRoute><SettingsPage /></PlayerRoute>}</Route>
    <Route path="/settings">{() => <PlayerRoute><SettingsPage /></PlayerRoute>}</Route>
    <Route path="/admin">{() => <AdminRoute />}</Route>
    <Route path="/admin/withdrawals">{() => <AdminRoute />}</Route>
    <Route path="/admin/disputes">{() => <AdminRoute />}</Route>
    <Route path="/admin/matches/:id">{() => <AdminRoute />}</Route>
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  const startup = useStartupGate();

  if (!startup.ready) {
    return <ErrorBoundary><ThemeProvider defaultTheme="dark"><StartupLoadingScreen status={startup.status} attempt={startup.attempt} onRetry={startup.retry} /></ThemeProvider></ErrorBoundary>;
  }

  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster richColors position="top-right" /><Suspense fallback={<LoadingScreen />}><Router /></Suspense></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
