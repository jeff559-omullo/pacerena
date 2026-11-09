import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Activity, ArrowLeft, ArrowRight, Check, Clock3, Copy, Flag, Gamepad2, ImagePlus, KeyRound, ShieldAlert, Swords } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, StatusPill, formatDate, SpinnerButton } from "@/components/Primitives";
import { GAME_LABELS, PLATFORM_LABELS } from "@shared/pace";
import MatchRecordingPanel from "./MatchRecordingPanel";

export default function MatchPages({ mode, id }: { mode: "list" | "details" | "evidence"; id?: number }) {
  if (mode === "list") return <MatchList />;
  return <MatchRoom id={id ?? 0} evidenceOnly={mode === "evidence"} />;
}

function MatchList() {
  const query = trpc.arena.matches.list.useQuery(undefined, { refetchInterval: 30_000 });
  return <div><PageTitle eyebrow="FIXTURE HISTORY" title="My matches" description="Private rooms, evidence windows and settled results for your fixtures." action={<Link href="/challenges" className="button button-ghost">Browse challenges <ArrowRight size={14} /></Link>} />{query.isLoading ? <LoadingRows /> : query.isError ? <ErrorNotice message={query.error.message} onRetry={() => query.refetch()} /> : query.data?.length ? <div className="challenge-list">{query.data.map(match => <Link className="challenge-card" href={`/matches/${match.id}`} key={match.id}><div className="challenge-main"><div className="challenge-topline"><strong>Fixture #{match.id}</strong><StatusPill status={match.status} /></div><div className="meta-line"><span>{GAME_LABELS[match.game]}</span><span>{match.edition}</span><span>{PLATFORM_LABELS[match.platform]}</span></div><div className="meta-line"><span>{match.stakeCurrency === "KES" ? `Stake KES ${match.stake}` : `Historic stake ${match.stake} demo credits · non-cash`}</span><span>{formatDate(match.createdAt)}</span></div></div><ArrowRight color="var(--lime)" size={16} /></Link>)}</div> : <EmptyState title="No fixtures yet" icon={Activity}>Your accepted challenges and completed matches will appear here.</EmptyState>}</div>;
}

function useCountdown(target: Date | string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!target) return "—";
  const ms = Math.max(0, new Date(target).getTime() - now);
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor(ms / 1000) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function MatchRoom({ id, evidenceOnly }: { id: number; evidenceOnly: boolean }) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.arena.matches.details.useQuery({ id }, { retry: false, refetchInterval: 5000 });
  const ready = trpc.arena.matches.ready.useMutation({ onSuccess: async result => { toast.success(result.started ? "Both players are ready. The match timer has started." : "Readiness confirmed. Waiting for your opponent."); await Promise.all([utils.arena.matches.details.invalidate(), utils.arena.dashboard.invalidate()]); }, onError: error => toast.error(error.message) });
  const saveCode = trpc.arena.matches.saveCode.useMutation({ onSuccess: async () => { setCode(""); toast.success("Private room code shared with your opponent."); await utils.arena.matches.details.invalidate(); }, onError: error => toast.error(error.message) });
  const finish = trpc.arena.matches.finish.useMutation({ onSuccess: async () => { toast.success("Five-minute evidence window started."); await utils.arena.matches.details.invalidate(); if (!evidenceOnly) setLocation(`/matches/${id}/evidence`); }, onError: error => toast.error(error.message) });
  const [code, setCode] = useState("");
  const match = query.data;
  const countdownTarget = match ? (match.status === "AWAITING_EVIDENCE" ? match.evidenceDeadline : match.status === "IN_PROGRESS" ? match.expectedEndAt : match.readyDeadline) : null;
  const countdown = useCountdown(countdownTarget);
  const submitScore = trpc.arena.matches.submitEvidence.useMutation({ onSuccess: async result => { toast.success(result.status === "UNDER_REVIEW" ? "Score reports conflict. Settlement is frozen for review." : "Score evidence submitted."); await Promise.all([utils.arena.matches.details.invalidate(), utils.kesWallet.summary.invalidate(), utils.kesWallet.history.invalidate()]); }, onError: error => toast.error(error.message) });
  const [file, setFile] = useState<File | null>(null);
  const [scoreFor, setScoreFor] = useState("0");
  const [scoreAgainst, setScoreAgainst] = useState("0");
  const [comments, setComments] = useState("");
  // Keep every hook above these query-state returns so async data never changes hook order.
  if (query.isLoading) return <LoadingRows count={3} />;
  if (query.isError || !match) return <ErrorNotice message={query.error?.message ?? "Match room could not be loaded."} onRetry={() => query.refetch()} />;
  const me = match.participants.find(person => person.isMe);
  const currentReady = Boolean(me?.readyAt);
  const myCode = match.codes.find(item => item.isMine);
  const myEvidence = match.evidence.find(item => item.isMine);
  const myRecording = match.recordings.find(item => item.isMine);
  const terminal = ["COMPLETED", "DRAWN", "CANCELLED", "REFUNDED"].includes(match.status);
  const submitEvidence = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) { toast.error("Choose the final-score screenshot first."); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) { toast.error("Use a PNG, JPEG or WebP screenshot up to 5 MB."); return; }
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Could not read screenshot")); reader.readAsDataURL(file); });
    submitScore.mutate({ id, imageBase64: base64, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", scoreFor: Number(scoreFor), scoreAgainst: Number(scoreAgainst), comments: comments || undefined });
  };
  const copyCode = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Room code copied."); } catch { toast.error("Copy is unavailable. Select and copy the code manually."); } };

  return <div className="page-stack">
    <PageTitle eyebrow={evidenceOnly ? "FINAL SCORE EVIDENCE" : "PRIVATE MATCH ROOM"} title={`Fixture #${match.id}`} description={`${match.gameLabel} · ${match.edition} · ${match.platformLabel} · ${match.matchMinutes} minute match`} action={<Link className="button button-ghost" href="/matches"><ArrowLeft size={14} /> Match history</Link>} />
    {["AWAITING_STAKES", "READY", "IN_PROGRESS", "AWAITING_EVIDENCE", "UNDER_REVIEW", "COMPLETED", "DRAWN"].includes(match.status) && <MatchRecordingPanel matchId={id} status={match.status} evidenceDeadline={match.evidenceDeadline} existing={myRecording} onUploaded={() => query.refetch()} />}
    <section className="card match-room-card"><div className="match-toolbar"><StatusPill status={match.status} /><div className="timer" aria-label={`Server-derived countdown ${countdown}`}><Clock3 size={16} style={{ verticalAlign: "-2px", marginRight: 7 }} />{countdown}</div></div>
      <div className="match-score-banner"><div className="eyebrow-small">{match.stakeCurrency === "KES" ? "AGREED TERMS · KES CHALLENGE" : "HISTORIC DEMO MATCH · NON-CASH"}</div><div className="score-names"><div><strong>{match.participants[0]?.username ?? "Player"}</strong><span> · {match.stakeCurrency === "KES" ? `KES ${match.participants[0]?.stake} staked` : `${match.participants[0]?.stake} historic demo credits`}</span></div><span>VS</span><div><strong>{match.participants[1]?.username ?? "Opponent"}</strong><span> · {match.stakeCurrency === "KES" ? `KES ${match.participants[1]?.stake} staked` : `${match.participants[1]?.stake} historic demo credits`}</span></div></div><div className="meta-line"><span>{match.gameLabel}</span><span>{match.edition}</span><span>{match.platformLabel}</span><span>{match.matchMinutes} minutes</span></div></div>
      <div className="section-row" style={{ marginTop: 23 }}><h3>Match readiness</h3><span className="field-help">Timer starts when both participants confirm.</span></div><div className="two-sided">{match.participants.map(person => <div className="participant" key={person.side}><span className="avatar" style={{ background: person.avatarColor }}>{person.username.slice(0, 2).toUpperCase()}</span><div><strong>{person.username}</strong><small>{person.readyAt ? "Ready" : "Not confirmed"}</small></div><div style={{ marginLeft: "auto" }}><StatusPill status={person.readyAt ? "ready" : "waiting"} /></div></div>)}</div>
      {match.status === "AWAITING_STAKES" && <div className="form-actions"><SpinnerButton busy={ready.isPending} disabled={currentReady} onClick={() => ready.mutate({ id })}><Check size={15} />{currentReady ? "You are ready" : "Confirm ready"}</SpinnerButton></div>}
    </section>
    {["AWAITING_STAKES", "READY", "IN_PROGRESS", "AWAITING_EVIDENCE", "UNDER_REVIEW", "COMPLETED", "DRAWN"].includes(match.status) && <MatchRecordingPanel matchId={id} status={match.status} evidenceDeadline={match.evidenceDeadline} existing={myRecording} onUploaded={() => query.refetch()} />}
    {!evidenceOnly && !terminal && <section className="card"><div className="card-header"><div><h3>Private in-game room codes</h3><p>Visible only to these match participants and authorized administrators.</p></div><KeyRound size={17} color="var(--lime)" /></div><form className="code-row" onSubmit={event => { event.preventDefault(); if (code.trim()) saveCode.mutate({ id, code: code.trim() }); }}><input className="input" value={code} onChange={event => setCode(event.target.value)} maxLength={160} placeholder="Paste your in-game room code" aria-label="Your private in-game room code" /><SpinnerButton type="submit" busy={saveCode.isPending} disabled={!code.trim()}>Share privately <ArrowRight size={14} /></SpinnerButton></form>{match.codes.length ? <div className="page-stack" style={{ marginTop: 14 }}>{match.codes.map((item, index) => <div className="notice" key={item.id}><strong>{match.participants.find(person => person.side === item.side)?.username ?? (index === 0 ? "Participant" : "Opponent")}:</strong> <code>{item.code}</code><button type="button" onClick={() => copyCode(item.code)} aria-label="Copy room code" className="card-link" style={{ marginLeft: 10 }}><Copy size={13} /> Copy</button></div>)}</div> : <p className="field-help" style={{ marginTop: 12 }}>No room codes have been shared yet. These values never appear in public challenge listings.</p>}</section>}
    {!evidenceOnly && <section className="card"><div className="card-header"><div><h3>Match timeline</h3><p>All timestamps are recorded by the server.</p></div><Activity size={17} color="var(--lime)" /></div><div className="grid-3"><div className="notice"><strong>Accepted</strong><br />{formatDate(match.acceptedAt)}</div><div className="notice"><strong>Started</strong><br />{formatDate(match.startedAt)}</div><div className="notice"><strong>Evidence deadline</strong><br />{formatDate(match.evidenceDeadline)}</div></div></section>}
    {match.status === "IN_PROGRESS" && <section className="notice"><strong>Match in progress.</strong> After the final whistle, either participant may open the five-minute evidence window. The expected end timer is server-derived.<div className="form-actions"><SpinnerButton busy={finish.isPending} onClick={() => { if (window.confirm("Mark the match finished and start the five-minute evidence deadline for both players?")) finish.mutate({ id }); }}>Match finished <Clock3 size={14} /></SpinnerButton></div></section>}
    {match.status === "AWAITING_EVIDENCE" && <section className="card"><div className="card-header"><div><h3>Final-score evidence</h3><p>Submit a screenshot and your reported score before the deadline.</p></div><ImagePlus size={17} color="var(--lime)" /></div>{match.evidenceDeadline && <div className="deadline-note">Evidence deadline: {formatDate(match.evidenceDeadline)} · countdown {countdown}. Screenshots are evidence, not independently authenticated proof.</div>}
      {myEvidence ? <div className="notice" style={{ marginTop: 14 }}><strong>Your report:</strong> {myEvidence.scoreFor}–{myEvidence.scoreAgainst} · submitted {formatDate(myEvidence.submittedAt)}<div className="field-help" style={{ marginTop: 6 }}>Evidence remains private to the participants and authorized administrators.</div></div> : new Date(match.evidenceDeadline ?? 0).getTime() < Date.now() ? <div className="notice notice-warning">The five-minute evidence deadline has passed. The server will move this match to review; no automatic win is awarded.</div> : <form onSubmit={submitEvidence} className="form-grid" style={{ marginTop: 15 }}><div className="field full"><label htmlFor="screenshot">Final-score screenshot</label><input id="screenshot" className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)} required /><span className="field-help">PNG, JPEG or WebP · maximum 5 MB. Upload is encrypted at rest and served only through participant authorization.</span></div><div className="field"><label htmlFor="score-for">Your score</label><input id="score-for" className="input" type="number" min={0} max={99} value={scoreFor} onChange={event => setScoreFor(event.target.value)} required /></div><div className="field"><label htmlFor="score-against">Opponent score</label><input id="score-against" className="input" type="number" min={0} max={99} value={scoreAgainst} onChange={event => setScoreAgainst(event.target.value)} required /></div><div className="field full"><label htmlFor="comments">Comments (optional)</label><textarea id="comments" className="textarea" value={comments} onChange={event => setComments(event.target.value)} maxLength={1000} placeholder="Add context for the reviewer." /></div><div className="field full"><SpinnerButton type="submit" busy={submitScore.isPending} disabled={!file}>Submit score evidence</SpinnerButton></div></form>}
      {match.evidence.length > 0 && <div className="grid-2" style={{ marginTop: 16 }}>{match.evidence.map(item => <div className="card" key={item.id}><div className="card-header"><div><h3>{item.username} · {item.scoreFor}–{item.scoreAgainst}</h3><p>Submitted {formatDate(item.submittedAt)}</p></div></div><img src={item.url} alt={`Final score screenshot submitted by ${item.username}, ${item.scoreFor} to ${item.scoreAgainst}`} style={{ width: "100%", maxHeight: 300, objectFit: "contain", borderRadius: 8, background: "#090b09" }} /></div>)}</div>}
    </section>}
    {match.status === "UNDER_REVIEW" && <section className="notice notice-warning"><strong>Settlement is frozen.</strong> This match is under review. No stake is transferred automatically while evidence or dispute details are reviewed.{match.disputeReason && <div style={{ marginTop: 5 }}>{match.disputeReason}</div>}<div className="form-actions"><Link className="button button-ghost" href={`/disputes/new?match=${id}`}><Flag size={14} /> Open a dispute</Link></div></section>}
    {match.evidence.length > 0 && match.status !== "AWAITING_EVIDENCE" && <section className="card"><div className="card-header"><div><h3>Submitted score evidence</h3><p>Player reports and private screenshots; not independently authenticated.</p></div></div><div className="grid-2">{match.evidence.map(item => <div className="notice" key={item.id}><strong>{item.username}</strong> reports {item.scoreFor}–{item.scoreAgainst} · {formatDate(item.submittedAt)}<div><a className="card-link" href={item.url} target="_blank" rel="noreferrer">View authorized screenshot <ArrowRight size={12} /></a></div></div>)}</div></section>}
    {match.disputes.length > 0 && <section className="card"><div className="card-header"><div><h3>Dispute record</h3><p>Administrative decisions are recorded with a reason.</p></div><ShieldAlert size={16} color="var(--amber)" /></div>{match.disputes.map(dispute => <Link key={dispute.id} className="challenge-card" href={`/disputes/${dispute.id}`}><div><strong>Dispute #{dispute.id}</strong><div className="meta-line">{dispute.explanation}</div></div><StatusPill status={dispute.status} /></Link>)}</section>}
    {!terminal && match.status !== "UNDER_REVIEW" && <div className="page-heading"><div className="field-help">Room code and evidence access remain private to participants.</div><Link className="card-link" href={`/disputes/new?match=${id}`}>Report a problem <ArrowRight size={13} /></Link></div>}
    {terminal && <section className="notice"><strong>Match status: {match.status.replaceAll("_", " ")}.</strong> {match.stakeCurrency === "KES" ? "Review your KES ledger for the recorded reward or refund." : "This historic demo result has no cash value; the legacy demo ledger is retained for authorized historical review."}</section>}
  </div>;
}
