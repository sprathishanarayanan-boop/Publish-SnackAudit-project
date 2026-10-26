import { useCallback, useEffect, useRef, useState } from 'react';
import { api, money, dateLong, stream } from '../api';
import { useAuth } from '../ctx';
import { Loading, Notice, StatusPill } from '../components/ui';
import { RevenueChart, TierBars, Funnel } from '../components/charts';

const RANGES = [['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];

export default function DashboardPage() {
  const { user } = useAuth();
  const [range, setRange] = useState('7d');
  const [eventId, setEventId] = useState('');
  const [data, setData] = useState(null);
  const [allEvents, setAllEvents] = useState([]);
  const [error, setError] = useState('');
  const [pulse, setPulse] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ range, ...(eventId ? { eventId } : {}) });
    const d = await api(`/api/organizer/analytics?${qs}`);
    setData(d);
    if (!eventId) setAllEvents(d.events);
  }, [range, eventId]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // Real-time: refetch when the server reports a hold, payment or expiry on our events.
  useEffect(() => stream('/api/organizer/analytics/stream', (msg) => {
    setPulse(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load().catch(() => {}), 400);
  }), [load]);

  if (!data) return <div className="page">{error ? <Notice>{error}</Notice> : <Loading label="Crunching sales" />}</div>;
  const t = data.totals;

  return (
    <div className="page dash">
      <header className="dash-head">
        <div>
          <h1>{user.role === 'admin' ? 'Platform sales' : user.organizationName}</h1>
          <p className="live" aria-live="polite">
            <span className="live-dot" aria-hidden="true" /> Live
            {pulse ? ` · last update ${new Date(pulse.at).toLocaleTimeString('en-IN')} (${pulse.type.replace('.', ' ')})` : ' · waiting for activity'}
          </p>
        </div>
        <div className="filters">
          <label>Event
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">All events</option>
              {allEvents.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>
          <label>Period
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      </header>

      <section className="kpis" aria-label="Key figures">
        <div className="kpi main"><span>Revenue</span><strong>{money(t.revenueCents)}</strong><small>avg order {money(t.avgOrderCents)}</small></div>
        <div className="kpi"><span>Tickets sold</span><strong>{t.ticketsSold}</strong><small>{t.sellThroughPct}% of {t.capacity} seats</small></div>
        <div className="kpi"><span>Hold → paid</span><strong>{t.holdToPaidPct}%</strong><small>of 10-minute holds converted</small></div>
        <div className="kpi"><span>Checkout success</span><strong>{t.checkoutToPaidPct}%</strong><small>{t.ticketsHeld} seats on hold right now</small></div>
      </section>

      <section className="panel">
        <h2>Revenue</h2>
        <RevenueChart series={data.series} unit={range === '24h' ? 'hour' : 'day'} />
      </section>

      <div className="two">
        <section className="panel">
          <h2>Ticket conversion</h2>
          <Funnel funnel={data.funnel} />
        </section>
        <section className="panel">
          <h2>Sales by tier</h2>
          <TierBars tiers={data.tiers} />
        </section>
      </div>

      <div className="two">
        <section className="panel">
          <h2>Events</h2>
          <table className="table">
            <thead><tr><th>Event</th><th>Sold</th><th>Conversion</th><th>Revenue</th></tr></thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td><a href={`#/organizer/events/${e.id}`}>{e.title}</a><br /><StatusPill status={e.status} /> <small className="muted">{dateLong(e.startsAt)}</small></td>
                  <td>{e.sold}/{e.capacity}</td>
                  <td>{e.conversionPct}%</td>
                  <td>{money(e.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.events.length === 0 && <p className="empty">No events yet. <a href="#/organizer/new">Create your first event</a>.</p>}
        </section>
        <section className="panel">
          <h2>Latest orders</h2>
          <ul className="recent">
            {data.recentOrders.map((o) => (
              <li key={o.id}><span><strong>{o.buyer}</strong> bought {o.tickets} for {o.eventTitle}</span><span>{money(o.totalCents)}</span></li>
            ))}
          </ul>
          {data.recentOrders.length === 0 && <p className="empty">Paid orders will appear here as they happen.</p>}
        </section>
      </div>
    </div>
  );
}
