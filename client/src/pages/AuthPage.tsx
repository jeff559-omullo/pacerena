import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SpinnerButton } from "@/components/Primitives";

type Mode = "login" | "register" | "forgot" | "reset";
const headings: Record<Mode, { eyebrow: string; title: string; description: string }> = {
  login: { eyebrow: "PLAYER ACCESS", title: "Back for another?", description: "Sign in to pick up where the last whistle left off." },
  register: { eyebrow: "CREATE YOUR PLAYER CARD", title: "Claim your spot.", description: "Create your account and enter immediately. KES wallet eligibility is handled separately; no demo balance is issued." },
  forgot: { eyebrow: "ACCOUNT RECOVERY", title: "Reset your password.", description: "If an account exists, we’ll send a short-lived recovery link." },
  reset: { eyebrow: "ACCOUNT RECOVERY", title: "Choose a new password.", description: "Use a fresh password you haven’t used on Pace Arena before." },
};

function AuthFrame({ children }: { children: React.ReactNode }) {
  return <div className="auth-page"><aside className="auth-aside"><Link href="/" className="brand-lockup"><span className="brand-mark"><span /><span /><span /></span><span className="brand-name">PACE<span>ARENA</span></span></Link><div className="auth-quote"><div className="eyebrow"><span className="eyebrow-line" /> A BETTER WAY TO PLAY</div><h1>Your game.<br /><em>Your next fixture.</em></h1><p>Find a compatible opponent, agree on match terms and take the match to your own device. When enabled, KES credits are purchased through the partner site; withdrawals are processed manually.</p></div><div className="auth-note">INDEPENDENT COMMUNITY PLATFORM · NOT AFFILIATED WITH GAME PUBLISHERS</div></aside><main className="auth-form-side"><section className="auth-form-card">{children}</section></main></div>;
}

export default function AuthPage({ mode }: { mode: Mode }) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") ?? "" : "");
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "";
  const onAuthenticated = async () => {
    await utils.auth.me.invalidate();
    setLocation("/dashboard");
  };
  const register = trpc.auth.register.useMutation({ onSuccess: onAuthenticated, onError: error => setLocalError(error.message) });
  const login = trpc.auth.login.useMutation({ onSuccess: onAuthenticated, onError: error => setLocalError(error.message) });
  const forgot = trpc.auth.forgotPassword.useMutation({ onSuccess: result => setMessage(result.message), onError: error => setLocalError(error.message) });
  const reset = trpc.auth.resetPassword.useMutation({ onSuccess: () => { setMessage("Password changed. You can now sign in with your new password."); setTimeout(() => setLocation("/login"), 1200); }, onError: error => setLocalError(error.message) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    setMessage("");
    if (mode === "register") register.mutate({ email, username, password, referralCode: referralCode.trim() || undefined });
    if (mode === "login") login.mutate({ email, password });
    if (mode === "forgot") forgot.mutate({ email });
    if (mode === "reset") reset.mutate({ token, password });
  };
  const busy = register.isPending || login.isPending || forgot.isPending || reset.isPending;
  const copy = headings[mode];

  return <AuthFrame><div className="eyebrow-small">{copy.eyebrow}</div><h2>{copy.title}</h2><p>{copy.description}</p>
    {message ? <div className="page-stack"><div className="notice"><MailCheck size={17} style={{ verticalAlign: "-4px", color: "var(--lime)", marginRight: 8 }} />{message}</div><Link className="button button-ghost" href="/login">Back to sign in <ArrowRight size={15} /></Link></div> : <form className="auth-form" onSubmit={submit}>
      {mode === "register" && <div className="field"><label htmlFor="username">Player name</label><input id="username" className="input" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="e.g. NairobiNo9" required /><span className="field-help">3–24 letters, numbers or underscores. This is public; your email is not.</span></div>}
      {mode === "register" && <div className="field"><label htmlFor="referral-code">Referral code (optional)</label><input id="referral-code" className="input" value={referralCode} onChange={event => setReferralCode(event.target.value.toUpperCase())} maxLength={16} placeholder="ABCD1234" /><span className="field-help">Enter a code from your invite link if you were referred by a friend.</span></div>}
      {mode !== "reset" && <div className="field"><label htmlFor="email">Email address</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={320} placeholder="you@example.com" required /></div>}
      {(mode === "login" || mode === "register" || mode === "reset") && <div className="field"><label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label><input id="password" className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === "login" ? 1 : 10} maxLength={128} placeholder="At least 10 characters" required /><span className="field-help">Use at least 10 characters.</span></div>}
      {localError && <div className="notice notice-danger" role="alert">{localError}</div>}
      <SpinnerButton type="submit" busy={busy}>{mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Save new password"}<ArrowRight size={15} /></SpinnerButton>
    </form>}
    <div className="auth-switch">{mode === "login" ? <>New to the arena? <Link href="/register">Create an account</Link><div style={{ marginTop: 10 }}><Link href="/forgot-password">Forgot your password?</Link></div></> : mode === "register" ? <>Already registered? <Link href="/login">Sign in</Link></> : mode === "forgot" ? <>Remembered it? <Link href="/login">Back to sign in</Link></> : <>Return to <Link href="/login">sign in</Link></>}</div>
    {mode === "register" && <div className="field-help" style={{ marginTop: 21, textAlign: "center", lineHeight: 1.6 }}>Account access is immediate after registration. KES wallet and challenge features may be unavailable until verified server configuration is enabled. Match evidence is player-submitted and may require human review.</div>}
    <div style={{ marginTop: 24 }}><Link href="/" className="card-link"><ArrowLeft size={13} /> Back to Pace Arena</Link></div>
  </AuthFrame>;
}
