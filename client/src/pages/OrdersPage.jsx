import { useEffect, useState } from 'react';
import { api, money, dateLong } from '../api';
import { Loading, Notice, StatusPill } from '../components/ui';

export default function OrdersPage() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/orders').then((d) => setOrders(d.orders)).catch((e) => setError(e.message)); }, []);

  return (
    <div className="page">
      <h1>My tickets</h1>
      <Notice>{error}</Notice>
      {!orders && !error && <Loading />}
      {orders?.length === 0 && <p className="empty">No bookings yet. <a href="#/">Find an event</a> and hold a seat.</p>}
      <ul className="order-list">
        {orders?.map((o) => (
          <li key={o.id}>
            <a href={`#/checkout/${o.id}`} className="order-row">
              <div>
                <h2>{o.eventTitle}</h2>
                <p className="muted">{dateLong(o.eventStartsAt)}</p>
                <p className="seats-inline">{o.items.map((i) => i.seat).join(', ')}</p>
              </div>
              <div className="order-side">
                <StatusPill status={o.status} />
                <strong>{money(o.totalCents)}</strong>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
