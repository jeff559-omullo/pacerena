import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowRight, Coins, Copy, ExternalLink, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNotice, LoadingRows, PageTitle, StatusPill, formatDate, SpinnerButton } from "@/components/Primitives";

const labels: Record<string, string> = {
  partner_credit: "Partner-confirmed credit",
  partner_reversal: "Partner credit reversal",
  partner_reversal_review: "Reversal held for review",
  withdrawal_reservation: "Withdrawal reserved",
  withdrawal_paid: "Manual M-Pesa payout recorded",
  withdrawal_release: "Withdrawal reservation released",
  stake_reservation: "Match stake reserved",
  stake_release: "Match stake released",
  winner_reward: "Match reward",
  draw_refund: "Draw refund",
  stake_consumption: "Match stake settled",
  admin_adjustment: "Administrator ledger adjustment",
};

export default function WalletPages({ mode }: { mode: "wallet" | "transactions" }) {
  const status = trpc.kesWallet.status.useQuery(undefined, { retry: false });
  const wallet = trpc.kesWallet.summary.useQuery(undefined, { retry: false, enabled: status.data?.walletEnabled === true });
  const history = trpc.kesWallet.history.useQuery({ limit: 50 });
  const withdrawals = trpc.kesWallet.myWithdrawals.useQuery(undefined, { refetchInterval: 30_000 });
  const profile = trpc.arena.profile.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [amountKes, setAmountKes] = useState("");
  const [phone, setPhone] = useState("");
  const [depositMessage, setDepositMessage] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositPhone, setDepositPhone] = useState("");
  const withdrawal = trpc.kesWallet.requestWithdrawal.useMutation({
    onSuccess: async result => {
      toast.success(`Withdrawal request #${result.requestId} is pending administrator processing. No payout has been sent by Pace Arena.`);
      setAmountKes("");
      await Promise.all([utils.kesWallet.summary.invalidate(), utils.kesWallet.history.invalidate(), utils.kesWallet.myWithdrawals.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  if (status.isLoading) return <LoadingRows count={3} />;
  if (status.isError || !status.data) return <ErrorNotice message={status.error?.message ?? "KES wallet status is unavailable."} onRetry={() => status.refetch()} />;
  const configured = status.data.walletEnabled;
  const walletData = wallet.data;
  const limitText = status.data.minWithdrawal && status.data.maxWithdrawal ? `KES ${status.data.minWithdrawal.toLocaleString()}–${status.data.maxWithdrawal.toLocaleString()}` : "configured limits";
  const submitWithdrawal = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(amountKes);
    if (!Number.isSafeInteger(amount) || amount <= 0) { toast.error("Enter a positive whole-shilling amount."); return; }
    if (!window.confirm(`Reserve KES ${amount.toLocaleString()} for manual M-Pesa processing to ${phone.trim()}? This request is not a payout.`)) return;
    withdrawal.mutate({ amountKes: amount, phone, idempotencyKey: crypto.randomUUID() });
  };
  const depositConfirmation = trpc.kesWallet.submitDepositConfirmation.useMutation({
    onSuccess: () => {
      toast.success("Your M-Pesa confirmation message was submitted for review.");
      setDepositMessage("");
      setDepositAmount("");
      setDepositPhone("");
    },
    onError: error => toast.error(error.message),
  });

  return <div className="page-stack">
    <PageTitle eyebrow="KES WALLET" title={mode === "wallet" ? "Your KES wallet" : "KES transaction history"} description="KES credits are purchased on the partner site. Pace Arena records signed partner credits and match balances; M-Pesa withdrawals are processed manually by an administrator." action={<Link className="button button-ghost" href="/transactions"><ReceiptText size={15} /> Full ledger</Link>} />
    {configured && status.data.partnerPurchaseUrl && <div className="notice"><strong>Buy credits on the partner site.</strong> Purchase checkout and payment confirmation happen outside Pace Arena. <a className="card-link" href={status.data.partnerPurchaseUrl} target="_blank" rel="noreferrer">Open partner purchase page <ExternalLink size={13} /></a></div>}
    {wallet.isError && configured && <ErrorNotice message={wallet.error?.message ?? "KES wallet data is unavailable."} onRetry={() => wallet.refetch()} />}
    {configured && walletData && <>
      {walletData.frozen && <div className="notice" role="alert"><strong>Wallet paused for administrator review.</strong> {walletData.freezeReason || "KES wagering and withdrawals are paused."}</div>}
      <section className="card"><div className="card-header"><div><h3>Deposit KES</h3><p>Top up your wallet using the partner checkout link. Credits are added after a signed payment callback.</p></div><Coins size={17} color="var(--lime)" /></div>
        <div className="page-stack">
          <div className="form-actions"><a className="button button-primary" href={status.data.partnerPurchaseUrl ?? "https://www.zetupay.co.ke/link/6BRFBFRE"} target="_blank" rel="noreferrer">Open partner deposit page <ExternalLink size={15} /></a></div>
          <div className="form-grid"><div className="field"><label htmlFor="deposit-amount">Amount (KES)</label><input className="input" id="deposit-amount" type="number" min={1} step={1} value={depositAmount} onChange={event => setDepositAmount(event.target.value)} placeholder="500" /></div><div className="field"><label htmlFor="deposit-phone">Phone / reference</label><input className="input" id="deposit-phone" value={depositPhone} onChange={event => setDepositPhone(event.target.value)} placeholder="e.g. 2547xx or receipt ref" /></div><div className="field full"><label htmlFor="deposit-message">Paste M-Pesa / partner message</label><textarea className="textarea" id="deposit-message" value={depositMessage} onChange={event => setDepositMessage(event.target.value)} placeholder="Paste the confirmation text from the payment message or partner checkout here." minLength={10} maxLength={1000} /></div></div>
          <div className="form-actions"><SpinnerButton type="button" busy={depositConfirmation.isPending} disabled={!depositMessage.trim() || depositConfirmation.isPending} onClick={() => depositConfirmation.mutate({ amountKes: depositAmount ? Number(depositAmount) : undefined, phone: depositPhone.trim() || undefined, message: depositMessage.trim() })}>Submit payment confirmation</SpinnerButton></div>
        </div>
        <p className="field-help">Use this when you paid through the partner page and want to log the M-Pesa confirmation message for admin review.</p>
      </section>
      <section className="grid-2"><div className="card stat-card accent-stat" style={{ minHeight: 145 }}><span className="stat-icon"><Coins size={16} /></span><div className="stat-label">Available</div><div className="stat-value">KES {walletData.availableKes.toLocaleString()}</div><div className="stat-foot">May be reserved for an eligible challenge or withdrawal</div></div><div className="card stat-card" style={{ minHeight: 145 }}><span className="stat-icon"><WalletCards size={16} /></span><div className="stat-label">Reserved</div><div className="stat-value">KES {walletData.reservedKes.toLocaleString()}</div><div className="stat-foot">Open stakes, active matches and pending withdrawals</div></div></section>
      <section className="card"><div className="card-header"><div><h3>Your partner wallet reference</h3><p>Give this reference to the licensed partner site when buying credits. Credits are added only after a valid signed server callback.</p></div><ShieldCheck size={17} color="var(--lime)" /></div><div className="form-actions"><code className="wallet-reference">{walletData.walletReference}</code><button className="button button-ghost button-small" type="button" onClick={() => { void navigator.clipboard.writeText(walletData.walletReference).then(() => toast.success("Wallet reference copied."), () => toast.error("Could not access the clipboard.")); }}><Copy size={13} /> Copy</button></div><p className="field-help">A browser payment redirect or screenshot does not credit this wallet.</p></section>
      <section className="card"><div className="card-header"><div><h3>Request a manual M-Pesa withdrawal</h3><p>Requests reserve your available KES. An administrator sends money outside Pace Arena and records the M-Pesa receipt.</p></div><WalletCards size={17} color="var(--lime)" /></div>
        {profile.data?.cashWalletStatus !== "verified" ? <div className="notice">Your KES wallet must be verified by an administrator before you can request a withdrawal. Current status: {profile.data?.cashWalletStatus ?? "loading"}.</div>
          : walletData.frozen ? <div className="notice">Withdrawal requests are paused while the wallet is under review.</div>
          : <form onSubmit={submitWithdrawal} className="page-stack"><div className="form-grid"><div className="field"><label htmlFor="withdrawal-amount">Amount · {limitText}</label><input className="input" id="withdrawal-amount" type="number" min={status.data.minWithdrawal ?? 1} max={status.data.maxWithdrawal ?? undefined} step={1} value={amountKes} onChange={event => setAmountKes(event.target.value)} required /></div><div className="field"><label htmlFor="withdrawal-phone">Kenyan M-Pesa phone number</label><input className="input" id="withdrawal-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="07XX XXX XXX or +2547XX XXX XXX" value={phone} onChange={event => setPhone(event.target.value)} required minLength={8} maxLength={24} /><span className="field-help">The server normalizes and validates supported Kenyan mobile numbers.</span></div></div><div className="notice">Submitting reserves the amount and creates a pending request. It is not a payout; Pace Arena never sends the transfer.</div><div className="form-actions"><SpinnerButton type="submit" busy={withdrawal.isPending} disabled={!amountKes || !phone.trim()}>Request withdrawal</SpinnerButton></div></form>}
      </section>
    </>}
    <section className="card"><div className="card-header"><div><h3>Withdrawal requests</h3><p>Manual payout status and administrator reconciliation</p></div></div>{withdrawals.isLoading ? <LoadingRows count={2} /> : withdrawals.isError ? <ErrorNotice message={withdrawals.error.message} onRetry={() => withdrawals.refetch()} /> : withdrawals.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Amount</th><th>M-Pesa number</th><th>Status</th><th>Receipt / reason</th><th>Requested</th></tr></thead><tbody>{withdrawals.data.map(request => <tr key={request.id}><td>#{request.id}</td><td>KES {request.amountKes.toLocaleString()}{request.actualAmountKes !== null ? <div className="field-help">Sent: KES {request.actualAmountKes.toLocaleString()}</div> : null}</td><td>{request.phoneE164}</td><td><StatusPill status={request.status} /></td><td>{request.payoutReceipt ?? request.reviewReason ?? "Awaiting administrator processing"}</td><td>{formatDate(request.requestedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No withdrawal requests" icon={WalletCards}>When eligible, request a manually processed M-Pesa payout from available KES.</EmptyState>}</section>
    <section className="card"><div className="card-header"><div><h3>{mode === "wallet" ? "Recent KES transactions" : "KES ledger entries"}</h3><p>Append-only records with previous and resulting available/reserved balances</p></div><ShieldCheck size={17} color="var(--lime)" /></div>{history.isLoading ? <LoadingRows count={2} /> : history.isError ? <ErrorNotice message={history.error.message} onRetry={() => history.refetch()} /> : history.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Transaction</th><th>Amount</th><th>Available balance</th><th>Reserved balance</th><th>Match</th><th>When</th></tr></thead><tbody>{history.data.map(item => <tr key={item.id}><td><strong>{labels[item.transactionType] ?? item.transactionType.replaceAll("_", " ")}</strong><div className="field-help">{item.reason}</div></td><td className={item.availableAfterKes > item.availableBeforeKes ? "amount-positive" : item.availableAfterKes < item.availableBeforeKes ? "amount-negative" : ""}>KES {item.amountKes.toLocaleString()}</td><td>{item.availableBeforeKes.toLocaleString()} → {item.availableAfterKes.toLocaleString()}</td><td>{item.reservedBeforeKes.toLocaleString()} → {item.reservedAfterKes.toLocaleString()}</td><td>{item.matchId ? <Link className="card-link" href={`/matches/${item.matchId}`}>#{item.matchId}</Link> : "—"}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No KES ledger activity yet" icon={ReceiptText}>Partner credits, stake reservations, match results, reversals and manual withdrawal status are recorded here.</EmptyState>}</section>
    <div className="form-actions"><Link className="button button-primary" href="/challenges/new">Create a KES challenge <ArrowRight size={15} /></Link></div>
  </div>;
}
