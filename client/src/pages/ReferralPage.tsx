import { useState } from "react";
import { Check, Copy, ExternalLink, Gift, Share2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, SpinnerButton, StatusPill, formatDate } from "@/components/Primitives";

export default function ReferralPage() {
  const utils = trpc.useUtils();
  const summary = trpc.referral.summary.useQuery(undefined, { retry: false });
  const shareLinks = trpc.referral.link.useQuery(undefined, { retry: false });
  const history = trpc.referral.history.useQuery(undefined, { retry: false });
  const [amountKes, setAmountKes] = useState("");
  const [reason, setReason] = useState("");

  const withdraw = trpc.referral.withdraw.useMutation({
    onSuccess: async () => {
      toast.success("Your referral withdrawal request has been submitted for review.");
      setAmountKes("");
      setReason("");
      await Promise.all([
        utils.referral.summary.invalidate(),
        utils.referral.history.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  if (summary.isLoading || shareLinks.isLoading || history.isLoading) {
    return <LoadingRows count={3} />;
  }

  if (summary.isError || !summary.data) {
    return <ErrorNotice message={summary.error?.message ?? "Referral summary is unavailable."} onRetry={() => summary.refetch()} />;
  }

  const referralCode = summary.data.referralCode ?? shareLinks.data?.code ?? "—";
  const referralUrl = summary.data.referralUrl ?? shareLinks.data?.url ?? "";
  const available = Number(summary.data.availableReferralEarnings ?? 0);
  const pending = Number(summary.data.pendingCommissions ?? 0);
  const share = shareLinks.data?.share ?? {} as Record<string, string>;
  const validWithdrawal = Number(amountKes) > 0 && Number(amountKes) <= available && reason.trim().length >= 10;

  const copyLink = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      toast.success("Referral link copied.");
    } catch {
      toast.error("Your browser blocked clipboard access. Copy the link manually.");
    }
  };

  return <div className="page-stack">
    <PageTitle
      eyebrow="PLAYER REFERRALS"
      title="Invite friends"
      description="Share your referral link and earn a commission when a referred player completes a qualifying action."
    />

    <section className="grid-3">
      <div className="card stat-card">
        <span className="stat-icon"><Gift size={15} /></span>
        <div className="stat-label">Referred players</div>
        <div className="stat-value">{summary.data.totalReferrals}</div>
        <div className="stat-foot">Total invites sent</div>
      </div>
      <div className="card stat-card">
        <span className="stat-icon"><Check size={15} /></span>
        <div className="stat-label">Successful referrals</div>
        <div className="stat-value">{summary.data.successfulReferrals}</div>
        <div className="stat-foot">Active referral links</div>
      </div>
      <div className="card stat-card">
        <span className="stat-icon"><WalletCards size={15} /></span>
        <div className="stat-label">Available earnings</div>
        <div className="stat-value">KES {available.toLocaleString()}</div>
        <div className="stat-foot">Pending: KES {pending.toLocaleString()}</div>
      </div>
    </section>

    <div className="grid-2">
      <section className="card page-stack">
        <div className="card-header">
          <div>
            <h3>Your referral code</h3>
            <p>Share this with friends or use the direct registration link.</p>
          </div>
          <Share2 size={17} color="var(--lime)" />
        </div>

        <div className="notice">
          <strong>{referralCode}</strong>
          <div className="field-help" style={{ marginTop: 8 }}>Your invite link is valid for 30 days from signup.</div>
        </div>

        <div className="field full">
          <label htmlFor="referral-url">Registration link</label>
          <input id="referral-url" className="input" value={referralUrl} readOnly />
        </div>

        <div className="form-actions">
          <button type="button" className="button button-ghost" onClick={copyLink}> <Copy size={14} /> Copy link</button>
          <a className="button button-primary" href={referralUrl} target="_blank" rel="noreferrer">Open link <ExternalLink size={14} /></a>
        </div>

        <div className="form-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          {Object.entries(share).map(([label, href]) => (
            <a key={label} className="button button-ghost button-small" href={href} target="_blank" rel="noreferrer">{label}</a>
          ))}
        </div>
      </section>

      <section className="card page-stack">
        <div className="card-header">
          <div>
            <h3>Withdraw referral earnings</h3>
            <p>Approved commissions are available for manual withdrawal review.</p>
          </div>
          <WalletCards size={17} color="var(--lime)" />
        </div>

        {available > 0 ? (
          <>
            <div className="field">
              <label htmlFor="referral-withdraw-amount">KES amount</label>
              <input id="referral-withdraw-amount" className="input" type="number" min={1} step={1} value={amountKes} onChange={event => setAmountKes(event.target.value)} placeholder="e.g. 250" />
            </div>
            <div className="field full">
              <label htmlFor="referral-withdraw-reason">Reason</label>
              <textarea id="referral-withdraw-reason" className="textarea" value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500} placeholder="Explain the reason for this withdrawal request." />
            </div>
            <div className="notice">Available approved referral earnings: KES {available.toLocaleString()}.</div>
            <div className="form-actions">
              <SpinnerButton type="button" busy={withdraw.isPending} disabled={!validWithdrawal} onClick={() => withdraw.mutate({ amountKes: Number(amountKes), reason: reason.trim() })}>Request withdrawal</SpinnerButton>
            </div>
          </>
        ) : (
          <EmptyState title="No referral earnings available yet" icon={WalletCards}>Qualifying player activity and approved commissions will appear here once they are earned.</EmptyState>
        )}
      </section>
    </div>

    <section className="card">
      <div className="card-header">
        <div>
          <h3>Referral activity</h3>
          <p>Recent referred players and commission events.</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <div>
          <h4 style={{ margin: "0 0 12px" }}>Referred players</h4>
          {(history.data?.referrals ?? []).length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Status</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data?.referrals ?? []).map(item => (
                    <tr key={item.id}>
                      <td>{item.username}</td>
                      <td><StatusPill status={item.status} /></td>
                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No referrals yet" icon={Gift}>Once someone signs up with your code, they will appear here.</EmptyState>
          )}
        </div>

        <div>
          <h4 style={{ margin: "0 0 12px" }}>Commission history</h4>
          {(history.data?.commissions ?? []).length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data?.commissions ?? []).map(item => (
                    <tr key={item.id}>
                      <td>{item.sourceType.replaceAll("_", " ")}</td>
                      <td>KES {item.commissionAmountKes.toLocaleString()}</td>
                      <td><StatusPill status={item.status} /></td>
                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No commission events yet" icon={WalletCards}>Your referral earnings will show up here after a qualifying action is recorded.</EmptyState>
          )}
        </div>
      </div>
    </section>
  </div>;
}
