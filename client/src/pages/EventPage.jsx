import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, dateLong, stream } from '../api';
import { useAuth, navigate } from '../ctx';
import { Loading, Notice } from '../components/ui';

const MAX = 10;

export default function EventPage({ id }) {
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const [seats, setSeats] = useState([]);
  const [picked, setPicked] = useState([]); // ticket ids
  const [mode, setMode] = useState('seats'); // 'seats' | 'quantity'
  const [qty, setQty] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const refreshTimer = useRef(null);

  const load = useCallback(async () => {
    const [e, s] = await Promise.all([api(`/api/events/${id}`), api(`/api/events/${id}/seats`)]);
    setEvent(e.event);
    setSeats(s.seats);
    // Drop any picked seat that someone else just took.
    setPicked((p) => p.filter((sid) => s.seats.find((x) => x.id === sid)?.status === 'available'));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError({ message: e.message }));
    // Live seat map: the server pushes a message whenever a hold/sale/expiry touches this event.
    const off = stream(`/api/events/${id}/stream`, () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => load().catch(() => {}), 300);
    });
    return () => { off(); clearTimeout(refreshTimer.current); };
  }, [id, load]);

  const tiers = event?.tiers || [];
  const tierById = useMemo(() => Object.fromEntries(tiers.map((t) => [t.id, t])), [tiers]);
  const seatsByTier = useMemo(() => {
    const m = {};
    seats.forEach((s) => { (m[s.tierId] ||= []).push(s); });
    return m;
  }, [seats]);

  const pickedSeats = picked.map((sid) => seats.find((s) => s.id === sid)).filter(Boolean);
  const qtyCount = Object.values(qty).reduce((a, b) => a + b, 0);
  const count = mode === 'seats' ? pickedSeats.length : qtyCount;
  const total = mode === 'seats'
    ? pickedSeats.reduce((s, x) => s + tierById[x.tierId].priceCents, 0)
    : Object.entries(qty).reduce((s, [tid, n]) => s + (tierById[tid]?.priceCents || 0) * n, 0);

  const toggle = (seat) => {
    if (seat.status !== 'available') return;
    setFlash('');
    setPicked((p) => {
      if (p.includes(seat.id)) return p.filter((x) => x !== seat.id);
      if (p.length >= MAX) { setFlash(`You can hold up to ${MAX} seats in one order.`); return p; }
      return [...p, seat.id];
    });
  };

  const hold = async () => {
    setError(null);
    if (!user) { navigate('/login'); return; }
    setBusy(true);
    try {
      const body = mode === 'seats'
        ? { ticketIds: picked }
        : { items: Object.entries(qty).filter(([, n]) => n > 0).map(([tierId, quantity]) => ({ tierId, quantity })) };
      const { order } = await api(`/api/events/${id}/holds`, { method: 'POST', body });
      navigate(`/checkout/${order.id}`);
    } catch (e) {
      setError(e);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (error && !event) return <div className="page"><Notice>{error.message}</Notice></div>;
  if (!event) return <div className="page"><Loading label="Loading seat map" /></div>;

  const canBuy = event.salesOpen && (!user || user.role === 'attendee');

  return (
    <div className="page event">
      <header className="event-head">
        <a className="back" href="#/">All events</a>
        <h1>{event.title}</h1>
        <p className="event-when">{dateLong(event.startsAt)} at {event.venue}</p>
        <p className="event-org">Hosted by {event.organizationName}. Ticket sales close {dateLong(event.salesEndAt)}.</p>
        {event.description && <p className="event-desc">{event.description}</p>}
      </header>

      {!event.salesOpen && <Notice kind="info">Ticket sales for this event have closed.</Notice>}
      {user && user.role !== 'attendee' && <Notice kind="info">You are signed in as {user.role}. Sign in with an attendee account to book.</Notice>}

      <div className="event-grid">
        <section aria-label="Choose seats">
          <div className="mode" role="radiogroup" aria-label="How do you want to book?">
            <button role="radio" aria-checked={mode === 'seats'} className={mode === 'seats' ? 'on' : ''} onClick={() => setMode('seats')}>Pick exact seats</button>
            <button role="radio" aria-checked={mode === 'quantity'} className={mode === 'quantity' ? 'on' : ''} onClick={() => setMode('quantity')}>Best available</button>
          </div>

          {mode === 'seats' && (
            <>
              <div className="stage" aria-hidden="true">Stage</div>
              {tiers.map((t) => (
                <div className="tier" key={t.id}>
                  <div className="tier-head">
                    <h2>{t.name}</h2>
                    <span className="tier-price">{t.priceCents === 0 ? 'Free' : money(t.priceCents)}</span>
                    <span className="tier-left">{t.available} left</span>
                  </div>
                  <div className="seats" style={{ '--cols': Math.min(16, Math.max(5, Math.ceil(Math.sqrt((seatsByTier[t.id] || []).length * 2.5)))) }}>
                    {(seatsByTier[t.id] || []).map((s) => {
                      const on = picked.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          className={`seat ${s.status} ${on ? 'picked' : ''}`}
                          disabled={s.status !== 'available' || !canBuy}
                          aria-pressed={on}
                          aria-label={`Seat ${s.seat}, ${s.status === 'available' ? (on ? 'selected' : 'available') : s.status === 'held' ? 'on hold' : 'sold'}`}
                          title={s.seat}
                          onClick={() => toggle(s)}
                        >
                          {s.number}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <ul className="legend" aria-label="Seat key">
                <li><i className="seat available" /> Available</li>
                <li><i className="seat available picked" /> Your pick</li>
                <li><i className="seat held" /> On hold</li>
                <li><i className="seat sold" /> Sold</li>
              </ul>
            </>
          )}

          {mode === 'quantity' && (
            <div className="qty-list">
              {tiers.map((t) => (
                <div className="qty-row" key={t.id}>
                  <div>
                    <h2>{t.name}</h2>
                    <p>{t.priceCents === 0 ? 'Free' : money(t.priceCents)} each, {t.available} left</p>
                  </div>
                  <div className="stepper">
                    <button aria-label={`Fewer ${t.name}`} disabled={!qty[t.id]} onClick={() => setQty({ ...qty, [t.id]: (qty[t.id] || 0) - 1 })}>−</button>
                    <output aria-live="polite">{qty[t.id] || 0}</output>
                    <button aria-label={`More ${t.name}`} disabled={!canBuy || qtyCount >= MAX || (qty[t.id] || 0) >= t.available} onClick={() => setQty({ ...qty, [t.id]: (qty[t.id] || 0) + 1 })}>+</button>
                  </div>
                </div>
              ))}
              <p className="hint">We pick the best free seats in each tier when you hold.</p>
            </div>
          )}
        </section>

        <aside className="summary" aria-live="polite">
          <h2>Your selection</h2>
          {count === 0 ? (
            <p className="muted">{mode === 'seats' ? 'Tap a seat to add it.' : 'Choose how many tickets you need.'}</p>
          ) : (
            <ul className="lines">
              {mode === 'seats'
                ? pickedSeats.map((s) => <li key={s.id}><span>{tierById[s.tierId].name} · {s.seat}</span><span>{money(tierById[s.tierId].priceCents)}</span></li>)
                : Object.entries(qty).filter(([, n]) => n).map(([tid, n]) => <li key={tid}><span>{n} × {tierById[tid].name}</span><span>{money(tierById[tid].priceCents * n)}</span></li>)}
            </ul>
          )}
          <div className="total"><span>Total</span><strong>{money(total)}</strong></div>
          <Notice kind="info">{flash}</Notice>
          {error && (
            <Notice>
              {error.message}
              {error.code === 'SEATS_UNAVAILABLE' && error.details?.seats && <> Taken: {error.details.seats.join(', ')}. The map has been refreshed.</>}
              {error.code === 'ACTIVE_HOLD_EXISTS' && <> <a href={`#/checkout/${error.details.orderId}`}>Go to your hold</a></>}
            </Notice>
          )}
          <button className="btn wide" disabled={!canBuy || count === 0 || busy} onClick={hold}>
            {busy ? 'Holding…' : user ? `Hold ${count || ''} ${count === 1 ? 'ticket' : 'tickets'} for 10 minutes` : 'Log in to book'}
          </button>
          <p className="fine">Held seats are released automatically if you don’t pay within 10 minutes.</p>
        </aside>
      </div>
    </div>
  );
}
