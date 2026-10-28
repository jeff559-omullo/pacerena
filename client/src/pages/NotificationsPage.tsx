import { Bell, CheckCheck, CircleCheck, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, formatDate } from "@/components/Primitives";
import { Link } from "wouter";

export default function NotificationsPage() {
  const utils = trpc.useUtils();
  const query = trpc.arena.notifications.list.useQuery(undefined, { refetchInterval: 30_000 });
  const markRead = trpc.arena.notifications.markRead.useMutation({ onSuccess: async () => { await Promise.all([utils.arena.notifications.list.invalidate(), utils.arena.dashboard.invalidate()]); }, onError: error => toast.error(error.message) });
  if (query.isLoading) return <LoadingRows />;
  if (query.isError || !query.data) return <ErrorNotice message={query.error?.message ?? "Notifications are unavailable."} onRetry={() => query.refetch()} />;
  const unread = query.data.filter(item => !item.readAt).length;
  return <div><PageTitle eyebrow="ACCOUNT ACTIVITY" title="Notifications" description="Important match and wallet updates are saved to your account and checked every 30 seconds." action={unread ? <button className="button button-ghost" onClick={() => markRead.mutate({})} disabled={markRead.isPending}><CheckCheck size={15} /> Mark all read</button> : undefined} />
    {query.data.length ? <div className="notification-list">{query.data.map(item => <article key={item.id} className="card" style={{ borderColor: item.readAt ? "var(--line)" : "#39472d" }}><div className="card-header"><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="stat-icon"><Bell size={15} /></span><div><h3>{item.title}</h3><p>{formatDate(item.createdAt)}</p></div></div>{item.readAt ? <CircleCheck size={15} color="#737c70" /> : <button className="card-link" onClick={() => markRead.mutate({ id: item.id })}>Mark read</button>}</div><p className="field-help" style={{ fontSize: 11, lineHeight: 1.7 }}>{item.body}</p>{item.entityType === "match" && item.entityId && <Link className="card-link" href={`/matches/${item.entityId}`}>Open match <Clock3 size={12} /></Link>}{item.entityType === "challenge" && item.entityId && <Link className="card-link" href={`/challenges/${item.entityId}`}>Open challenge <Clock3 size={12} /></Link>}{item.entityType === "dispute" && item.entityId && <Link className="card-link" href={`/disputes/${item.entityId}`}>Open dispute <Clock3 size={12} /></Link>}</article>)}</div> : <EmptyState title="You’re all caught up" icon={Bell}>Challenge updates, readiness, deadlines, evidence reviews, results and refunds will be saved here.</EmptyState>}
  </div>;
}
