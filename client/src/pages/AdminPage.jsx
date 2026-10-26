import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../api';
import { useAuth } from '../ctx';
import { Loading, Notice } from '../components/ui';

export default function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);

  const load = useCallback(async () => {
    const [s, u, o] = await Promise.all([api('/api/admin/stats'), api('/api/admin/users'), api('/api/admin/organizations')]);
    setStats(s); setUsers(u.users); setOrgs(o.organizations);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const changeRole = async (u, role) => {
    setError('');
    let organizationId;
    if (role === 'organizer' && !u.organization_id) {
      const name = window.prompt(`Which organization should ${u.name} manage? Enter its exact name:\n${orgs.map((o) => o.name).join('\n')}`);
      organizationId = orgs.find((o) => o.name === name)?.id;
      if (!organizationId) { setError('Pick an existing organization to make someone an organizer.'); return; }
    }
    try { await api(`/api/admin/users/${u.id}/role`, { method: 'PATCH', body: { role, organizationId } }); await load(); } catch (e) { setError(e.message); }
  };

  const runJob = async () => {
    try { const { result } = await api('/api/admin/jobs/release-holds', { method: 'POST' }); setJob(result); load(); } catch (e) { setError(e.message); }
  };

  if (!stats) return <div className="page">{error ? <Notice>{error}</Notice> : <Loading />}</div>;
  const s = stats.stats;
  const hitRate = stats.cache.hits + stats.cache.misses ? Math.round((stats.cache.hits / (stats.cache.hits + stats.cache.misses)) * 100) : 0;

  return (
    <div className="page dash">
      <h1>Platform admin</h1>
      <section className="kpis">
        <div className="kpi main"><span>Gross revenue</span><strong>{money(s.revenue_cents)}</strong><small>{s.tickets_sold} tickets sold</small></div>
        <div className="kpi"><span>Organizations</span><strong>{s.organizations}</strong><small>{s.events} events, {s.published_events} on sale</small></div>
        <div className="kpi"><span>Users</span><strong>{s.users}</strong><small>{s.organizers} organizers, {s.attendees} attendees</small></div>
        <div className="kpi"><span>Active holds</span><strong>{s.active_holds}</strong><small>{s.tickets_held} seats held · cache hit rate {hitRate}%</small></div>
      </section>
      <Notice>{error}</Notice>

      <section className="panel">
        <div className="panel-head">
          <h2>Expired-hold release job</h2>
          <button className="btn small" onClick={runJob}>Run now</button>
        </div>
        <p className="muted">Runs automatically every 30 seconds and returns seats from holds older than 10 minutes to inventory.</p>
        {job && <p>{job.skipped ? 'Another instance is running the job right now.' : `Released ${job.releasedSeats} seats from ${job.expiredOrders} expired holds in ${job.ms} ms.`}</p>}
      </section>

      <div className="two">
        <section className="panel">
          <h2>Organizations</h2>
          <table className="table">
            <thead><tr><th>Name</th><th>Members</th><th>Events</th><th>Revenue</th></tr></thead>
            <tbody>{orgs.map((o) => <tr key={o.id}><td>{o.name}</td><td>{o.members}</td><td>{o.events}</td><td>{money(o.revenue_cents)}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel">
          <h2>Users</h2>
          <div className="scroll">
            <table className="table">
              <thead><tr><th>User</th><th>Role</th></tr></thead>
              <tbody>{users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}<br /><small className="muted">{u.email}{u.organization_name ? `, ${u.organization_name}` : ''}</small></td>
                  <td>
                    <select aria-label={`Role for ${u.name}`} value={u.role} disabled={u.id === user.id} onChange={(e) => changeRole(u, e.target.value)}>
                      <option value="attendee">Attendee</option>
                      <option value="organizer">Organizer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
