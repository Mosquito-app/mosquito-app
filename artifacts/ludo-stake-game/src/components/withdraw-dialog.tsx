import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, RefreshCw, X } from 'lucide-react';
import { getGetWalletQueryKey, useCreateWithdrawal, useVerifyWithdrawal } from '@workspace/api-client-react';
import type { WalletResponse, Withdrawal } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { InlineError, money } from '@/components/common';

export function patchWithdrawal(w: Withdrawal) {
  queryClient.setQueryData<WalletResponse>(getGetWalletQueryKey(), old => old ? { ...old, withdrawals: [w, ...(old.withdrawals || []).filter(x => x.id !== w.id)] } : old);
  void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
}

export function StatusPill({ status }: { status: Withdrawal['status'] }) {
  return <span className={`wd-status wd-${status}`} data-testid={`status-withdrawal-${status}`}>{status.toUpperCase()}</span>;
}

export function VerifyButton({ id }: { id: string }) {
  const verify = useVerifyWithdrawal();
  return <button className="quiet-btn" disabled={verify.isPending} onClick={() => verify.mutate({ withdrawalId: id }, { onSuccess: patchWithdrawal })} data-testid={`button-verify-withdrawal-${id}`}><RefreshCw size={11} /> {verify.isPending ? 'Checking' : verify.isError ? 'Retry check' : 'Verify'}</button>;
}

export function WithdrawDialog({ available, paymentMode, onClose }: {
  available: number;
  paymentMode: WalletResponse['paymentMode'];
  onClose: () => void;
}) {
  const create = useCreateWithdrawal();
  const [amount, setAmount] = useState('500');
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [bank, setBank] = useState('011');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Withdrawal | null>(null);
  const attempt = useRef({ key: '', id: '' });
  const requestId = (key: string) => {
    if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    return attempt.current.id;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 500 || value > 500000) return setError('Enter a whole amount from ₦500 to ₦500,000.');
    if (value > available) return setError(`Only ${money(available)} is available. Reserved stakes cannot be withdrawn.`);
    if (name.trim().length < 2) return setError('Enter the recipient name.');
    if (!/^[0-9]{10}$/.test(account)) return setError('Account number must be 10 digits.');
    if (!/^[0-9]{3,6}$/.test(bank)) return setError('Bank code must be 3 to 6 digits.');
    const key = [value, name.trim(), account, bank].join('|');
    create.mutate({ data: { amountNaira: value, requestId: requestId(key), recipientName: name.trim(), accountNumber: account, bankCode: bank } }, {
      onSuccess: w => { patchWithdrawal(w); setResult(w); attempt.current = { key: '', id: '' }; },
      onError: err => {
        void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        setError(err instanceof Error ? err.message : 'No clear result. Retry the same details; the same request id prevents a double debit.');
      },
    });
  };
  const isLive = paymentMode === 'live';
  const isTest = paymentMode === 'test';
  return <div className="modal-back" role="dialog" aria-modal="true" aria-label="Mosquito Wallet bank withdrawal" data-testid="dialog-withdraw">
    <div className="modal-card">
      <div className="modal-head"><div><div className="panel-kicker">MOSQUITO WALLET · {isLive ? 'LIVE' : isTest ? 'TEST MODE' : 'UNAVAILABLE'}</div><h2>{isLive ? 'Withdraw to bank' : isTest ? 'Withdraw test funds' : 'Withdrawals unavailable'}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Close" data-testid="button-close-withdraw"><X size={16} /></button></div>
      <p className="modal-note">{isLive
        ? 'Paystack must verify the bank recipient before any funds are reserved. A ₦50 service fee is deducted. A pending transfer remains reserved until Paystack confirms its result.'
        : isTest
          ? 'Paystack test mode is tried first. If it cannot resolve the recipient, the payout is completed as a local simulation. A ₦50 service fee is deducted; no real bank money moves.'
          : 'Paystack is unavailable or not configured. No withdrawal can be submitted.'} Available: <b>{money(available)}</b></p>
      {result ? <div className="wd-result" data-testid="status-withdraw-result">
         <small>Mosquito Wallet · {isLive ? 'Live' : 'Test'} withdrawal receipt</small>
        <StatusPill status={result.status} />
         <b>{money(result.status === 'success' ? result.amountNaira - 50 : result.amountNaira)}</b>
          <small>{result.status === 'success' ? `Net payout after ₦50 fee · requested ${money(result.amountNaira)}` : `Requested amount · Ref ${result.reference}`}</small>
         {result.status === 'success' && <small>Ref {result.reference}</small>}
          <p>{result.status === 'pending' ? 'Transfer is pending. Verify to reconcile it; you will not be debited twice.' : result.status === 'success' && result.simulated ? 'Paystack could not resolve this test recipient, so this was settled locally. No bank transfer was sent.' : result.status === 'success' && isLive ? 'Paystack confirmed the bank transfer.' : result.status === 'success' ? 'Paystack test transfer succeeded. No real bank money moved.' : 'Transfer failed. Held funds are released back to your balance.'}</p>
        <div className="wd-actions">{result.status === 'pending' && <VerifyButton id={result.id} />}<button className="dark-btn" onClick={onClose} data-testid="button-done-withdraw">Done</button></div>
      </div> : <form className="auth-form" onSubmit={submit}>
        <label>Amount (₦)<input type="number" min="500" max="500000" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-withdraw-amount" /></label>
        <label>Recipient name<input value={name} onChange={e => setName(e.target.value)} data-testid="input-withdraw-name" /></label>
        <div className="two-col"><label>Account number<input inputMode="numeric" maxLength={10} value={account} onChange={e => setAccount(e.target.value.replace(/\D/g, ''))} data-testid="input-withdraw-account" /></label>
          <label>Bank code<input inputMode="numeric" maxLength={6} value={bank} onChange={e => setBank(e.target.value.replace(/\D/g, ''))} data-testid="input-withdraw-bank" /></label></div>
        {error && <InlineError>{error}</InlineError>}
          <small>₦50 fee · estimated payout {money(Math.max(0, (Number(amount) || 0) - 50))}</small>
          <button className="primary-btn full" type="submit" disabled={create.isPending || !isLive && !isTest} data-testid="button-submit-withdraw">{create.isPending ? 'Processing withdrawal…' : isLive ? 'Withdraw to bank' : isTest ? 'Submit test withdrawal' : 'Unavailable'} <ArrowRight size={17} /></button>
      </form>}
    </div>
  </div>;
}
