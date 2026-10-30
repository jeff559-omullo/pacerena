import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ClipboardList, FileSearch, Shield, ShieldAlert, SlidersHorizontal, UserCog } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ErrorNotice, EmptyState, LoadingRows, PageTitle, StatusPill, formatDate, SpinnerButton } from "@/components/Primitives";

export default function AdminPages() {
  const [path] = useLocation();
  if (path === "/admin/disputes") return <AdminDisputes />;
  const matchRoute = path.match(/^\/admin\/matches\/(\d+)$/);
  if (matchRoute) return <AdminMatchReview id={Number(matchRoute[1])} />;
  return <AdminOverview />;
}
function AdminOverview() {
  const query = trpc.arena.admin.overview.useQuery();
  const audit = trpc.arena.admin.audit.useQuery();
  if (query.isLoading) return <LoadingRows count={3} />;
  if (query.isError || !query.data) return <ErrorNotice message={query.error?.message ?? "Admin overview is unavailable."} onRetry={() => query.refetch()} />;
  return <div className="page-stack"><PageTitle eyebrow="ADMINISTRATION" title="Operations desk" description="Privileged tools are guarded by the server-side administrator role. Decisions and eligibility changes require a reason and are audited." action={<Link className="button button-ghost" href="/admin/disputes">Dispute queue <ArrowRight size={14} /></Link>} />
    <section className="grid-3"><div className="card stat-card"><span className="stat-icon"><FileSearch size={15} /></span><div className="stat-label">Matches under review</div><div className="stat-value">{query.data.underReview.length}</div><div className="stat-foot">Evidence issues freeze settlement</div></div><div className="card stat-card"><span className="stat-icon"><ShieldAlert size={15} /></span><div className="stat-label">Open disputes</div><div className="stat-value">{query.data.openDisputes.length}</div><div className="stat-foot">Reasoned decisions required</div></div><div className="card stat-card"><span className="stat-icon"><ClipboardList size={15} /></span><div className="stat-label">Recent audit entries</div><div className="stat-value">{audit.data?.length ?? 0}</div><div className="stat-foot">Immutable history, newest first</div></div></section>
    <AdminPlatformSettings />
    <section className="grid-2"><div className="card"><div className="card-header"><div><h3>Matches under review</h3><p>Timeout and conflicting evidence are never blind-settled.</p></div></div>{query.data.underReview.length ? <div className="challenge-list">{query.data.underReview.map(match => <Link key={match.id} className="challenge-card" href={`/admin/matches/${match.id}`}><div><strong>Fixture #{match.id}</strong><div className="meta-line">{match.disputeReason ?? "Requires review"}</div><div className="meta-line">{formatDate(match.createdAt)}</div></div><StatusPill status={match.status} /></Link>)}</div> : <EmptyState title="No match reviews waiting" icon={Shield} />}</div>
      <div className="card"><div className="card-header"><div><h3>Disputes</h3><p>Open or investigating</p></div><Link className="card-link" href="/admin/disputes">Open queue <ArrowRight size={13} /></Link></div>{query.data.openDisputes.length ? <div className="challenge-list">{query.data.openDisputes.slice(0, 5).map(item => <Link key={item.id} className="challenge-card" href={`/admin/matches/${item.matchId}`}><div><strong>Dispute #{item.id}</strong><div className="meta-line">{item.reason.replaceAll("_", " ")}</div></div><StatusPill status={item.status} /></Link>)}</div> : <EmptyState title="No open disputes" icon={ClipboardList} />}</div></section>
    <AdminAccountTools />
    <AdminTransactionReview />
    <section className="card"><div className="card-header"><div><h3>Recent audit log</h3><p>Administrative activity is retained.</p></div></div>{audit.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Action</th><th>Entity</th><th>Reason</th><th>When</th></tr></thead><tbody>{audit.data.slice(0, 15).map(item => <tr key={item.id}><td>{item.action.replaceAll("_", " ")}</td><td>{item.entityType} #{item.entityId}</td><td>{item.reason}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No administrative actions yet" icon={ClipboardList} />}</section>
  </div>;
}
function AdminPlatformSettings() {
  const query = trpc.arena.admin.settings.useQuery();
  const utils = trpc.useUtils();
  const [challengeCreationEnabled, setChallengeCreationEnabled] = useState(true);
  const [minimumStake, setMinimumStake] = useState("10");
  const [maximumStake, setMaximumStake] = useState("5000");
  const [defaultMatchMinutes, setDefaultMatchMinutes] = useState("12");
  const [maintenanceNotice, setMaintenanceNotice] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!query.data) return;
    setChallengeCreationEnabled(query.data.challengeCreationEnabled);
    setMinimumStake(String(query.data.minimumStake));
    setMaximumStake(String(query.data.maximumStake));
    setDefaultMatchMinutes(String(query.data.defaultMatchMinutes));
    setMaintenanceNotice(query.data.maintenanceNotice ?? "");
  }, [query.data]);
  const update = trpc.arena.admin.updateSettings.useMutation({
    onSuccess: async () => {
      toast.success("Platform settings saved and audited.");
      setReason("");
      await Promise.all([
        utils.arena.admin.settings.invalidate(),
        utils.arena.settings.rules.invalidate(),
        utils.arena.admin.audit.invalidate(),
        utils.arena.admin.overview.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  if (query.isLoading) return <section className="card"><LoadingRows count={2} /></section>;
  if (query.isError || !query.data) return <ErrorNotice message={query.error?.message ?? "Platform settings are unavailable."} onRetry={() => query.refetch()} />;
  const min = Number(minimumStake);
  const max = Number(maximumStake);
  const validBounds = Number.isInteger(min) && Number.isInteger(max) && min >= 10 && max <= 5000 && min <= max;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validBounds) { toast.error("Choose a minimum and maximum stake within 10–5,000, with the minimum no greater than the maximum."); return; }
    update.mutate({ challengeCreationEnabled, minimumStake: min, maximumStake: max, defaultMatchMinutes: Number(defaultMatchMinutes), maintenanceNotice: maintenanceNotice.trim() || null, reason: reason.trim() });
  };
  return <section className="card">
    <div className="card-header"><div><h3>Platform configuration</h3><p>These server-enforced settings apply to new challenges only. No monetary settings exist.</p></div><SlidersHorizontal size={17} color="var(--lime)" /></div>
    <form onSubmit={submit} className="page-stack">
      <div className="form-grid">
        <div className="field full"><label><input type="checkbox" checked={challengeCreationEnabled} onChange={event => setChallengeCreationEnabled(event.target.checked)} /> Allow new challenges</label><span className="field-help">Pausing hides challenge creation from players; existing challenge and match terms remain unchanged.</span></div>
        <div className="field"><label htmlFor="platform-minimum-stake">Minimum stake (demo credits)</label><input className="input" id="platform-minimum-stake" type="number" min={10} max={5000} step={1} value={minimumStake} onChange={event => setMinimumStake(event.target.value)} required /></div>
        <div className="field"><label htmlFor="platform-maximum-stake">Maximum stake (demo credits)</label><input className="input" id="platform-maximum-stake" type="number" min={10} max={5000} step={1} value={maximumStake} onChange={event => setMaximumStake(event.target.value)} required /></div>
        <div className="field"><label htmlFor="platform-default-length">Default match length</label><select className="select" id="platform-default-length" value={defaultMatchMinutes} onChange={event => setDefaultMatchMinutes(event.target.value)}>{[6, 8, 10, 12, 15, 20, 30].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></div>
        <div className="field full"><label htmlFor="platform-notice">Player-facing operational notice (optional)</label><textarea className="textarea" id="platform-notice" value={maintenanceNotice} onChange={event => setMaintenanceNotice(event.target.value)} maxLength={400} placeholder="A short notice shown above the new-challenge form." /></div>
        <div className="field full"><label htmlFor="platform-settings-reason">Required reason for this change (minimum 10 characters)</label><textarea className="textarea" id="platform-settings-reason" value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={2000} required placeholder="Document the operational reason for the change." /></div>
      </div>
      <div className="notice">Hard limits remain 10–5,000 demo credits and 6–30 minutes. Every settings change is recorded in the administrator audit log.</div>
      <div className="form-actions"><SpinnerButton type="submit" busy={update.isPending} disabled={!validBounds || reason.trim().length < 10}>Save platform settings</SpinnerButton></div>
    </form>
  </section>;
}
function AdminAccountTools() {
  const query = trpc.arena.admin.overview.useQuery();
  const utils = trpc.useUtils();
  const currentUser = trpc.auth.me.useQuery();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"eligible" | "review" | "suspended">("review");
  const [delta, setDelta] = useState("100");
  const [roleTargetUserId, setRoleTargetUserId] = useState("");
  const [role, setRole] = useState<"user" | "admin">("admin");
  const [reason, setReason] = useState("");
  const refresh = async () => { await Promise.all([utils.arena.admin.overview.invalidate(), utils.arena.admin.audit.invalidate()]); };
  const eligibility = trpc.arena.admin.setEligibility.useMutation({ onSuccess: async () => { toast.success("Account eligibility updated and audited."); await refresh(); }, onError: error => toast.error(error.message) });
  const adjustment = trpc.arena.admin.adjustCredits.useMutation({ onSuccess: async () => { toast.success("Demo-credit adjustment recorded in the ledger."); await refresh(); }, onError: error => toast.error(error.message) });
  const roleChange = trpc.arena.admin.setRole.useMutation({ onSuccess: async () => { toast.success("Account role updated and audited."); setRoleTargetUserId(""); setReason(""); await refresh(); }, onError: error => toast.error(error.message) });
  const accounts = query.data?.accounts.filter(account => account.username.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <section className="card"><div className="card-header"><div><h3>Player account administration</h3><p>Search public usernames; state changes and demo-credit adjustments require a reason and trusted server-side admin role.</p></div><UserCog size={17} color="var(--lime)" /></div>
    <div className="form-grid" style={{ marginBottom: 16 }}><div className="field"><label htmlFor="admin-user-search">Filter username</label><input className="input" id="admin-user-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search players" /></div><div className="field"><label htmlFor="admin-eligibility-status">Eligibility to apply</label><select id="admin-eligibility-status" className="select" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="eligible">Eligible</option><option value="review">Needs review</option><option value="suspended">Suspended</option></select></div><div className="field"><label htmlFor="admin-credit-delta">Demo-credit adjustment</label><input className="input" id="admin-credit-delta" type="number" step="1" min="-10000" max="10000" value={delta} onChange={event => setDelta(event.target.value)} /></div><div className="field full"><label htmlFor="admin-action-reason">Required administrative reason</label><textarea className="textarea" id="admin-action-reason" minLength={10} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Document the applicable evidence or policy for this action." /></div></div>
    <div className="form-grid" style={{ marginBottom: 20 }}><div className="field"><label htmlFor="admin-role-target">Player account for role change</label><select id="admin-role-target" className="select" value={roleTargetUserId} onChange={event => setRoleTargetUserId(event.target.value)}><option value="">Select a player</option>{accounts.filter(account => account.userId !== currentUser.data?.id).map(account => <option key={account.userId} value={account.userId}>{account.username} · #{account.userId} · {account.role}</option>)}</select></div><div className="field"><label htmlFor="admin-role-value">New role</label><select id="admin-role-value" className="select" value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="admin">Administrator</option><option value="user">Player</option></select></div><div className="field full"><span className="field-help">Only an existing administrator can apply this change. The server records the actor, target, previous role, new role and reason; the final administrator cannot be removed.</span></div><div className="form-actions"><SpinnerButton type="button" busy={roleChange.isPending} disabled={!roleTargetUserId || reason.trim().length < 10 || roleChange.isPending} onClick={() => roleChange.mutate({ userId: Number(roleTargetUserId), role, reason: reason.trim() })}>Apply role change</SpinnerButton></div></div>
    {query.isLoading ? <LoadingRows count={2} /> : query.isError || !query.data ? <ErrorNotice message={query.error?.message ?? "Account list is unavailable."} onRetry={() => query.refetch()} /> : accounts.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Player</th><th>Eligibility</th><th>Credits available / reserved</th><th>Role</th><th>Actions</th></tr></thead><tbody>{accounts.map(account => <tr key={account.userId}><td>{account.username}<div className="field-help">Account #{account.userId} · {account.country}</div></td><td><StatusPill status={account.eligibility} /></td><td>{account.availableCredits.toLocaleString()} / {account.reservedCredits.toLocaleString()}</td><td>{account.role}</td><td><div className="account-actions"><button className="button button-ghost button-small" disabled={reason.trim().length < 10 || eligibility.isPending} onClick={() => eligibility.mutate({ userId: account.userId, status, reason })}>Set status</button><button className="button button-ghost button-small" disabled={reason.trim().length < 10 || adjustment.isPending || !Number(delta) || !Number.isInteger(Number(delta))} onClick={() => adjustment.mutate({ userId: account.userId, delta: Number(delta), idempotencyKey: crypto.randomUUID(), reason })}>Apply {Number(delta) > 0 ? "+" : ""}{delta}</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="No accounts match this search" icon={UserCog} />}
  </section>;
}
function AdminTransactionReview() {
  const query = trpc.arena.admin.overview.useQuery();
  const rows = query.data?.recentTransactions ?? [];
  return <section className="card"><div className="card-header"><div><h3>Recent demo-credit ledger</h3><p>Administrator view · append-only wallet records · no monetary value</p></div><ClipboardList size={16} color="var(--lime)" /></div>{query.isLoading ? <LoadingRows count={2} /> : query.isError || !query.data ? <ErrorNotice message={query.error?.message ?? "Transaction review is unavailable."} onRetry={() => query.refetch()} /> : rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Player</th><th>Type</th><th>Amount</th><th>Available balance</th><th>Reason</th><th>When</th></tr></thead><tbody>{rows.map(({ username, transaction }) => <tr key={transaction.id}><td>{username}</td><td>{transaction.transactionType.replaceAll("_", " ")}</td><td>{transaction.amount.toLocaleString()} credits</td><td>{transaction.availableBefore.toLocaleString()} → {transaction.availableAfter.toLocaleString()}</td><td>{transaction.reason}</td><td>{formatDate(transaction.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No wallet transactions yet" icon={ClipboardList} />}</section>;
}
function AdminDisputes() {
  const query = trpc.arena.admin.disputes.useQuery();
  if (query.isLoading) return <LoadingRows />;
  if (query.isError || !query.data) return <ErrorNotice message={query.error?.message ?? "Dispute queue is unavailable."} onRetry={() => query.refetch()} />;
  return <div><PageTitle eyebrow="ADMIN REVIEW" title="Dispute management" description="Review participant reports and evidence before writing a decision. Every resolution requires a reason." action={<Link href="/admin" className="button button-ghost">Operations overview</Link>} />{query.data.length ? <div className="challenge-list">{query.data.map(({ dispute, match }) => <Link key={dispute.id} className="challenge-card" href={`/admin/matches/${match.id}`}><div><div className="challenge-topline"><strong>Dispute #{dispute.id}</strong><StatusPill status={dispute.status} /></div><div className="meta-line">Fixture #{match.id} · {dispute.reason.replaceAll("_", " ")}</div><div className="meta-line">{dispute.explanation}</div><div className="meta-line">Submitted {formatDate(dispute.createdAt)}</div></div><ArrowRight size={16} color="var(--lime)" /></Link>)}</div> : <EmptyState title="No dispute records" icon={ClipboardList}>When a participant reports an issue or score evidence conflicts, the case will appear here.</EmptyState>}</div>;
}
function AdminMatchReview({ id }: { id: number }) {
  const matchQuery = trpc.arena.matches.details.useQuery({ id }, { retry: false, refetchInterval: 5000 });
  const overview = trpc.arena.admin.overview.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const resolve = trpc.arena.admin.resolve.useMutation({ onSuccess: async () => { toast.success("Decision recorded; ledger and audit log updated."); await Promise.all([utils.arena.matches.details.invalidate(), utils.arena.admin.overview.invalidate(), utils.arena.admin.disputes.invalidate(), utils.arena.wallet.history.invalidate()]); }, onError: error => toast.error(error.message) });
  const status = trpc.arena.admin.setDisputeStatus.useMutation({ onSuccess: async (_result, variables) => { toast.success(variables.status === "REJECTED" ? "Dispute rejected; each player's stake was refunded." : "Review status saved to audit history."); await Promise.all([utils.arena.matches.details.invalidate(), utils.arena.admin.overview.invalidate(), utils.arena.admin.disputes.invalidate(), utils.arena.wallet.history.invalidate(), utils.arena.notifications.list.invalidate()]); }, onError: error => toast.error(error.message) });
  const eligibility = trpc.arena.admin.setEligibility.useMutation({ onSuccess: async () => { toast.success("Player eligibility updated and audited."); await utils.arena.matches.details.invalidate(); }, onError: error => toast.error(error.message) });
  const [decision, setDecision] = useState<"player_one_wins" | "player_two_wins" | "draw" | "refund">("refund");
  const [reason, setReason] = useState("");
  const [adminReason, setAdminReason] = useState("");
  if (matchQuery.isLoading) return <LoadingRows count={3} />;
  if (matchQuery.isError || !matchQuery.data) return <ErrorNotice message={matchQuery.error?.message ?? "Match review is unavailable."} onRetry={() => matchQuery.refetch()} />;
  const match = matchQuery.data;
  const activeDispute = match.disputes.find(item => item.status === "OPEN" || item.status === "INVESTIGATING");
  const submitResolution = (event: FormEvent) => { event.preventDefault(); if (!activeDispute) { toast.error("There is no active dispute to resolve."); return; } if (!window.confirm("Record this administrative decision and permanently settle/refund the demo-credit stakes? The decision will be audited.")) return; resolve.mutate({ disputeId: activeDispute.id, decision, reason }); };
  return <div className="page-stack"><PageTitle eyebrow="ADMIN MATCH REVIEW" title={`Fixture #${match.id}`} description="Participant-only evidence remains private. Screenshots are evidence, not independently authenticated proof." action={<Link className="button button-ghost" href="/admin">Admin overview</Link>} />
    <section className="card"><div className="match-toolbar"><StatusPill status={match.status} /><span className="field-help">Created {formatDate(match.createdAt)}</span></div><div className="grid-2"><div className="notice"><strong>Terms</strong><br />{match.gameLabel} · {match.edition} · {match.platformLabel} · {match.stake} credits each</div><div className="notice"><strong>Timing</strong><br />Accepted {formatDate(match.acceptedAt)} · deadline {formatDate(match.evidenceDeadline)}</div></div>
      <div className="grid-2" style={{ marginTop: 14 }}>{match.participants.map((person, index) => <div className="participant" key={person.userId}><span className="avatar" style={{ background: person.avatarColor }}>{person.username.slice(0, 2).toUpperCase()}</span><div><strong>{person.username}</strong><small>User #{person.userId} · {person.side} · {person.stake} stake · reported {person.scoreFor ?? "—"}–{person.scoreAgainst ?? "—"}</small></div></div>)}</div>
      {match.evidence.length > 0 && <div className="grid-2" style={{ marginTop: 16 }}>{match.evidence.map(item => <div className="card" key={item.id}><div className="card-header"><div><h3>{item.username} · {item.scoreFor}–{item.scoreAgainst}</h3><p>Submitted {formatDate(item.submittedAt)}</p></div></div><img src={item.url} alt={`Authorized screenshot evidence submitted by ${item.username}`} style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8, background: "#090b09" }} /><p className="field-help">{item.comments || "No comments supplied."}</p></div>)}</div>}
      {match.disputes.map(item => <div className="notice" key={item.id} style={{ marginTop: 14 }}><div className="match-toolbar"><strong>Dispute #{item.id}</strong><StatusPill status={item.status} /></div><p>{item.explanation}</p>{item.administrativeNotes && <p>Admin notes: {item.administrativeNotes}</p>}</div>)}
    </section>
    {activeDispute && match.status === "UNDER_REVIEW" && <section className="card"><div className="card-header"><div><h3>Documented resolution</h3><p>Select a participant, draw, or refund. No fee is applied.</p></div><ShieldAlert size={17} color="var(--amber)" /></div><form onSubmit={submitResolution} className="page-stack"><div className="field"><label htmlFor="decision">Decision</label><select id="decision" className="select" value={decision} onChange={e => setDecision(e.target.value as typeof decision)}><option value="refund">Cancel and refund each reserved stake</option><option value="draw">Draw — return each player's own stake</option><option value="player_one_wins">{match.participants[0]?.username ?? "Player one"} wins the full pool</option><option value="player_two_wins">{match.participants[1]?.username ?? "Player two"} wins the full pool</option></select></div><div className="field"><label htmlFor="resolution-reason">Required resolution reason</label><textarea id="resolution-reason" className="textarea" value={reason} onChange={e => setReason(e.target.value)} minLength={10} maxLength={2000} required placeholder="Explain the evidence and rule supporting this decision." /></div><div className="notice notice-warning">This operation is atomic and idempotent. The selected outcome and reason are retained in the immutable audit trail.</div><div className="form-actions"><SpinnerButton type="submit" busy={resolve.isPending} disabled={reason.trim().length < 10}>Record decision</SpinnerButton></div></form></section>}
    {activeDispute && <section className="card"><div className="card-header"><div><h3>Investigation status</h3><p>Keep internal review notes reasoned and auditable.</p></div></div><div className="field"><label htmlFor="review-note">Administrative note (minimum 10 characters)</label><input className="input" id="review-note" value={adminReason} onChange={e => setAdminReason(e.target.value)} maxLength={2000} /></div><div className="notice notice-warning">Rejecting a dispute closes the review and refunds each player's own reserved stake. It never awards a win.</div><div className="form-actions"><SpinnerButton className="button button-ghost" busy={status.isPending} disabled={adminReason.trim().length < 10} onClick={() => status.mutate({ id: activeDispute.id, status: "INVESTIGATING", reason: adminReason })}>Mark investigating</SpinnerButton><SpinnerButton className="button button-danger" busy={status.isPending} disabled={adminReason.trim().length < 10} onClick={() => { if (window.confirm("Reject this dispute, cancel the reviewed match and return each player's own reserved stake? This does not award a win.")) status.mutate({ id: activeDispute.id, status: "REJECTED", reason: adminReason }); }}>Reject and refund match</SpinnerButton></div></section>}
    <section className="card"><div className="card-header"><div><h3>Account eligibility</h3><p>Suspension/reinstatement needs a reason and is audit logged.</p></div><UserCog size={16} color="var(--lime)" /></div><div className="field"><label htmlFor="eligibility-reason">Reason</label><input className="input" id="eligibility-reason" value={adminReason} onChange={e => setAdminReason(e.target.value)} maxLength={2000} placeholder="Document the account action." /></div><div className="grid-2" style={{ marginTop: 12 }}>{match.participants.map(person => <div className="participant" key={person.side}><div><strong>{person.username}</strong><small>Account #{person.userId ?? "hidden"}</small></div><div className="form-actions" style={{ margin: 0 }}><button className="button button-ghost button-small" disabled={person.userId === undefined || adminReason.trim().length < 10 || eligibility.isPending} onClick={() => { if (person.userId !== undefined) eligibility.mutate({ userId: person.userId, status: "suspended", reason: adminReason }); }}>Suspend</button><button className="button button-ghost button-small" disabled={person.userId === undefined || adminReason.trim().length < 10 || eligibility.isPending} onClick={() => { if (person.userId !== undefined) eligibility.mutate({ userId: person.userId, status: "eligible", reason: adminReason }); }}>Reinstate</button></div></div>)}</div></section>
    <section className="card"><div className="card-header"><div><h3>Audit history</h3><p>Recent operation records</p></div></div>{overview.data?.recentAudit.filter(item => item.entityId === match.id || match.disputes.some(dispute => item.entityId === dispute.id)).length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Action</th><th>Reason</th><th>When</th></tr></thead><tbody>{overview.data.recentAudit.filter(item => item.entityId === match.id || match.disputes.some(dispute => item.entityId === dispute.id)).map(item => <tr key={item.id}><td>{item.action}</td><td>{item.reason}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <div className="field-help">No audit entries are linked to this match yet.</div>}</section>
  </div>;
}
