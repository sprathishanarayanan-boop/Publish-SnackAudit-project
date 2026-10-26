const TOKEN_KEY = 'tf_token';
const USER_KEY = 'tf_user';

export const session = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  save(token, user) { try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token && ['TOKEN_EXPIRED', 'INVALID_TOKEN'].includes(data?.error?.code)) {
    session.clear();
    window.dispatchEvent(new Event('tf:logout'));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const money = (cents) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export const dateLong = (d) =>
  new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const dayParts = (d) => {
  const x = new Date(d);
  return {
    day: x.toLocaleDateString('en-IN', { day: 'numeric' }),
    month: x.toLocaleDateString('en-IN', { month: 'short' }),
    weekday: x.toLocaleDateString('en-IN', { weekday: 'short' }),
    time: x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
  };
};

/** Subscribe to a server-sent-events stream; returns an unsubscribe function. */
export function stream(path, onMessage) {
  const sep = path.includes('?') ? '&' : '?';
  const url = session.token ? `${path}${sep}token=${encodeURIComponent(session.token)}` : path;
  const es = new EventSource(url);
  es.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
  return () => es.close();
}
