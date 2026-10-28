import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Check, Gamepad2, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { GAME_LABELS, PLATFORM_LABELS } from "@shared/pace";
import { ErrorNotice, LoadingRows, PageTitle, StatusPill, SpinnerButton } from "@/components/Primitives";

const colors = ["#B7F34A", "#69D6C4", "#A78BFA", "#60A5FA", "#F5A35B", "#F472B6"] as const;
export default function SettingsPage() {
  const profile = trpc.arena.profile.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const update = trpc.arena.profile.update.useMutation({ onSuccess: async () => { await Promise.all([utils.arena.profile.me.invalidate(), utils.arena.dashboard.invalidate()]); toast.success("Player profile saved."); }, onError: error => toast.error(error.message) });
  const [username, setUsername] = useState("");
  const [preferredGame, setPreferredGame] = useState<"efootball" | "ea_fc" | "">("");
  const [edition, setEdition] = useState("");
  const [platform, setPlatform] = useState<keyof typeof PLATFORM_LABELS | "">("");
  const [country, setCountry] = useState("KE");
  const [generalLocation, setGeneralLocation] = useState("");
  const [matchPreferences, setMatchPreferences] = useState("");
  const [availability, setAvailability] = useState<"available" | "away">("away");
  const [avatarColor, setAvatarColor] = useState<typeof colors[number]>(colors[0]);
  useEffect(() => {
    if (!profile.data) return;
    setUsername(profile.data.username); setPreferredGame(profile.data.preferredGame ?? ""); setEdition(profile.data.gameEdition ?? ""); setPlatform(profile.data.platform ?? ""); setCountry(profile.data.country); setGeneralLocation(profile.data.generalLocation ?? ""); setMatchPreferences(profile.data.matchPreferences ?? ""); setAvailability(profile.data.availability); setAvatarColor((colors as readonly string[]).includes(profile.data.avatarColor) ? profile.data.avatarColor as typeof colors[number] : colors[0]);
  }, [profile.data]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ username, preferredGame: preferredGame || null, gameEdition: edition.trim() || null, platform: platform || null, country, generalLocation: generalLocation.trim() || null, matchPreferences: matchPreferences.trim() || null, availability, avatarColor });
  };
  if (profile.isLoading) return <LoadingRows count={2} />;
  if (profile.isError || !profile.data) return <ErrorNotice message={profile.error?.message ?? "Profile is unavailable."} onRetry={() => profile.refetch()} />;
  const item = profile.data;
  return <div className="page-stack"><PageTitle eyebrow="PLAYER CARD" title="Profile & settings" description="Choose what opponents need to know to play you. Your email and account identifiers stay private." action={<Link href="/reset-password" className="button button-ghost">Reset password</Link>} />
    <div className="grid-2"><section className="card"><div className="card-header"><div><h3>Public player profile</h3><p>Visible to potential opponents and match participants.</p></div><UserRound size={17} color="var(--lime)" /></div>
      <form onSubmit={submit}><div className="form-grid"><div className="field full"><label htmlFor="username">Player name</label><input className="input" id="username" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" required /><span className="field-help">3–24 letters, numbers or underscores. Usernames are unique.</span></div>
        <div className="field"><label htmlFor="game">Preferred game family</label><select className="select" id="game" value={preferredGame} onChange={e => setPreferredGame(e.target.value as typeof preferredGame)}><option value="">Choose a game</option>{Object.entries(GAME_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor="edition">Exact game edition</label><input className="input" id="edition" value={edition} onChange={e => setEdition(e.target.value)} maxLength={48} placeholder="Exact edition name" /></div>
        <div className="field"><label htmlFor="platform">Gaming platform</label><select className="select" id="platform" value={platform} onChange={e => setPlatform(e.target.value as typeof platform)}><option value="">Choose a platform</option>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor="availability">Challenge availability</label><select className="select" id="availability" value={availability} onChange={e => setAvailability(e.target.value as typeof availability)}><option value="available">Open to challenges</option><option value="away">Away</option></select><span className="field-help">This is your preference, not a live online indicator.</span></div>
        <div className="field"><label htmlFor="country">Country code</label><input className="input" id="country" value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} minLength={2} pattern="[A-Za-z]{2}" /></div>
        <div className="field"><label htmlFor="location">General location (optional)</label><input className="input" id="location" value={generalLocation} onChange={e => setGeneralLocation(e.target.value)} maxLength={80} placeholder="e.g. Nairobi" /><span className="field-help">Never provide a precise address.</span></div>
        <div className="field full"><label htmlFor="match-preferences">Match preferences (optional)</label><textarea className="textarea" id="match-preferences" value={matchPreferences} onChange={e => setMatchPreferences(e.target.value)} maxLength={500} placeholder="Share friendly preferences or scheduling notes—do not include contact details." /><span className="field-help">Visible to other players. Do not include private contact information.</span></div>
        <div className="field full"><label>Avatar color</label><div className="avatar-picker" aria-label="Choose avatar color">{colors.map(color => <button type="button" key={color} className={`avatar-swatch ${avatarColor === color ? "selected" : ""}`} style={{ background: color }} onClick={() => setAvatarColor(color)} aria-label={`Use avatar color ${color}`} aria-pressed={avatarColor === color} />)}</div></div>
      </div><div className="form-actions"><SpinnerButton type="submit" busy={update.isPending}><Check size={15} /> Save profile</SpinnerButton></div></form>
    </section><aside className="page-stack"><div className="card"><div className="card-header"><div><h3>Eligibility</h3><p>Match access is enforced by the server.</p></div><ShieldCheck size={17} color="var(--lime)" /></div><StatusPill status={item.eligibility} /><p className="field-help" style={{ marginTop: 12 }}>Only eligible players can create and accept challenges. Administrative eligibility decisions require a recorded reason.</p></div><div className="card"><div className="card-header"><div><h3>Compatibility</h3><p>Cross-play is intentionally conservative.</p></div><Gamepad2 size={17} color="var(--lime)" /></div><div className="notice">Pace Arena currently matches the same game family, exact edition and exact platform. PlayStation generations, Xbox generations, PC and mobile are separate groups.</div></div><div className="card"><div className="card-header"><div><h3>Privacy</h3><p>Only information necessary for matchmaking is shown.</p></div><MapPin size={16} color="var(--lime)" /></div><p className="field-help">Email, account IDs, password data and private contact details are not shown to opponents. Online presence is not displayed; the availability setting above is self-declared.</p></div></aside></div>
  </div>;
}
