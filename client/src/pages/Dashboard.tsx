import { Link } from "wouter";
import { ArrowRight, Clock3, Coins, Gamepad2, Plus, ShieldCheck, Swords, Trophy, WalletCards } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, StatusPill, formatDate } from "@/components/Primitives";
import { GAME_LABELS, PLATFORM_LABELS } from "@shared/pace";

export default function Dashboard() {
  const dashboard = trpc.arena.dashboard.useQuery(undefined, { refetchInterval: 30_000 });
  const challenges = trpc.arena.challenges.list.useQuery({}, { refetchInterval: 30_000 });
  const walletStatus = trpc.kesWallet.status.useQuery(undefined, { retry: false });
  const wallet = trpc.kesWallet.summary.useQuery(undefined, { retry: false, enabled: walletStatus.data?.walletEnabled === true });
  if (dashboard.isLoading) return <LoadingRows count={4} />;
  if (dashboard.isError || !dashboard.data) return <ErrorNotice message={dashboard.error?.message ?? "Dashboard data is unavailable."} onRetry={() => dashboard.refetch()} />;
  const profile = dashboard.data.profile;
  const setupNeeded = !profile?.preferredGame || !profile.gameEdition || !profile.platform;
  const walletEnabled = walletStatus.data?.walletEnabled === true;
  const wageringEnabled = walletStatus.data?.wageringEnabled === true;
  return <div className="page-stack">
    <PageTitle eyebrow="PLAYER DASHBOARD" title={`Good to see you${profile?.username ? `, ${profile.username}` : ""}.`} description="Track KES challenges, wallet reservations, match evidence and results. Credit purchases happen on the configured partner site." action={<Link href="/challenges/new" className="button button-primary"><Plus size={16} /> Create challenge</Link>} />
    {!walletEnabled && <div className="notice notice-warning" role="status"><strong>KES wallet is not enabled.</strong> KES crediting and wagering remain unavailable until secure server settings and partner configuration are complete.</div>}
    {wallet.data?.frozen && <div className="notice notice-warning" role="status"><strong>KES wallet under review.</strong> {wallet.data.freezeReason || "Wagering and withdrawals are paused while an administrator reviews the account."}</div>}
    {!wageringEnabled && walletEnabled && <div className="notice" role="status">The KES wallet is available, but new real-money challenges are currently paused.</div>}
    {setupNeeded && <div className="notice notice-warning"><strong>Complete your player card.</strong> Set your preferred game, edition and exact platform to see compatible challenges.<div style={{ marginTop: 10 }}><Link className="card-link" href="/profile">Finish profile <ArrowRight size={13} /></Link></div></div>}
    {dashboard.data.incomingInvitations > 0 && <div className="notice"><strong>{dashboard.data.incomingInvitations} private challenge invitation{dashboard.data.incomingInvitations === 1 ? "" : "s"} awaiting you.</strong> Review the exact game, platform and KES terms before you accept or decline.<div style={{ marginTop: 8 }}><Link className="card-link" href="/challenges">Review invitations <ArrowRight size={13} /></Link></div></div>}
    <section className="grid-3" aria-label="Player statistics">
      <div className="card stat-card accent-stat"><span className="stat-icon"><Coins size={16} /></span><div className="stat-label">Available KES</div><div className="stat-value">{walletEnabled ? wallet.data?.availableKes?.toLocaleString() ?? "—" : "—"}</div><div className="stat-foot">{walletEnabled ? "Available to withdraw or reserve" : "Wallet not configured"}</div></div>
      <div className="card stat-card"><span className="stat-icon"><WalletCards size={16} /></span><div className="stat-label">Reserved KES</div><div className="stat-value">{walletEnabled ? wallet.data?.reservedKes?.toLocaleString() ?? "—" : "—"}</div><div className="stat-foot">Open challenges, matches and withdrawals</div></div>
      <div className="card stat-card"><span className="stat-icon"><Swords size={16} /></span><div className="stat-label">Compatible challenges</div><div className="stat-value">{wageringEnabled ? challenges.data?.length ?? dashboard.data.openChallenges : 0}</div><div className="stat-foot">Filtered to your selected platform</div></div>
    </section>
    <section className="grid-2">
      <div><div className="section-row"><h3>Open challenges</h3><Link href="/challenges">Browse all <ArrowRight size={13} /></Link></div>
        {challenges.isLoading ? <LoadingRows count={2} /> : challenges.isError ? <ErrorNotice message={challenges.error.message} onRetry={() => challenges.refetch()} /> : challenges.data?.length ? <div className="challenge-list">{challenges.data.slice(0, 4).map(challenge => <Link className="challenge-card" key={challenge.id} href={`/challenges/${challenge.id}`}><div className="challenge-main"><div className="challenge-topline"><strong>{challenge.creator.username}</strong><StatusPill status={challenge.isInvitation ? "invitation" : "open"} /></div><div className="meta-line"><span><Gamepad2 size={12} />{GAME_LABELS[challenge.game]}</span><span>{challenge.edition}</span><span>{PLATFORM_LABELS[challenge.platform]}</span></div><div className="meta-line"><span><Clock3 size={12} />Closes {formatDate(challenge.expiresAt)}</span>{challenge.isInvitation && <strong>Private invite</strong>}</div></div><div><div className="stake-value">KES {challenge.stake.toLocaleString()}</div><div className="stake-caption">per player</div></div></Link>)}</div> : <EmptyState title={!wageringEnabled ? "KES challenges are paused" : setupNeeded ? "Set your game profile first" : "No compatible challenges yet"} icon={Gamepad2}>{!wageringEnabled ? "New challenges appear when the server-side real-wagering gate is enabled." : setupNeeded ? "Choose your game edition and platform to filter opponents correctly." : "New fixtures appear here when other eligible players publish them."}</EmptyState>}
      </div>
      <div><div className="section-row"><h3>Recent matches</h3><Link href="/matches">Match history <ArrowRight size={13} /></Link></div>
        {dashboard.data.matches.length ? <div className="match-list">{dashboard.data.matches.slice(0, 5).map(match => <Link className="challenge-card" key={match.id} href={`/matches/${match.id}`}><div className="challenge-main"><div className="challenge-topline"><strong>Fixture #{match.id}</strong><StatusPill status={match.status} /></div><div className="meta-line"><span>Stake {match.stakeCurrency === "KES" ? `KES ${match.myStake}` : `${match.myStake} demo · non-cash`}</span><span>{formatDate(match.createdAt)}</span></div></div><ArrowRight size={15} color="var(--lime)" /></Link>)}</div> : <EmptyState title="Your first fixture starts here" icon={Trophy}>Accept a compatible KES challenge or create one to open your match room.</EmptyState>}
      </div>
    </section>
    <section className="grid-2"><div className="card"><div className="card-header"><div><h3>Matchmaking rules</h3><p>Compatibility stays conservative until verified.</p></div><ShieldCheck size={17} color="var(--lime)" /></div><div className="notice">Only the same game family, edition and supported platform can be matched. Cross-play between mobile, PC, PlayStation and Xbox is never assumed.</div></div><div className="card"><div className="card-header"><div><h3>Recent notifications</h3><p>Persisted in your account</p></div><Link className="card-link" href="/notifications">View <ArrowRight size={13} /></Link></div>{dashboard.data.notifications.length ? <div className="notification-list">{dashboard.data.notifications.slice(0, 3).map(item => <div key={item.id} className="notice"><strong>{item.title}</strong><div>{item.body}</div><small className="field-help">{formatDate(item.createdAt)}</small></div>)}</div> : <p className="field-help">No unread notifications.</p>}</div></section>
  </div>;
}
