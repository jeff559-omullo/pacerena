import type { ReactNode } from "react";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

export function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow-small">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function StatusPill({ status }: { status: string }) {
  const value = status.replaceAll("_", " ");
  const kind = /review|awaiting|investigating|ready/i.test(status) ? "warning" : /cancel|reject|suspend/i.test(status) ? "danger" : /complete|drawn|resolved|in progress/i.test(value) ? "" : "neutral";
  return <span className={`status-pill ${kind}`}>{value}</span>;
}
export function EmptyState({ title, children, icon: Icon = CircleAlert, action }: { title: string; children?: ReactNode; icon?: typeof CircleAlert; action?: ReactNode }) {
  return <div className="empty-state"><Icon size={21} aria-hidden="true" /><strong>{title}</strong>{children && <p>{children}</p>}{action && <div className="empty-action">{action}</div>}</div>;
}
export function LoadingRows({ count = 3 }: { count?: number }) {
  return <div className="page-stack" aria-label="Loading"><span className="sr-only">Loading…</span>{Array.from({ length: count }, (_, index) => <div className="skeleton" key={index} />)}</div>;
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="notice notice-danger" role="alert"><div className="section-row"><strong><CircleAlert size={14} style={{ verticalAlign: "-3px", marginRight: 6 }} />Something needs attention</strong>{onRetry && <button className="card-link" onClick={onRetry}>Try again <ArrowRight size={13} /></button>}</div>{message}</div>;
}
export function InlineSuccess({ children }: { children: ReactNode }) { return <div className="inline-success" role="status"><CircleCheck size={14} style={{ verticalAlign: "-3px", marginRight: 5 }} />{children}</div>; }
export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
export function SpinnerButton({ children, busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} className={`button ${props.className ?? "button-primary"}`}>
    {busy ? <LoaderCircle size={15} className="spin-icon" /> : null}{children}
  </button>;
}
