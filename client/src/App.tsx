import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AppShell from "./components/AppShell";
const Home = lazy(() => import("./pages/Home"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ChallengePages = lazy(() => import("./pages/ChallengePages"));
const MatchPages = lazy(() => import("./pages/MatchPages"));
const WalletPages = lazy(() => import("./pages/WalletPages"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const DisputePages = lazy(() => import("./pages/DisputePages"));
const AdminPages = lazy(() => import("./pages/AdminPages"));
const PlayersPage = lazy(() => import("./pages/PlayersPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
import { trpc } from "./lib/trpc";

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
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster richColors position="top-right" /><Suspense fallback={<LoadingScreen />}><Router /></Suspense></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
