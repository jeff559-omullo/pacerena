import { Link, useLocation } from "wouter";
import { Activity, Bell, ChevronDown, Gamepad2, LayoutDashboard, LogOut, Shield, Swords, UserRound, UsersRound, WalletCards } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const primaryLinks = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/challenges", label: "Challenges", icon: Swords },
  { href: "/players", label: "Players", icon: UsersRound },
  { href: "/matches", label: "My matches", icon: Activity },
];
const accountLinks = [
  { href: "/wallet", label: "KES wallet", icon: WalletCards },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile & settings", icon: UserRound },
];

function Brand() {
  return <Link href="/dashboard" className="brand-lockup" aria-label="Pace Arena dashboard"><span className="brand-mark"><span /><span /><span /></span><span className="brand-name">PACE<span>ARENA</span></span></Link>;
}

export default function AppShell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const [location] = useLocation();
  const [, setLocation] = useLocation();
  const session = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 20_000 });
  const wallet = trpc.kesWallet.summary.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const unread = trpc.arena.notifications.list.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await session.refetch();
      toast.success("You are signed out.");
      setLocation("/");
    },
    onError: error => toast.error(error.message),
  });
  const profile = trpc.arena.profile.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const title = location.startsWith("/challenges") ? "Challenges" : location.startsWith("/players") ? "Players" : location.startsWith("/matches") ? "Matches" : location.startsWith("/wallet") || location.startsWith("/transactions") ? "KES wallet" : location.startsWith("/notifications") ? "Notifications" : location.startsWith("/admin") ? "Operations" : location.startsWith("/profile") || location.startsWith("/settings") ? "Your profile" : "Overview";
  const badge = unread.data?.filter(item => !item.readAt).length ?? 0;
  const initials = (profile.data?.username ?? session.data?.name ?? "PA").slice(0, 2).toUpperCase();

  return <div className="app-frame">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-caption">PLAY</div>
      <nav aria-label="Main navigation" className="side-nav">
        {primaryLinks.map(item => <Link key={item.href} href={item.href} className={`nav-link ${location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href)) ? "active" : ""}`}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.href === "/notifications" && badge > 0 ? <b className="nav-count">{badge}</b> : null}</Link>)}
      </nav>
      <div className="sidebar-caption section-caption">YOUR ARENA</div>
      <nav aria-label="Account navigation" className="side-nav">
        {accountLinks.map(item => <Link key={item.href} href={item.href} className={`nav-link ${location === item.href ? "active" : ""}`}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.href === "/notifications" && badge > 0 ? <b className="nav-count">{badge}</b> : null}</Link>)}
        {session.data?.role === "admin" && <Link href="/admin" className={`nav-link ${location.startsWith("/admin") ? "active" : ""}`}><Shield size={18} /><span>Admin tools</span></Link>}
        {session.data?.role === "admin" && <Link href="/admin/withdrawals" className={`nav-link ${location === "/admin/withdrawals" ? "active" : ""}`}><WalletCards size={18} /><span>M-Pesa withdrawals</span></Link>}
      </nav>
      <div className="sidebar-bottom">
        <button className="user-menu" onClick={() => logout.mutate()} disabled={logout.isPending} aria-label="Sign out"><span className="avatar" style={{ background: profile.data?.avatarColor ?? "#B7F34A" }}>{initials}</span><span className="user-info"><strong>{profile.data?.username ?? "Player"}</strong><small>{session.data?.role === "admin" ? "Administrator" : "Player"}</small></span><LogOut size={16} /></button>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div><div className="breadcrumb">PACE ARENA <span>/</span> {admin ? "ADMIN" : title.toUpperCase()}</div><h1>{admin ? "Operations desk" : title}</h1></div><div className="topbar-actions"><Link href="/wallet" className="balance-pill"><WalletCards size={16} /><strong>{wallet.data?.availableKes?.toLocaleString() ?? "—"}</strong><span>KES</span></Link><Link href="/notifications" className="icon-button" aria-label={`Notifications${badge ? `, ${badge} unread` : ""}`}><Bell size={18} />{badge > 0 && <i className="notification-dot" />}</Link><Link href="/profile" className="top-profile"><span className="avatar small" style={{ background: profile.data?.avatarColor ?? "#B7F34A" }}>{initials}</span><ChevronDown size={14} /></Link></div></header>
      <main className="workspace">{children}</main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {[
        { href: "/dashboard", label: "Home", icon: LayoutDashboard },
        { href: "/challenges", label: "Play", icon: Gamepad2 },
        { href: "/players", label: "Players", icon: UsersRound },
        { href: "/matches", label: "Matches", icon: Activity },
        { href: "/wallet", label: "Wallet", icon: WalletCards },
        { href: "/profile", label: "Profile", icon: UserRound },
      ].map(item => <Link key={item.href} href={item.href} className={location === item.href ? "mobile-active" : ""}><item.icon size={19} /><span>{item.label}</span></Link>)}
    </nav>
  </div>;
}
