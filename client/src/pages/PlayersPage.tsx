import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Search, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, StatusPill } from "@/components/Primitives";
import { GAME_LABELS, PLATFORM_LABELS } from "@shared/pace";

export default function PlayersPage() {
  const [search, setSearch] = useState("");
  const [game, setGame] = useState("");
  const [platform, setPlatform] = useState("");
  const [availability, setAvailability] = useState<"available" | "away">("available");
  const players = trpc.arena.players.list.useQuery({ search: search.trim() || undefined, game: (game || undefined) as "efootball" | "ea_fc" | undefined, platform: (platform || undefined) as keyof typeof PLATFORM_LABELS | undefined, availability }, { refetchInterval: 45_000 });

  return <div className="page-stack">
    <PageTitle eyebrow="PLAYER DIRECTORY" title="Find your next rival" description="Browse player cards and declared match availability. Email addresses and account identifiers are never shown." action={<Link href="/challenges" className="button button-ghost">Open challenges <ArrowRight size={14} /></Link>} />
    <section className="filters" aria-label="Player filters">
      <div className="search-field"><Search size={15} /><input className="input" value={search} onChange={event => setSearch(event.target.value)} maxLength={24} placeholder="Search player name" aria-label="Search player names" /></div>
      <select className="select" value={game} onChange={event => setGame(event.target.value)} aria-label="Filter players by game"><option value="">All games</option>{Object.entries(GAME_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select className="select" value={platform} onChange={event => setPlatform(event.target.value)} aria-label="Filter players by platform"><option value="">All platforms</option>{Object.entries(PLATFORM_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select className="select" value={availability} onChange={event => setAvailability(event.target.value as typeof availability)} aria-label="Filter by declared availability"><option value="available">Open to challenges</option><option value="away">Away</option></select>
    </section>
    {players.isLoading ? <LoadingRows count={4} /> : players.isError ? <ErrorNotice message={players.error.message} onRetry={() => players.refetch()} /> : players.data?.length ? <section className="player-grid" aria-label="Player cards">{players.data.map(player => <article className="card player-card" key={`${player.username}-${player.platform}`}>
      <div className="player-card-heading"><span className="avatar" style={{ background: player.avatarColor }}>{player.username.slice(0, 2).toUpperCase()}</span><div><h2>{player.username}</h2><div className="meta-line">{player.generalLocation || player.country} · {player.country}</div></div><StatusPill status={player.availability === "available" ? "eligible" : "away"} /></div>
      <div className="meta-line player-card-meta"><span>{player.preferredGame ? GAME_LABELS[player.preferredGame] : "Game not set"}</span><span>{player.gameEdition || "Edition not set"}</span><span>{player.platform ? PLATFORM_LABELS[player.platform] : "Platform not set"}</span></div>
      {player.matchPreferences && <p className="field-help player-preferences">{player.matchPreferences}</p>}
      <div className="player-card-footer"><small>{player.availability === "available" ? "Self-declared: open to challenges" : "Self-declared: away"}</small>{player.availability === "available" && player.preferredGame && player.gameEdition && player.platform && <Link href="/challenges/new" className="card-link">Create a compatible challenge <ArrowRight size={13} /></Link>}</div>
    </article>)}</section> : <EmptyState title="No player cards match those filters" icon={UsersRound}>Try a different name or platform, or change your own game profile to find exact-edition opponents.</EmptyState>}
  </div>;
}
