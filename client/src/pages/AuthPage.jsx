import { useState } from 'react';
import { api } from '../api';
import { useAuth, navigate } from '../ctx';
import { Notice } from '../components/ui';

const DEMO = [
  { label: 'Attendee', email: 'attendee@ticketforge.dev', password: 'Attendee@123' },
  { label: 'Organizer', email: 'organizer@ticketforge.dev', password: 'Organizer@123' },
  { label: 'Admin', email: 'admin@ticketforge.dev', password: 'Admin@123' },
];

export default function AuthPage({ mode, reason }) {
  const { login } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'attendee', organizationName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const done = (d) => {
    login(d.token, d.user);
    const back = window.location.hash.slice(1);
    if (['/login', '/register'].includes(back) || !back) navigate(d.user.role === 'attendee' ? '/' : d.user.role === 'admin' ? '/admin' : '/organizer');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { ...form, organizationName: form.role === 'organizer' ? form.organizationName : undefined };
      done(await api(`/api/auth/${mode}`, { method: 'POST', body }));
    } catch (err) {
      setError(err.details ? err.details.map((d) => d.message).join('. ') : err.message);
    } finally {
      setBusy(false);
    }
  };

  const quick = async (d) => {
    setError('');
    try { done(await api('/api/auth/login', { method: 'POST', body: { email: d.email, password: d.password } })); } catch (err) { setError(err.message); }
  };

  return (
    <div className="page narrow auth">
      <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
      {reason && <p className="muted">{reason}</p>}
      <form onSubmit={submit}>
        {mode === 'register' && (
          <>
            <fieldset className="role-pick">
              <legend>I want to</legend>
              <label><input type="radio" name="role" value="attendee" checked={form.role === 'attendee'} onChange={set('role')} /> Book tickets</label>
              <label><input type="radio" name="role" value="organizer" checked={form.role === 'organizer'} onChange={set('role')} /> Sell tickets for my events</label>
            </fieldset>
            <label>Your name<input value={form.name} onChange={set('name')} required minLength={2} autoComplete="name" /></label>
            {form.role === 'organizer' && (
              <label>Organization name<input value={form.organizationName} onChange={set('organizationName')} required minLength={2} placeholder="e.g. Chennai Live Co" /></label>
            )}
          </>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        <Notice>{error}</Notice>
        <button className="btn wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
      <p className="muted center">
        {mode === 'login' ? <>New here? <a href="#/register">Create an account</a></> : <>Already registered? <a href="#/login">Log in</a></>}
      </p>
      {mode === 'login' && (
        <div className="demo">
          <p>Try a demo account</p>
          <div>{DEMO.map((d) => <button key={d.label} className="btn ghost small" onClick={() => quick(d)}>{d.label}</button>)}</div>
        </div>
      )}
    </div>
  );
}
