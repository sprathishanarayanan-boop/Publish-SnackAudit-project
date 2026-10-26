import { useCallback, useEffect, useState } from 'react';
import { api, money, dateLong } from '../api';
import { navigate } from '../ctx';
import { Loading, Notice, useCountdown, mmss } from '../components/ui';

const TEST_CARDS = [
  { number: '4242424242424242', label: 'Approves' },
  { number: '4000000000000002', label: 'Declines' },
  { number: '4000000000009995', label: 'Insufficient funds' },
  { number: '4000000000000119', label: 'Gateway never answers' },
];

const REASONS = {
  card_declined: 'Your card was declined.',
  insufficient_funds: 'The card has insufficient funds.',
  issuer_declined: 'Your bank declined the payment.',
  GATEWAY_TIMEOUT: 'The payment gateway did not respond in time.',
};

export default function CheckoutPage({ id }) {
  const [order, setOrder] = useState(null);
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/api/orders/${id}`).then((d) => setOrder(d.order)), [id]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // Poll while the gateway is deciding.
  useEffect(() => {
    if (order?.status !== 'processing') return undefined;
    const t = setInterval(() => load().catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [order?.status, load]);

  const left = useCountdown(order && ['pending', 'processing'].includes(order.status) ? order.expiresAt : null,
    () => setTimeout(() => load().catch(() => {}), 1200));

  const pay = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { order: o } = await api(`/api/orders/${id}/checkout`, { method: 'POST', body: { cardNumber: card.replace(/\s/g, '') } });
      setOrder(o);
    } catch (err) {
      setError(err.message);
      load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try { const { order: o } = await api(`/api/orders/${id}/hold`, { method: 'DELETE' }); setOrder(o); } catch (err) { setError(err.message); }
  };

  if (!order) return <div className="page">{error ? <Notice>{error}</Notice> : <Loading label="Loading your hold" />}</div>;

  const active = ['pending', 'processing'].includes(order.status);
  const holdSeconds = Math.max(1, (new Date(order.expiresAt) - new Date(order.createdAt)) / 1000);
  const fraction = active ? left / holdSeconds : 0;
  const lastFail = order.lastTransaction?.status === 'rejected' ? order.lastTransaction.failureReason : null;

  if (order.status === 'paid') {
    return (
      <div className="page narrow">
        <div className="ticket confirmed">
          <div className="ticket-main">
            <p className="ticket-kicker">You’re going</p>
            <h1>{order.eventTitle}</h1>
            <p>{dateLong(order.eventStartsAt)}<br />{order.eventVenue}</p>
            <ul className="ticket-seats">
              {order.items.map((i) => <li key={i.ticketId}><strong>{i.seat}</strong><span>{i.tier}</span></li>)}
            </ul>
          </div>
          <div className="ticket-tear">
            <span>Paid</span>
            <strong>{money(order.totalCents)}</strong>
            <small>Ref {order.lastTransaction?.gatewayRef}</small>
          </div>
        </div>
        <p className="center"><a className="btn ghost" href="#/orders">See all my tickets</a></p>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="page narrow">
        <h1>{order.status === 'cancelled' ? 'Hold cancelled' : order.status === 'failed' ? 'Payment failed' : 'Your hold expired'}</h1>
        <p>{order.status === 'cancelled'
          ? 'The seats are back on sale.'
          : 'We released your seats after 10 minutes so other people can book them. They may still be available.'}</p>
        <a className="btn" href={`#/events/${order.eventId}`}>Choose seats again</a>
      </div>
    );
  }

  return (
    <div className="page narrow checkout">
      <div className="timer" style={{ '--p': fraction }} role="timer" aria-label={`Hold expires in ${mmss(left)}`}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="52" className="track" />
          <circle cx="60" cy="60" r="52" className="bar" pathLength="1" />
        </svg>
        <div><strong>{mmss(left)}</strong><span>left to pay</span></div>
      </div>

      <h1>{order.eventTitle}</h1>
      <p className="muted">{dateLong(order.eventStartsAt)}, {order.eventVenue}</p>

      <ul className="lines">
        {order.items.map((i) => <li key={i.ticketId}><span>{i.tier} · {i.seat}</span><span>{money(i.priceCents)}</span></li>)}
      </ul>
      <div className="total"><span>Total</span><strong>{money(order.totalCents)}</strong></div>

      {lastFail && order.status === 'pending' && (
        <Notice>{REASONS[lastFail] || 'The payment did not go through.'} Your seats are still held, so you can try another card.</Notice>
      )}
      <Notice>{error}</Notice>

      {order.status === 'processing' ? (
        <div className="processing" role="status"><span className="dots" aria-hidden="true" /> Waiting for the payment gateway to confirm…</div>
      ) : (
        <form onSubmit={pay} className="pay">
          <label>
            Card number
            <input inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.target.value)} required />
          </label>
          <fieldset className="testcards">
            <legend>Simulated cards</legend>
            {TEST_CARDS.map((c) => (
              <button type="button" key={c.number} className={card.replace(/\s/g, '') === c.number ? 'on' : ''}
                onClick={() => setCard(c.number.replace(/(\d{4})(?=\d)/g, '$1 '))}>
                <span>•••• {c.number.slice(-4)}</span>{c.label}
              </button>
            ))}
          </fieldset>
          <button className="btn wide" disabled={busy}>{busy ? 'Sending…' : `Pay ${money(order.totalCents)}`}</button>
          <button type="button" className="btn ghost wide" onClick={cancel}>Release these seats</button>
        </form>
      )}
      <p className="fine"><a href={`#/events/${order.eventId}`} onClick={() => navigate(`/events/${order.eventId}`)}>Back to the seat map</a></p>
    </div>
  );
}
