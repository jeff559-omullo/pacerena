import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, FileWarning, Flag, MessageSquareText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, StatusPill, formatDate, SpinnerButton } from "@/components/Primitives";

const reasons = [
  ["conflicting_scores", "Conflicting scores"], ["missing_evidence", "Missing evidence"], ["incorrect_screenshot", "Incorrect screenshot"], ["disconnect", "Disconnect or abandonment"], ["wrong_settings", "Wrong opponent or match settings"], ["suspected_cheating", "Suspected cheating"], ["other", "Other"],
] as const;
export default function DisputePages({ mode, id }: { mode: "new" | "details"; id?: number }) {
  return mode === "new" ? <OpenDispute /> : <DisputeDetail id={id ?? 0} />;
}
function OpenDispute() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const initialId = Number(params.get("match")) || 0;
  const matches = trpc.arena.matches.list.useQuery();
  const utils = trpc.useUtils();
  const open = trpc.arena.matches.openDispute.useMutation({ onSuccess: async result => { await Promise.all([utils.arena.matches.details.invalidate(), utils.arena.disputes.listMine.invalidate()]); toast.success("Dispute opened. Settlement is now frozen for review."); setLocation(`/disputes/${result.id}`); }, onError: error => toast.error(error.message) });
  const [matchId, setMatchId] = useState(initialId);
  const [reason, setReason] = useState<(typeof reasons)[number][0]>("other");
  const [explanation, setExplanation] = useState("");
  const [imageBase64, setImageBase64] = useState<string>();
  const [mimeType, setMimeType] = useState<"image/jpeg" | "image/png" | "image/webp">();
  const [fileName, setFileName] = useState("");
  const selectScreenshot = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { toast.error("Choose a PNG, JPEG, or WebP screenshot up to 5 MB."); event.currentTarget.value = ""; return; }
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Screenshot could not be read.")); reader.onerror = () => reject(new Error("Screenshot could not be read.")); reader.readAsDataURL(file); });
    setImageBase64(dataUrl.slice(dataUrl.indexOf(",") + 1)); setMimeType(file.type as typeof mimeType); setFileName(file.name);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!matchId) { toast.error("Select a match."); return; } open.mutate({ id: matchId, reason, explanation, imageBase64, mimeType }); };
  return <div className="page-stack"><PageTitle eyebrow="PLAYER REPORT" title="Open a dispute" description="Provide a clear explanation. Opening a dispute freezes settlement until an authorized decision is recorded." action={<Link href="/matches" className="button button-ghost">Match history</Link>} />
    <div className="grid-2"><section className="card"><div className="card-header"><div><h3>Dispute details</h3><p>Choose the match and explain the issue.</p></div><Flag size={17} color="var(--lime)" /></div>{matches.isLoading ? <LoadingRows count={1} /> : matches.isError ? <ErrorNotice message={matches.error.message} onRetry={() => matches.refetch()} /> : <form onSubmit={submit} className="page-stack"><div className="field"><label htmlFor="match">Match</label><select id="match" className="select" value={matchId} onChange={e => setMatchId(Number(e.target.value))} required><option value={0}>Select a match</option>{matches.data?.filter(item => !["COMPLETED", "DRAWN", "CANCELLED", "REFUNDED"].includes(item.status)).map(item => <option key={item.id} value={item.id}>Fixture #{item.id} · {item.status.replaceAll("_", " ")}</option>)}</select></div><div className="field"><label htmlFor="reason">Reason</label><select id="reason" className="select" value={reason} onChange={e => setReason(e.target.value as typeof reason)}>{reasons.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div><div className="field"><label htmlFor="explanation">Your explanation</label><textarea id="explanation" className="textarea" minLength={10} maxLength={3000} value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="Describe what happened and what evidence is relevant." required /><span className="field-help">Screenshots already submitted to this match remain available to authorized reviewers. Do not include private contact details.</span></div><div className="field"><label htmlFor="dispute-screenshot">Attach a dispute screenshot (optional)</label><input className="input" id="dispute-screenshot" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void selectScreenshot(event)} /><span className="field-help">PNG, JPEG, or WebP; up to 5 MB. Accessible only to the match participants and authorized reviewers. {fileName ? `Selected: ${fileName}` : "No attachment selected."}</span></div><div className="notice notice-warning">A dispute does not automatically award a win or transfer credits. Administrators must record a reason for the decision.</div><div className="form-actions"><SpinnerButton type="submit" busy={open.isPending}><Flag size={14} /> Submit dispute</SpinnerButton></div></form>}</section>
      <aside className="card"><div className="card-header"><div><h3>Review path</h3><p>What happens next</p></div><ShieldAlert size={17} color="var(--amber)" /></div><div className="page-stack"><div className="notice"><strong>1 · Settlement pauses.</strong><br />Reserved KES stays in the match until evidence is reviewed and a decision is recorded.</div><div className="notice"><strong>2 · Evidence stays scoped.</strong><br />Participants and authorized administrators can view private match submissions.</div><div className="notice"><strong>3 · A reason is recorded.</strong><br />Administrative decisions remain in the audit trail and cannot erase ledger entries.</div></div></aside></div>
  </div>;
}
function DisputeDetail({ id }: { id: number }) {
  const query = trpc.arena.disputes.detail.useQuery({ id }, { retry: false });
  const matches = trpc.arena.matches.list.useQuery();
  if (query.isLoading) return <LoadingRows count={2} />;
  if (query.isError || !query.data) return <ErrorNotice message={query.error?.message ?? "Dispute not found."} onRetry={() => query.refetch()} />;
  const item = query.data;
  const match = matches.data?.find(candidate => candidate.id === item.matchId);
  return <div className="page-stack"><PageTitle eyebrow="DISPUTE RECORD" title={`Dispute #${item.id}`} description="The review record is persistent. Administrative notes and resolution reasons are retained." action={<Link className="button button-ghost" href={`/matches/${item.matchId}`}>Open match <ArrowRight size={14} /></Link>} />
    <section className="card"><div className="match-toolbar"><StatusPill status={item.status} /><span className="field-help">Submitted {formatDate(item.createdAt)}</span></div><div className="grid-2"><div className="notice"><strong>Reason</strong><br />{item.reason.replaceAll("_", " ")}</div><div className="notice"><strong>Match</strong><br />Fixture #{item.matchId}{match ? ` · ${match.status.replaceAll("_", " ")}` : ""}</div></div><div className="card" style={{ marginTop: 16 }}><div className="card-header"><div><h3>Player explanation</h3><p>Submitted at {formatDate(item.createdAt)}</p></div><MessageSquareText size={16} color="var(--lime)" /></div><p style={{ fontSize: 12, lineHeight: 1.75, color: "#c5cdbf", whiteSpace: "pre-wrap" }}>{item.explanation}</p></div>{item.attachments.length > 0 && <div className="page-stack" style={{ marginTop: 14 }}><strong>Private attachments</strong>{item.attachments.map(attachment => <a key={attachment.id} className="card-link" href={attachment.url} target="_blank" rel="noreferrer">View authorized screenshot · {attachment.mimeType}</a>)}</div>}{item.administrativeNotes && <div className="notice" style={{ marginTop: 14 }}><strong>Administrative notes</strong><br />{item.administrativeNotes}</div>}{item.resolutionReason && <div className="notice" style={{ marginTop: 14 }}><strong>Resolution reason</strong><br />{item.resolutionReason}<div className="field-help" style={{ marginTop: 5 }}>Resolved {formatDate(item.resolvedAt)}</div></div>}</section>
    <section className="notice"><FileWarning size={15} style={{ verticalAlign: "-3px", color: "var(--lime)", marginRight: 6 }} />Screenshots and player score reports are evidence but are not independently authenticated by Pace Arena.</section>
  </div>;
}
