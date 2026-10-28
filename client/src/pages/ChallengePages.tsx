import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Clock3, Gamepad2, Plus, ShieldCheck, Swords, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { DEFAULT_MATCH_MINUTES, GAME_LABELS, PLATFORM_LABELS, STAKE_MAX, STAKE_MIN } from "@shared/pace";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, StatusPill, formatDate, SpinnerButton } from "@/components/Primitives";

const platforms = Object.entries(PLATFORM_LABELS) as [keyof typeof PLATFORM_LABELS, string][];

type ChallengeMode = "list" | "new" | "details";
export default function ChallengePages({ mode, id }: { mode: ChallengeMode; id?: number }) {
  if (mode === "new") return <CreateChallenge />;
  if (mode === "details") return <ChallengeDetail id={id ?? 0} />;
  return <ChallengeList />;
}

function ChallengeList() {
  const [game, setGame] = useState("");
  const [edition, setEdition] = useState("");
  const [platform, setPlatform] = useState("");
  const [minStake, setMinStake] = useState("");
  const [maxStake, setMaxStake] = useState("");
  const [availability, setAvailability] = useState("");
  const query = trpc.arena.challenges.list.useQuery({
    game: (game || undefined) as "efootball" | "ea_fc" | undefined,
    edition: edition || undefined,
    platform: (platform || undefined) as keyof typeof PLATFORM_LABELS | undefined,
    stakeMin: minStake ? Number(minStake) : undefined,
    stakeMax: maxStake ? Number(maxStake) : undefined,
    availability: (availability || undefined) as "available" | "away" | undefined,
  }, { refetchInterval: 30_000 });
  const items = query.data ?? [];

  return <div>
    <PageTitle eyebrow="MATCHMAKING" title="Challenges & invitations" description="Browse compatible open fixtures and private challenges sent directly to you." action={<Link className="button button-primary" href="/challenges/new"><Plus size={16} /> Create challenge</Link>} />
    <div className="notice" style={{ marginBottom: 16 }}><ShieldCheck size={14} style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--lime)" }} />Cross-play is not assumed. Public matchmaking uses the same game edition and specific platform.</div>
    <div className="filters" aria-label="Challenge filters">
      <select className="select" value={game} onChange={event => setGame(event.target.value)} aria-label="Filter by game"><option value="">All game families</option>{Object.entries(GAME_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
      <input className="input" value={edition} onChange={event => setEdition(event.target.value)} placeholder="Exact edition" aria-label="Filter by game edition" />
      <select className="select" value={platform} onChange={event => setPlatform(event.target.value)} aria-label="Filter by platform"><option value="">All platforms</option>{platforms.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select className="select" value="same" disabled aria-label="Compatible cross-play group"><option value="same">Same platform only</option></select>
      <input className="input" type="number" min={0} value={minStake} onChange={event => setMinStake(event.target.value)} placeholder="Min stake" aria-label="Minimum stake" />
      <input className="input" type="number" min={0} value={maxStake} onChange={event => setMaxStake(event.target.value)} placeholder="Max stake" aria-label="Maximum stake" />
      <select className="select" value={availability} onChange={event => setAvailability(event.target.value)} aria-label="Filter by creator availability"><option value="">Available challenges</option><option value="available">Open to challenges</option><option value="away">Away</option></select>
    </div>
    {query.isLoading ? <LoadingRows /> : query.isError ? <ErrorNotice message={query.error.message} onRetry={() => query.refetch()} /> : items.length ? <div className="challenge-list">{items.map(item => <Link className="challenge-card" key={item.id} href={`/challenges/${item.id}`}>
      <div className="challenge-main">
        <div className="challenge-topline"><span className="avatar" style={{ background: item.creator.avatarColor }}>{item.creator.username.slice(0, 2).toUpperCase()}</span><strong>{item.creator.username}</strong><StatusPill status={item.isInvitation ? "invitation" : "open"} /></div>
        <div className="meta-line"><span><Gamepad2 size={13} />{GAME_LABELS[item.game]}</span><span>{item.edition}</span><span>{PLATFORM_LABELS[item.platform]}</span></div>
        <div className="meta-line"><span><Clock3 size={12} />Expires {formatDate(item.expiresAt)}</span><span>{item.matchMinutes} min</span>{item.isInvitation && <strong>Sent directly to you</strong>}</div>
        {item.description && <p className="field-help">{item.description}</p>}
      </div>
      <div><div className="stake-value">{item.stake.toLocaleString()}</div><div className="stake-caption">credits / player</div><div className="stake-caption" style={{ marginTop: 8 }}>View terms <ArrowRight size={10} style={{ verticalAlign: "-2px" }} /></div></div>
    </Link>)}</div> : <EmptyState title="No open compatible fixtures" icon={UsersRound}>Try changing the filters, set an exact game/platform on your profile, or create a new challenge. Private invitations addressed to you stay visible here.</EmptyState>}
  </div>;
}

function CreateChallenge() {
  const [, setLocation] = useLocation();
  const wallet = trpc.arena.wallet.summary.useQuery();
  const rules = trpc.arena.settings.rules.useQuery();
  const utils = trpc.useUtils();
  const [game, setGame] = useState<"efootball" | "ea_fc">("efootball");
  const [edition, setEdition] = useState("");
  const [platform, setPlatform] = useState<keyof typeof PLATFORM_LABELS>("ps5");
  const [stake, setStake] = useState(100);
  const [minutes, setMinutes] = useState(12);
  const [expiryHours, setExpiryHours] = useState(24);
  const [description, setDescription] = useState("");
  const [settings, setSettings] = useState("Online friendly · default squads");
  const [inviteUsername, setInviteUsername] = useState("");
  const minimumStake = rules.data?.minimumStake ?? STAKE_MIN;
  const maximumStake = rules.data?.maximumStake ?? STAKE_MAX;
  const defaultMinutes = rules.data?.defaultMatchMinutes ?? DEFAULT_MATCH_MINUTES;
  const creationPaused = rules.data?.challengeCreationEnabled === false;
  useEffect(() => {
    setStake(current => Math.max(minimumStake, Math.min(maximumStake, current)));
    setMinutes(defaultMinutes);
  }, [minimumStake, maximumStake, defaultMinutes]);
  const create = trpc.arena.challenges.create.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.arena.wallet.summary.invalidate(), utils.arena.dashboard.invalidate(), utils.arena.challenges.list.invalidate()]);
      toast.success(inviteUsername.trim() ? "Private invitation sent; your stake is reserved." : "Challenge posted. Your stake is reserved.");
      setLocation(`/challenges/${result.id}`);
    },
    onError: error => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!edition.trim()) { toast.error("Enter the exact game edition used for this fixture."); return; }
    create.mutate({ game, edition: edition.trim(), platform, stake, matchMinutes: minutes, expiryHours, description: description.trim() || undefined, settings: settings.trim() || undefined, inviteUsername: inviteUsername.trim() || undefined });
  };

  return <div className="page-stack">
    <PageTitle eyebrow="NEW FIXTURE" title="Create a challenge" description="Pick precise terms. Your demo stake is reserved when the challenge is posted; cancelling, declining a direct invitation, or expiry returns it." />
    {rules.data?.maintenanceNotice && <div className="notice" role="status">{rules.data.maintenanceNotice}</div>}
    {creationPaused && <div className="notice notice-warning" role="status">New challenge creation is paused by an administrator. Existing challenge terms remain unchanged.</div>}
    {rules.isError && <ErrorNotice message="Current challenge rules could not be loaded. Retry before publishing." onRetry={() => rules.refetch()} />}
    <div className="grid-2"><section className="card"><div className="card-header"><div><h3>Match terms</h3><p>Only compatible players can accept.</p></div><Swords size={17} color="var(--lime)" /></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label htmlFor="game">Game family</label><select id="game" className="select" value={game} onChange={event => setGame(event.target.value as typeof game)}><option value="efootball">eFootball / PES</option><option value="ea_fc">EA Sports FC / FIFA</option></select></div>
          <div className="field"><label htmlFor="edition">Exact edition</label><input id="edition" className="input" value={edition} onChange={event => setEdition(event.target.value)} maxLength={48} placeholder="e.g. eFootball 2026" required /></div>
          <div className="field"><label htmlFor="platform">Gaming platform</label><select id="platform" className="select" value={platform} onChange={event => setPlatform(event.target.value as typeof platform)}>{platforms.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          <div className="field"><label htmlFor="stake">Stake · {minimumStake}–{maximumStake.toLocaleString()} credits</label><input id="stake" className="input" type="number" min={minimumStake} max={maximumStake} step={1} value={stake} onChange={event => setStake(Number(event.target.value))} required /><span className="field-help">Available balance: {wallet.data?.availableCredits?.toLocaleString() ?? "…"} demo credits</span></div>
          <div className="field"><label htmlFor="minutes">Match length (minutes)</label><select id="minutes" className="select" value={minutes} onChange={event => setMinutes(Number(event.target.value))}>{Array.from(new Set([6, 8, 10, 12, 15, 20, 30, defaultMinutes])).sort((a, b) => a - b).map(value => <option key={value} value={value}>{value} minutes{value === defaultMinutes ? " · default" : ""}</option>)}</select></div>
          <div className="field"><label htmlFor="expiry">Invitation expiry</label><select id="expiry" className="select" value={expiryHours} onChange={event => setExpiryHours(Number(event.target.value))}>{[1, 6, 12, 24, 48, 72].map(value => <option key={value} value={value}>{value} hours</option>)}</select></div>
          <div className="field full"><label htmlFor="settings">Agreed match settings</label><input id="settings" className="input" value={settings} onChange={event => setSettings(event.target.value)} maxLength={500} /></div>
          <div className="field full"><label htmlFor="description">Description (optional)</label><textarea id="description" className="textarea" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} placeholder="Add a short note about your fixture." /></div>
          <div className="field full"><label htmlFor="invite-username">Invite a specific player (optional)</label><input id="invite-username" className="input" value={inviteUsername} onChange={event => setInviteUsername(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="Player username" /><span className="field-help">Only this eligible, available, compatible player can see, accept or decline the invitation. Leave blank for a public open challenge.</span></div>
        </div>
        <div className="notice notice-warning" style={{ marginTop: 17 }}><strong>Stake reservation:</strong> {stake.toLocaleString()} demo credits will move from available to reserved when you publish. No money is involved. Same edition and exact platform only.</div>
        <div className="form-actions"><Link className="button button-ghost" href="/challenges">Cancel</Link><SpinnerButton type="submit" busy={create.isPending} disabled={creationPaused || rules.isLoading || rules.isError}><Plus size={15} /> Publish challenge</SpinnerButton></div>
      </form>
    </section><aside className="page-stack">
      <div className="card"><div className="card-header"><div><h3>How acceptance works</h3><p>One opponent, one atomic acceptance.</p></div><ShieldCheck size={17} color="var(--lime)" /></div><div className="page-stack"><div className="notice"><strong>1 · Your stake is held.</strong><br />Your published terms remain backed by your available demo balance.</div><div className="notice"><strong>2 · One eligible rival accepts.</strong><br />The backend locks the challenge and reserves their stake in one transaction.</div><div className="notice"><strong>3 · The private room opens.</strong><br />Both players review the same agreed terms before readiness.</div></div></div>
      <div className="card"><div className="eyebrow-small">NO CROSS-PLAY ASSUMPTIONS</div><p className="field-help" style={{ marginTop: 10 }}>Pace Arena matches the same named platform and game edition. For example, PS5 is not grouped with PS4, and mobile is not grouped with console.</p></div>
    </aside></div>
  </div>;
}

function ChallengeDetail({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const profile = trpc.arena.profile.me.useQuery(undefined, { retry: false });
  const query = trpc.arena.challenges.details.useQuery({ id }, { retry: false });
  const accept = trpc.arena.challenges.accept.useMutation({
    onSuccess: async result => { await Promise.all([utils.arena.challenges.list.invalidate(), utils.arena.wallet.summary.invalidate(), utils.arena.matches.list.invalidate()]); setLocation(`/matches/${result.matchId}`); },
    onError: error => toast.error(error.message),
  });
  const cancel = trpc.arena.challenges.cancel.useMutation({
    onSuccess: async () => { await Promise.all([utils.arena.challenges.details.invalidate(), utils.arena.wallet.summary.invalidate()]); toast.success("Challenge cancelled and stake released."); },
    onError: error => toast.error(error.message),
  });
  const decline = trpc.arena.challenges.decline.useMutation({
    onSuccess: async () => { await Promise.all([utils.arena.challenges.details.invalidate(), utils.arena.challenges.list.invalidate(), utils.arena.wallet.summary.invalidate(), utils.arena.dashboard.invalidate()]); toast.success("Invitation declined. The creator's demo stake was returned."); },
    onError: error => toast.error(error.message),
  });
  if (query.isLoading) return <LoadingRows count={2} />;
  if (query.isError || !query.data) return <ErrorNotice message={query.error?.message ?? "Challenge could not be loaded."} onRetry={() => query.refetch()} />;
  const item = query.data;
  const own = item.isOwner;
  const availableToAccept = item.creator.availability === "available" && profile.data?.availability === "available";
  const expired = new Date(item.expiresAt).getTime() <= Date.now();

  return <div className="page-stack"><PageTitle eyebrow="FIXTURE TERMS" title={`Challenge #${item.id}`} description="Check the edition, platform, stake and expiry before confirming." action={<Link className="button button-ghost" href="/challenges">Back to challenges</Link>} />
    <section className="card"><div className="match-toolbar"><StatusPill status={item.status} /><span className="field-help">Posted {formatDate(item.createdAt)}</span></div>
      {item.isDirectInvitation && <div className="notice" style={{ marginBottom: 16 }}><strong>Private invitation{item.inviteTarget ? ` for @${item.inviteTarget}` : ""}.</strong> This challenge is visible only to its selected recipient and creator.</div>}
      <div className="two-sided"><div className="participant"><span className="avatar" style={{ background: item.creator.avatarColor }}>{item.creator.username.slice(0, 2).toUpperCase()}</span><div><strong>{item.creator.username}</strong><small>Creator · {item.creator.availability === "available" ? "Open to challenges" : "Away"}</small></div></div><div className="versus">VS</div><div className="participant"><span className="avatar" style={{ background: "#263020", color: "var(--lime)" }}>?</span><div><strong>{item.isDirectInvitation ? item.inviteTarget ?? "Invited player" : "Eligible opponent"}</strong><small>Same edition and platform</small></div></div></div>
      <div className="grid-3" style={{ marginTop: 22 }}><div className="card stat-card"><div className="stat-label">Game</div><div className="stat-value" style={{ font: "16px 'Space Grotesk'", marginTop: 15 }}>{GAME_LABELS[item.game]}</div><div className="stat-foot">{item.edition}</div></div><div className="card stat-card"><div className="stat-label">Platform</div><div className="stat-value" style={{ font: "16px 'Space Grotesk'", marginTop: 15 }}>{PLATFORM_LABELS[item.platform]}</div><div className="stat-foot">Exact-platform matchmaking</div></div><div className="card stat-card"><div className="stat-label">Stake each</div><div className="stat-value" style={{ color: "var(--lime)" }}>{item.stake.toLocaleString()}</div><div className="stat-foot">{(item.stake * 2).toLocaleString()} demo-credit pool</div></div></div>
      <div className="grid-2" style={{ marginTop: 17 }}><div className="notice"><strong>Match length and settings</strong><br />{item.matchMinutes} minutes · {item.settings || "Agreed with opponent"}</div><div className="notice"><strong>Invitation expiry</strong><br />{formatDate(item.expiresAt)}</div></div>
      {item.description && <p className="notice" style={{ marginTop: 15 }}>{item.description}</p>}
      <div className="notice notice-warning" style={{ marginTop: 16 }}>Demo credits have no monetary value. Your stake is reserved and cannot be used elsewhere until this challenge is accepted, cancelled, declined, or expires.</div>
      {!own && item.status === "open" && !availableToAccept && <p className="field-help">Both you and the creator must be marked Open to challenges before acceptance. You may still decline a private invitation.</p>}
      <div className="form-actions">
        {own && item.status === "open" && <SpinnerButton className="button button-danger" busy={cancel.isPending} onClick={() => { if (window.confirm("Cancel this open challenge and release its reserved demo stake?")) cancel.mutate({ id: item.id }); }}>Cancel challenge</SpinnerButton>}
        {!own && item.isInvitationForYou && item.status === "open" && <SpinnerButton className="button button-ghost" busy={decline.isPending} onClick={() => { if (window.confirm("Decline this direct invitation? The creator's reserved demo stake will be returned.")) decline.mutate({ id: item.id }); }}>Decline invitation</SpinnerButton>}
        {!own && item.status === "open" && !expired && <SpinnerButton busy={accept.isPending} disabled={!availableToAccept} onClick={() => { if (window.confirm(`Accept this challenge and reserve ${item.stake} of your demo credits? No money is involved.`)) accept.mutate({ id: item.id }); }}>Accept challenge <ArrowRight size={15} /></SpinnerButton>}
        {item.status === "accepted" && <Link className="button button-primary" href="/matches">Open your match room <ArrowRight size={15} /></Link>}
      </div>
    </section>
  </div>;
}
