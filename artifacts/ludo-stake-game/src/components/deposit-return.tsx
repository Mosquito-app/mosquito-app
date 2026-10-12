import { useCallback, useEffect, useRef, useState } from 'react';
import { getGetWalletQueryKey, useVerifyDeposit } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { money } from '@/components/common';

// Preserve the legacy key so checkouts started before the rebrand still verify.
const KEY = 'ludoroom.pendingDeposit';
export const rememberDeposit = (reference: string) => { try { sessionStorage.setItem(KEY, reference); } catch { /* storage unavailable */ } };

export function DepositReturn() {
  const verify = useVerifyDeposit();
  const [message, setMessage] = useState('');
  const [retryable, setRetryable] = useState(false);
  const mutateRef = useRef(verify.mutate); mutateRef.current = verify.mutate;
  const run = useCallback(() => {
    let reference = '';
    try { reference = sessionStorage.getItem(KEY) || ''; } catch { /* ignore */ }
    if (reference.length < 8) return;
    setRetryable(false); setMessage('');
    mutateRef.current({ data: { reference } }, {
      onSuccess: result => {
        void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        if (result.status === 'pending') { setRetryable(true); setMessage(`${result.paymentMode === 'live' ? 'Live' : 'Test'} deposit is still pending. Check again in a moment.`); return; }
        try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
        setMessage(result.status === 'success'
          ? `${result.paymentMode === 'live' ? 'Live' : 'Test'} deposit confirmed: ${money(result.amountNaira)} added to your Mosquito Wallet.`
          : `${result.paymentMode === 'live' ? 'Live' : 'Test'} deposit ${result.status}. Your balance has not been changed.`);
      },
      onError: () => { setRetryable(true); setMessage('We could not verify that deposit yet. Your balance has not been changed.'); },
    });
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('reference') || params.get('trxref');
    if (ref) { rememberDeposit(ref); window.history.replaceState(null, '', window.location.pathname); }
    run();
  }, [run]);
  if (!verify.isPending && !message) return null;
  return <div className="verify-note" data-testid="status-deposit"><strong>Mosquito Wallet · </strong>{verify.isPending ? 'Verifying Paystack checkout securely…' : message}{retryable && !verify.isPending && <> <button className="quiet-btn" onClick={run} data-testid="button-retry-deposit">Retry verification</button></>}{!retryable && !verify.isPending && <button className="quiet-btn" onClick={() => setMessage('')} data-testid="button-dismiss-deposit">Dismiss</button>}</div>;
}
