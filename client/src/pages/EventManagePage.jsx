import { useCallback, useEffect, useState } from 'react';
import { api, money, dateLong } from '../api';
import { Loading, Notice, StatusPill } from '../components/ui';

export default function EventManagePage({ id }) {
  const [event, setEvent] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [e, o] = await Promise.all([api(`/api/events/${id}`), api(`/api/organizer/events/${id}/orders`)]);
    setEvent(e.event);
    setOrders(o.orders);
  }, [id]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const act = async (action, done) => {
    if (action === 'cancel' && !window.confirm('Cancel this event? Open holds are released and sales stop. This cannot be undone.')) return;
    setError(''); setMsg('');
    try { const { event: e } = await api(`/api/events/${id}/${action}`, { method: 'POST' }); setEvent(e); setMsg(done); } catch (e) { setError(e.message); }
  };

  if (!event) return <div className="page">{error ? <Notice>{error}</Notice> : <Loading />}</div>;

  return (
    <div className="page">
      <a className="back" href="#/organizer">Dashboard</a>
      <div className="manage-head">
        <div>
          <h1>{event.title}</h1>
          <p className="muted"><StatusPill status={event.status} /> {dateLong(event.startsAt)}, {event.venue}. Sales close {dateLong(event.salesEndAt)}.</p>
        </div>
        <div className="actions">
          {event.status === 'published' && <a className="btn ghost" href={`#/events/${event.id}`}>View public page</a>}
          {event.status === 'draft' && <button className="btn" onClick={() => act('publish', 'Published. The event is now on sale.')}>Publish</button>}
          {event.status === 'published' && <button className="btn ghost" onClick={() => act('unpublish', 'Unpublished. The event is hidden and sales are paused.')}>Unpublish</button>}
          {event.status !== 'cancelled' && <button className="btn danger" onClick={() => act('cancel', 'Event cancelled.')}>Cancel event</button>}
        </div>
      </div>
      <Notice kind="success">{msg}</Notice>
      <Notice>{error}</Notice>

      <section className="panel">
        <h2>Tiers</h2>
        <table className="table">
          <thead><tr><th>Tier</th><th>Price</th><th>Available</th><th>On hold</th><th>Sold</th></tr></thead>
          <tbody>{event.tiers.map((t) => (
            <tr key={t.id}><td>{t.name} <small className="muted">({t.seatPrefix}-1…{t.quantity})</small></td><td>{money(t.priceCents)}</td><td>{t.available}</td><td>{t.held}</td><td>{t.sold}</td></tr>
          ))}</tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Orders</h2>
        {orders.length === 0 ? <p className="empty">No orders yet. Share the public page to start selling.</p> : (
          <table className="table">
            <thead><tr><th>Buyer</th><th>Seats</th><th>Status</th><th>Amount</th><th>Placed</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}><td>{o.buyer}<br /><small className="muted">{o.email}</small></td><td>{o.seats}</td><td><StatusPill status={o.status} /></td><td>{money(o.total_cents)}</td><td>{dateLong(o.created_at)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
