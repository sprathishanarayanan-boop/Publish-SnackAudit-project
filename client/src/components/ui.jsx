import { useEffect, useState } from 'react';

export function Notice({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ label = 'Loading' }) {
  return <div className="loading" role="status"><span className="dots" aria-hidden="true" />{label}</div>;
}

/** Live countdown to an ISO time. Calls onExpire once when it hits zero. */
export function useCountdown(until, onExpire) {
  const calc = () => Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    if (!until) return undefined;
    setLeft(calc());
    let fired = false;
    const t = setInterval(() => {
      const v = calc();
      setLeft(v);
      if (v === 0 && !fired) { fired = true; onExpire?.(); }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return left;
}

export const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function StatusPill({ status }) {
  const label = { pending: 'On hold', processing: 'Paying', paid: 'Confirmed', failed: 'Payment failed', expired: 'Hold expired', cancelled: 'Cancelled', published: 'On sale', draft: 'Draft' }[status] || status;
  return <span className={`pill ${status}`}>{label}</span>;
}
