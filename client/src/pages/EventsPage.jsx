import { useEffect, useState } from 'react';
import { api, money, dayParts } from '../api';
import { Loading, Notice } from '../components/ui';

export default function EventsPage() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api('/api/events').then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  }, []);

  const shown = (events || []).filter((e) =>
    !q || `${e.title} ${e.venue} ${e.organizationName}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <section className="intro">
        <h1>Pick your seat before someone else does.</h1>
        <p>Choose an exact seat or just a ticket tier. We hold it for you for 10 minutes while you pay.</p>
        <label className="search">
          <span className="sr-only">Search events</span>
          <input type="search" placeholder="Search by event, venue or organizer" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </section>

      <Notice>{error}</Notice>
      {!events && !error && <Loading label="Loading events" />}
      {events && shown.length === 0 && <p className="empty">No upcoming events match “{q}”. Try a venue or city name.</p>}

      <ul className="stubs">
        {shown.map((e) => {
          const d = dayParts(e.startsAt);
          const pctLeft = e.capacity ? e.available / e.capacity : 0;
          return (
            <li key={e.id}>
              <a className="stub" href={`#/events/${e.id}`}>
                <div className="stub-date" aria-hidden="true">
                  <span className="m">{d.month}</span>
                  <span className="d">{d.day}</span>
                  <span className="w">{d.weekday} {d.time}</span>
                </div>
                <div className="stub-body">
                  <h2>{e.title}</h2>
                  <p className="venue">{e.venue}</p>
                  <p className="org">by {e.organizationName}</p>
                </div>
                <div className="stub-side">
                  <span className="from">from <strong>{e.minPriceCents === 0 ? 'Free' : money(e.minPriceCents)}</strong></span>
                  <span className={`left ${pctLeft < 0.15 ? 'low' : ''}`}>
                    {!e.salesOpen ? 'Sales closed' : e.available === 0 ? 'Sold out' : `${e.available} of ${e.capacity} seats left`}
                  </span>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
