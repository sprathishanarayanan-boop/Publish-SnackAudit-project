import { useState } from 'react';
import { api, money } from '../api';
import { navigate } from '../ctx';
import { Notice } from '../components/ui';

const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const blankTier = () => ({ name: '', price: '', quantity: '', seatPrefix: '' });

export default function EventEditorPage() {
  const start = new Date(Date.now() + 21 * 864e5); start.setHours(19, 0, 0, 0);
  const cut = new Date(start.getTime() - 864e5); cut.setHours(23, 59, 0, 0);
  const [f, setF] = useState({ title: '', venue: '', description: '', startsAt: local(start), salesEndAt: local(cut) });
  const [tiers, setTiers] = useState([
    { name: 'VIP', price: '2999', quantity: '30', seatPrefix: 'VIP' },
    { name: 'General Admission', price: '799', quantity: '150', seatPrefix: 'GA' },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setTier = (i, k) => (e) => setTiers(tiers.map((t, j) => (j === i ? { ...t, [k]: e.target.value } : t)));
  const capacity = tiers.reduce((s, t) => s + (Number(t.quantity) || 0), 0);
  const potential = tiers.reduce((s, t) => s + (Number(t.quantity) || 0) * Math.round((Number(t.price) || 0) * 100), 0);

  const save = async (publish) => {
    setError('');
    setBusy(true);
    try {
      const { event } = await api('/api/events', {
        method: 'POST',
        body: {
          ...f,
          startsAt: new Date(f.startsAt).toISOString(),
          salesEndAt: new Date(f.salesEndAt).toISOString(),
          publish,
          tiers: tiers.map((t) => ({
            name: t.name.trim(),
            priceCents: Math.round(Number(t.price) * 100),
            quantity: Number(t.quantity),
            ...(t.seatPrefix.trim() ? { seatPrefix: t.seatPrefix.trim() } : {}),
          })),
        },
      });
      navigate(`/organizer/events/${event.id}`);
    } catch (e) {
      setError(e.details ? e.details.map((d) => `${d.path}: ${d.message}`).join('. ') : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow-wide">
      <h1>New event</h1>
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="editor">
        <label>Event name<input value={f.title} onChange={set('title')} required minLength={3} placeholder="Monsoon Indie Music Festival" /></label>
        <label>Venue<input value={f.venue} onChange={set('venue')} placeholder="YMCA Grounds, Chennai" /></label>
        <label>Description<textarea rows={3} value={f.description} onChange={set('description')} /></label>
        <div className="row2">
          <label>Starts<input type="datetime-local" value={f.startsAt} onChange={set('startsAt')} required /></label>
          <label>Ticket sales close<input type="datetime-local" value={f.salesEndAt} onChange={set('salesEndAt')} required /></label>
        </div>

        <fieldset className="tiers-edit">
          <legend>Ticket tiers</legend>
          <div className="tier-row head" aria-hidden="true"><span>Name</span><span>Price (₹)</span><span>Seats</span><span>Seat code</span><span /></div>
          {tiers.map((t, i) => (
            <div className="tier-row" key={i}>
              <input aria-label={`Tier ${i + 1} name`} value={t.name} onChange={setTier(i, 'name')} required placeholder="Gold" />
              <input aria-label={`Tier ${i + 1} price in rupees`} type="number" min="0" step="1" value={t.price} onChange={setTier(i, 'price')} required />
              <input aria-label={`Tier ${i + 1} seat count`} type="number" min="1" max="2000" value={t.quantity} onChange={setTier(i, 'quantity')} required />
              <input aria-label={`Tier ${i + 1} seat code`} value={t.seatPrefix} onChange={setTier(i, 'seatPrefix')} placeholder="G" maxLength={6} />
              <button type="button" className="btn ghost small" disabled={tiers.length === 1} onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn ghost small" disabled={tiers.length >= 8} onClick={() => setTiers([...tiers, blankTier()])}>Add tier</button>
          <p className="muted">{capacity} seats in total. Selling out would bring in {money(potential)}. Seats are labelled with the code, e.g. {tiers[0]?.seatPrefix || 'VIP'}-1.</p>
        </fieldset>

        <Notice>{error}</Notice>
        <div className="actions">
          <button className="btn" disabled={busy}>Publish event</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => save(false)}>Save as draft</button>
        </div>
      </form>
    </div>
  );
}
